import { copyFile, mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { loadAppConfig, readAppConfig, resolveAppIcon } from '../app/app-config'

function normalizeRelativePath(path: string) {
  return path.split(sep).join('/')
}

export function isSdkManagedSidecarSource(path: string) {
  const normalizedPath = normalizeRelativePath(path)
  return (
    normalizedPath === 'index.tsx' ||
    normalizedPath === 'runtime' ||
    normalizedPath.startsWith('runtime/')
  )
}

export function resolveWithinRoot(root: string, path: string) {
  const destination = resolve(root, path)
  const pathFromRoot = relative(root, destination)
  if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Path escapes its expected root: ${path}`)
  }
  return destination
}

async function listSourceFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Project source may not contain symbolic links: ${relative(root, absolutePath)}`,
      )
    }
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(root, absolutePath)))
    } else if (entry.isFile()) {
      files.push(normalizeRelativePath(relative(root, absolutePath)))
    }
  }

  return files.sort()
}

export async function readSourceTreeState(projectRoot: string) {
  const projectSource = resolve(projectRoot, 'src')
  const files = await listSourceFiles(projectSource)
  // Copying can update access metadata and emit macOS watcher events, so only
  // track metadata that changes when a source file is actually edited.
  const entries = await Promise.all(
    files.map(async (file) => {
      const metadata = await stat(resolveWithinRoot(projectSource, file))
      return [file, metadata.size, metadata.mtimeMs, metadata.ctimeMs] as const
    }),
  )

  return JSON.stringify(entries)
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

export async function synchronizeSourceTree(projectRoot: string, sdkRoot: string) {
  const projectSource = resolve(projectRoot, 'src')
  const sdkSource = resolve(sdkRoot, 'sidecar/src')
  const appComponent = resolve(projectSource, 'App.tsx')

  if (!(await Bun.file(appComponent).exists())) {
    throw new Error(`Missing project entry component: ${appComponent}`)
  }

  const files = await listSourceFiles(projectSource)
  const managedSource = files.find(isSdkManagedSidecarSource)
  if (managedSource) {
    throw new Error(
      `src/${managedSource} is managed by the Termweave SDK and cannot be synchronized from the project`,
    )
  }

  const currentFiles = new Set(files)
  for (const staleFile of await listSourceFiles(sdkSource)) {
    if (isSdkManagedSidecarSource(staleFile) || currentFiles.has(staleFile)) continue
    const staleDestination = resolveWithinRoot(sdkSource, staleFile)
    await rm(staleDestination, { force: true })
    await removeEmptyParents(staleDestination, sdkSource)
  }

  for (const file of files) {
    const destination = resolveWithinRoot(sdkSource, file)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(resolveWithinRoot(projectSource, file), destination)
  }

  return files
}

export async function syncProject(projectRoot: string, sdkRoot: string) {
  projectRoot = resolve(projectRoot)
  sdkRoot = resolve(sdkRoot)

  const previousConfig = await readAppConfig(sdkRoot).catch(() => undefined)
  const { config, configPath, iconPath } = await loadAppConfig(projectRoot)
  const files = await synchronizeSourceTree(projectRoot, sdkRoot)

  await copyFile(configPath, resolve(sdkRoot, 'app.config.json'))
  if (previousConfig && previousConfig.config.icon !== config.icon) {
    const previousIcon = resolveAppIcon(sdkRoot, previousConfig.config.icon).iconPath
    await rm(previousIcon, { force: true })
    await removeEmptyParents(previousIcon, sdkRoot)
  }

  const sdkIcon = resolveWithinRoot(sdkRoot, config.icon)
  await mkdir(dirname(sdkIcon), { recursive: true })
  await copyFile(iconPath, sdkIcon)

  process.stdout.write(
    `Synchronized ${files.length} project source file${files.length === 1 ? '' : 's'}, app.config.json, and ${config.icon}.\n`,
  )
  return { files, icon: config.icon }
}
