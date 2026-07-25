import { watch, type FSWatcher } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { SIDECAR_RESTART_SIGNAL } from '../../shared/terminal-protocol'
import { mergeManagedPackage, type JsonObject } from '../packages/managed-package'
import { runCli, runRequired } from '../lib/process'
import { assertNoActiveProcess, withActiveProcess } from './active-process'
import {
  readSourceTreeState,
  resolveWithinRoot,
  synchronizeSourceTree,
  syncProject,
} from './source-sync'

const SDK_ROOT = resolve(import.meta.dir, '../..')
const SDK_CHECKOUT_ROOT = resolve(SDK_ROOT, '..')
const SDK_GIT_ROOT = resolve(SDK_CHECKOUT_ROOT, '.termweave-git')
const LEGACY_SDK_GIT_ROOT = resolve(SDK_CHECKOUT_ROOT, '.git')
const SDK_MARKER = '.termweave-sdk.json'
const SOURCE_SYNC_DELAY_MS = 80

async function pathExists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  )
}

function validateProjectLocation(projectRoot: string) {
  if (resolve(projectRoot, 'termweave/sdk') !== SDK_ROOT) {
    throw new Error(`Run this command from the standalone project root containing ${SDK_ROOT}`)
  }
}

async function migrateLegacyGitDirectory() {
  if ((await pathExists(SDK_GIT_ROOT)) || !(await pathExists(LEGACY_SDK_GIT_ROOT))) return
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
  for (const path of [
    resolve(projectRoot, 'app.config.json'),
    resolveWithinRoot(projectRoot, icon),
  ]) {
    const directory = dirname(path)
    const files = watchedDirectories.get(directory) ?? new Set<string>()
    files.add(basename(path))
    watchedDirectories.set(directory, files)
  }

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
  const initialSync = await syncProject(projectRoot, SDK_ROOT)

  return withActiveProcess(SDK_ROOT, 'dev', projectRoot, async () => {
    let syncTimer: ReturnType<typeof setTimeout> | undefined
    let syncRunning = false
    let syncQueued = false
    let restartSequence = 0
    let sourceState = await readSourceTreeState(projectRoot)

    const synchronizeSource = async () => {
      if (syncRunning) {
        syncQueued = true
        return
      }

      syncRunning = true
      try {
        do {
          syncQueued = false
          const nextSourceState = await readSourceTreeState(projectRoot)
          if (nextSourceState === sourceState) continue

          await synchronizeSourceTree(projectRoot, SDK_ROOT)
          sourceState = nextSourceState
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

    const closeWatchers = createProjectWatchers(projectRoot, initialSync.icon, scheduleSourceSync)
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
      await rm(resolve(SDK_ROOT, SIDECAR_RESTART_SIGNAL), { force: true })
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
  await syncProject(projectRoot, SDK_ROOT)

  return withActiveProcess(SDK_ROOT, 'build', projectRoot, async () => {
    await runRequired(['bun', 'run', 'app:build'], SDK_ROOT, 'Termweave build')
    await copyBuildOutputs(projectRoot)
    return 0
  })
}

async function runUpdate(projectRoot: string) {
  await assertNoActiveProcess(SDK_ROOT, 'Stop the active process before updating')
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
  const templateRoot = resolve(SDK_ROOT, 'template')
  const projectPackage = JSON.parse(await readFile(projectPackagePath, 'utf8')) as JsonObject
  const templatePackage = JSON.parse(
    await readFile(resolve(templateRoot, 'package.json'), 'utf8'),
  ) as JsonObject
  const mergedPackage = mergeManagedPackage(projectPackage, templatePackage)
  await cp(resolve(templateRoot, 'patches'), resolve(projectRoot, 'patches'), { recursive: true })
  await writeFile(projectPackagePath, `${JSON.stringify(mergedPackage, null, 2)}\n`)
  await runRequired(['bun', 'install'], projectRoot, 'Project dependency installation')
  await runRequired(
    ['bunx', 'prettier', '--write', 'package.json'],
    projectRoot,
    'Project package formatting',
  )

  await syncProject(projectRoot, SDK_ROOT)
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
    await syncProject(projectRoot, SDK_ROOT)
  } else if (command === 'dev') {
    process.exitCode = await runDevelopment(projectRoot)
  } else if (command === 'build') {
    process.exitCode = await runBuild(projectRoot)
  } else if (command === 'update') {
    await runUpdate(projectRoot)
  } else {
    throw new Error(
      'Usage: bun termweave/sdk/scripts/project/manage-project.ts <sync|dev|build|update>',
    )
  }
}

if (import.meta.main) runCli(main)
