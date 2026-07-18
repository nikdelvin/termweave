import { watch, type FSWatcher } from 'node:fs'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'

type SyncManifest = {
  files: string[]
  icon?: string
}

type ActiveProcess = {
  command: 'dev' | 'build'
  pid: number
  projectRoot: string
}

type JsonObject = Record<string, unknown>

const SDK_ROOT = resolve(import.meta.dir, '..')
const SDK_CHECKOUT_ROOT = resolve(SDK_ROOT, '..')
const SDK_GIT_ROOT = resolve(SDK_CHECKOUT_ROOT, '.termweave-git')
const LEGACY_SDK_GIT_ROOT = resolve(SDK_CHECKOUT_ROOT, '.git')
const SDK_MARKER = '.termweave-sdk.json'
const SYNC_MANIFEST = '.termweave-project-files.json'
const ACTIVE_PROCESS = '.termweave-active.json'
const SIDECAR_RESTART_SIGNAL = '.termweave-sidecar-restart'
const RESERVED_SIDECAR_FILE = 'index.tsx'
const SOURCE_SYNC_DELAY_MS = 80
const RESERVED_ICON_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'scripts',
  'shared',
  'sidecar',
  'src',
  'src-tauri',
  'templates',
  'termweave',
])

function normalizeRelativePath(path: string) {
  return path.split(sep).join('/')
}

function safeDestination(root: string, path: string) {
  const destination = resolve(root, path)
  const pathFromRoot = relative(root, destination)

  if (pathFromRoot === '' || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..') {
    throw new Error(`Path escapes its expected root: ${path}`)
  }

  return destination
}

async function pathExists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function listSourceFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name)
    const entryStat = await lstat(absolutePath)

    if (entryStat.isSymbolicLink()) {
      throw new Error(
        `Project source may not contain symbolic links: ${relative(root, absolutePath)}`,
      )
    }

    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(root, absolutePath)))
      continue
    }

    if (entry.isFile()) files.push(normalizeRelativePath(relative(root, absolutePath)))
  }

  return files.sort()
}

async function readManifest(sdkRoot: string): Promise<SyncManifest> {
  try {
    const value = JSON.parse(
      await readFile(resolve(sdkRoot, SYNC_MANIFEST), 'utf8'),
    ) as Partial<SyncManifest>

    return {
      files: Array.isArray(value.files)
        ? value.files.filter((file): file is string => typeof file === 'string')
        : [],
      icon: typeof value.icon === 'string' ? value.icon : undefined,
    }
  } catch {
    return { files: [] }
  }
}

async function removeEmptyParents(path: string, stopAt: string) {
  let directory = dirname(path)

  while (directory !== stopAt && relative(stopAt, directory) !== '') {
    try {
      await rmdir(directory)
      directory = dirname(directory)
    } catch {
      return
    }
  }
}

function validateProjectLocation(projectRoot: string) {
  const expectedSdkRoot = resolve(projectRoot, 'termweave/sdk')
  if (expectedSdkRoot !== SDK_ROOT) {
    throw new Error(`Run this command from the standalone project root containing ${SDK_ROOT}`)
  }
}

async function migrateLegacyGitDirectory() {
  if (await pathExists(SDK_GIT_ROOT)) return
  if (!(await pathExists(LEGACY_SDK_GIT_ROOT))) return

  await rename(LEGACY_SDK_GIT_ROOT, SDK_GIT_ROOT)
  process.stdout.write('Migrated Termweave Git metadata out of repository auto-detection.\n')
}

function sdkGitCommand(...args: string[]) {
  return ['git', `--git-dir=${SDK_GIT_ROOT}`, `--work-tree=${SDK_CHECKOUT_ROOT}`, ...args]
}

async function validateProjectContext(projectRoot: string) {
  validateProjectLocation(projectRoot)

  if (!(await pathExists(SDK_GIT_ROOT))) {
    throw new Error(`Refusing to manage ${SDK_ROOT}: the SDK Git metadata is missing`)
  }

  try {
    const marker = JSON.parse(await readFile(resolve(SDK_ROOT, SDK_MARKER), 'utf8')) as Partial<{
      name: string
      schemaVersion: number
    }>

    if (marker.name !== 'termweave-sdk' || marker.schemaVersion !== 1) {
      throw new Error('unsupported SDK marker')
    }
  } catch {
    throw new Error(
      `Refusing to manage ${SDK_ROOT}: the Termweave SDK identity marker is missing or invalid`,
    )
  }
}

function getProjectIcon(config: JsonObject) {
  if (typeof config.icon !== 'string' || config.icon.trim() === '') {
    throw new Error('Invalid app.config.json: icon must be a non-empty project-relative path')
  }

  const icon = normalizeRelativePath(config.icon.trim())
  if (!['.svg', '.png'].includes(extname(icon).toLowerCase())) {
    throw new Error('Invalid app.config.json: icon must point to an SVG or PNG file')
  }
  const topLevelDirectory = icon.split('/')[0]
  if (topLevelDirectory && RESERVED_ICON_DIRECTORIES.has(topLevelDirectory)) {
    throw new Error(
      `Invalid app.config.json: icon may not be stored under the reserved ${topLevelDirectory}/ directory`,
    )
  }

  return icon
}

async function synchronizeSourceTree(projectRoot: string, sdkRoot: string) {
  const projectSource = resolve(projectRoot, 'src')
  const sdkSource = resolve(sdkRoot, 'sidecar/src')
  const appComponent = resolve(projectSource, 'App.tsx')

  if (!(await pathExists(appComponent))) {
    throw new Error(`Missing project entry component: ${appComponent}`)
  }

  const files = await listSourceFiles(projectSource)
  if (files.includes(RESERVED_SIDECAR_FILE)) {
    throw new Error(
      `src/${RESERVED_SIDECAR_FILE} is reserved by the Termweave SDK; use src/App.tsx as the project entry`,
    )
  }

  const previous = await readManifest(sdkRoot)
  const currentFiles = new Set(files)

  for (const staleFile of previous.files) {
    if (staleFile === RESERVED_SIDECAR_FILE || currentFiles.has(staleFile)) continue
    const staleDestination = safeDestination(sdkSource, staleFile)
    await rm(staleDestination, { force: true })
    await removeEmptyParents(staleDestination, sdkSource)
  }

  for (const file of files) {
    const source = safeDestination(projectSource, file)
    const destination = safeDestination(sdkSource, file)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }

  return { files, previous }
}

export async function syncProject(projectRoot: string, sdkRoot = SDK_ROOT) {
  projectRoot = resolve(projectRoot)
  sdkRoot = resolve(sdkRoot)

  const projectConfig = resolve(projectRoot, 'app.config.json')

  if (!(await pathExists(projectConfig))) {
    throw new Error(`Missing project configuration: ${projectConfig}`)
  }

  const rawConfig = JSON.parse(await readFile(projectConfig, 'utf8')) as unknown
  if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) {
    throw new Error('Invalid app.config.json: root must be an object')
  }

  const icon = getProjectIcon(rawConfig as JsonObject)
  const projectIcon = safeDestination(projectRoot, icon)
  if (!(await pathExists(projectIcon))) {
    throw new Error(`Invalid app.config.json: icon points to missing file: ${icon}`)
  }

  const { files, previous } = await synchronizeSourceTree(projectRoot, sdkRoot)

  await copyFile(projectConfig, resolve(sdkRoot, 'app.config.json'))
  if (previous.icon && previous.icon !== icon) {
    const previousSdkIcon = safeDestination(sdkRoot, previous.icon)
    await rm(previousSdkIcon, { force: true })
    await removeEmptyParents(previousSdkIcon, sdkRoot)
  }
  const sdkIcon = safeDestination(sdkRoot, icon)
  await mkdir(dirname(sdkIcon), { recursive: true })
  await copyFile(projectIcon, sdkIcon)

  const manifest: SyncManifest = { files, icon }
  await writeFile(resolve(sdkRoot, SYNC_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)

  process.stdout.write(
    `Synchronized ${files.length} project source file${files.length === 1 ? '' : 's'}, app.config.json, and ${icon}.\n`,
  )

  return manifest
}

async function runCommand(command: string[], cwd: string) {
  const subprocess = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  return subprocess.exited
}

async function runRequired(command: string[], cwd: string, description: string) {
  const exitCode = await runCommand(command, cwd)
  if (exitCode !== 0) throw new Error(`${description} failed with exit code ${exitCode}`)
}

async function readActiveProcess(sdkRoot: string): Promise<ActiveProcess | undefined> {
  try {
    const value = JSON.parse(
      await readFile(resolve(sdkRoot, ACTIVE_PROCESS), 'utf8'),
    ) as Partial<ActiveProcess>

    if (
      (value.command === 'dev' || value.command === 'build') &&
      typeof value.pid === 'number' &&
      typeof value.projectRoot === 'string'
    ) {
      return value as ActiveProcess
    }
  } catch {
    return undefined
  }

  return undefined
}

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function withActiveProcess<T>(
  command: ActiveProcess['command'],
  projectRoot: string,
  task: () => Promise<T>,
) {
  const lockPath = resolve(SDK_ROOT, ACTIVE_PROCESS)
  const active = await readActiveProcess(SDK_ROOT)

  if (active && active.pid !== process.pid && processIsRunning(active.pid)) {
    throw new Error(
      `Termweave ${active.command} is already running for ${active.projectRoot} (PID ${active.pid})`,
    )
  }

  await writeFile(
    lockPath,
    `${JSON.stringify({ command, pid: process.pid, projectRoot } satisfies ActiveProcess, null, 2)}\n`,
  )

  try {
    return await task()
  } finally {
    await rm(lockPath, { force: true })
  }
}

function createProjectWatchers(projectRoot: string, icon: string, onSourceChange: () => void) {
  const watchers: FSWatcher[] = []
  let restartNoticeShown = false

  const showRestartNotice = () => {
    if (restartNoticeShown) return
    restartNoticeShown = true
    process.stderr.write(
      '\napp.config.json or the project icon changed. Stop and rerun `bun run dev` to apply it.\n',
    )
  }

  const sourceWatcher = watch(resolve(projectRoot, 'src'), { recursive: true }, onSourceChange)
  sourceWatcher.on('error', (error) => {
    process.stderr.write(`Project source watcher failed: ${String(error)}\n`)
  })
  watchers.push(sourceWatcher)

  const watchedDirectories = new Map<string, Set<string>>()
  const addWatchedFile = (path: string) => {
    const directory = dirname(path)
    const files = watchedDirectories.get(directory) ?? new Set<string>()
    files.add(basename(path))
    watchedDirectories.set(directory, files)
  }

  addWatchedFile(resolve(projectRoot, 'app.config.json'))
  addWatchedFile(safeDestination(projectRoot, icon))

  for (const [directory, files] of watchedDirectories) {
    const configWatcher = watch(directory, (_event, filename) => {
      if (filename && files.has(String(filename))) showRestartNotice()
    })
    configWatcher.on('error', (error) => {
      process.stderr.write(`Project configuration watcher failed: ${String(error)}\n`)
    })
    watchers.push(configWatcher)
  }

  return () => {
    for (const watcher of watchers) watcher.close()
  }
}

async function runProjectChecks(projectRoot: string) {
  await runRequired(['bun', 'run', 'check'], projectRoot, 'Project checks')
}

async function runDevelopment(projectRoot: string) {
  await runProjectChecks(projectRoot)
  const initialSync = await syncProject(projectRoot)

  return withActiveProcess('dev', projectRoot, async () => {
    let syncTimer: ReturnType<typeof setTimeout> | undefined
    let syncRunning = false
    let syncQueued = false
    let restartSequence = 0

    const synchronizeSource = async () => {
      if (syncRunning) {
        syncQueued = true
        return
      }

      syncRunning = true
      try {
        do {
          syncQueued = false
          const { files, previous } = await synchronizeSourceTree(projectRoot, SDK_ROOT)

          await writeFile(
            resolve(SDK_ROOT, SYNC_MANIFEST),
            `${JSON.stringify({ ...previous, files }, null, 2)}\n`,
          )
          restartSequence += 1
          await writeFile(
            resolve(SDK_ROOT, SIDECAR_RESTART_SIGNAL),
            `${Date.now()}-${process.pid}-${restartSequence}\n`,
          )
          process.stdout.write('Project source synchronized; restarting the OpenTUI sidecar.\n')
        } while (syncQueued)
      } catch (error) {
        process.stderr.write(`Project source synchronization failed: ${String(error)}\n`)
      } finally {
        syncRunning = false
      }
    }

    const scheduleSourceSync = () => {
      if (syncTimer) clearTimeout(syncTimer)
      syncTimer = setTimeout(() => void synchronizeSource(), SOURCE_SYNC_DELAY_MS)
    }

    const closeWatchers = createProjectWatchers(
      projectRoot,
      initialSync.icon ?? 'app.icon.svg',
      scheduleSourceSync,
    )
    const subprocess = Bun.spawn(['bun', 'run', 'app:dev'], {
      cwd: SDK_ROOT,
      env: { ...process.env, TERMWEAVE_PROJECT_ROOT: projectRoot },
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })

    const stop = (signal: NodeJS.Signals) => {
      closeWatchers()
      if (syncTimer) clearTimeout(syncTimer)
      subprocess.kill(signal)
    }
    const stopForInterrupt = () => stop('SIGINT')
    const stopForTermination = () => stop('SIGTERM')
    process.once('SIGINT', stopForInterrupt)
    process.once('SIGTERM', stopForTermination)

    try {
      return await subprocess.exited
    } finally {
      process.off('SIGINT', stopForInterrupt)
      process.off('SIGTERM', stopForTermination)
      closeWatchers()
      if (syncTimer) clearTimeout(syncTimer)
    }
  })
}

export async function copyBuildOutputs(projectRoot: string, sdkRoot = SDK_ROOT) {
  const source = resolve(sdkRoot, 'src-tauri/target/release/bundle')
  const destination = resolve(projectRoot, 'build')

  if (!(await pathExists(source))) {
    throw new Error(`Tauri completed without producing a bundle directory at ${source}`)
  }

  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  await cp(source, destination, { recursive: true })
  process.stdout.write(`Copied native bundles to ${destination}\n`)
}

async function runBuild(projectRoot: string) {
  await runProjectChecks(projectRoot)
  await syncProject(projectRoot)

  return withActiveProcess('build', projectRoot, async () => {
    await runRequired(['bun', 'run', 'app:build'], SDK_ROOT, 'Termweave build')
    await copyBuildOutputs(projectRoot)
    return 0
  })
}

export function mergeManagedPackage(projectPackage: JsonObject, templatePackage: JsonObject) {
  const merged = structuredClone(projectPackage)

  for (const section of ['scripts', 'dependencies', 'devDependencies', 'overrides'] as const) {
    const current =
      typeof merged[section] === 'object' && merged[section] !== null
        ? (merged[section] as JsonObject)
        : {}
    const managed =
      typeof templatePackage[section] === 'object' && templatePackage[section] !== null
        ? (templatePackage[section] as JsonObject)
        : {}

    merged[section] = { ...current, ...managed }
  }

  return merged
}

async function runUpdate(projectRoot: string) {
  const active = await readActiveProcess(SDK_ROOT)
  if (active && active.pid !== process.pid && processIsRunning(active.pid)) {
    throw new Error(
      `Stop the active Termweave ${active.command} process (PID ${active.pid}) before updating`,
    )
  }

  await runRequired(sdkGitCommand('fetch', 'origin', 'main'), SDK_CHECKOUT_ROOT, 'SDK fetch')
  await runRequired(sdkGitCommand('reset', '--hard', 'origin/main'), SDK_CHECKOUT_ROOT, 'SDK reset')
  await runRequired(
    sdkGitCommand('clean', '-fd', '-e', '.termweave-git/'),
    SDK_CHECKOUT_ROOT,
    'SDK generated-file cleanup',
  )
  await runRequired(
    ['bun', 'install', '--frozen-lockfile'],
    SDK_ROOT,
    'SDK dependency installation',
  )
  await runRequired(
    ['bun', 'install', '--frozen-lockfile'],
    resolve(SDK_ROOT, 'sidecar'),
    'Sidecar dependency installation',
  )

  const projectPackagePath = resolve(projectRoot, 'package.json')
  const templatePackagePath = resolve(SDK_ROOT, 'templates/project/package.json')
  const projectPackage = JSON.parse(await readFile(projectPackagePath, 'utf8')) as JsonObject
  const templatePackage = JSON.parse(await readFile(templatePackagePath, 'utf8')) as JsonObject
  const mergedPackage = mergeManagedPackage(projectPackage, templatePackage)
  await writeFile(projectPackagePath, `${JSON.stringify(mergedPackage, null, 2)}\n`)
  await runRequired(['bun', 'install'], projectRoot, 'Project dependency installation')
  await runRequired(
    ['bunx', 'prettier', '--write', 'package.json'],
    projectRoot,
    'Project package formatting',
  )

  await syncProject(projectRoot)
  await runRequired(['bun', 'run', 'config:sync'], SDK_ROOT, 'App configuration sync')
  process.stdout.write('Termweave SDK updated from origin/main and project state reapplied.\n')
}

async function main() {
  const command = process.argv[2]
  const projectRoot = resolve(process.env.TERMWEAVE_PROJECT_ROOT ?? process.cwd())
  validateProjectLocation(projectRoot)
  await migrateLegacyGitDirectory()
  await validateProjectContext(projectRoot)

  if (command === 'sync') {
    await syncProject(projectRoot)
    return
  }
  if (command === 'dev') {
    process.exitCode = await runDevelopment(projectRoot)
    return
  }
  if (command === 'build') {
    process.exitCode = await runBuild(projectRoot)
    return
  }
  if (command === 'update') {
    await runUpdate(projectRoot)
    return
  }

  throw new Error('Usage: bun termweave/sdk/scripts/project.ts <sync|dev|build|update>')
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
