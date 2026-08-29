import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { parseAppConfig, type AppConfig } from '../termweave/config'
import {
  BUNDLED_MEDIA_ROOT_DIRECTORY,
  FFMPEG_RESOURCE_DIRECTORY,
  OPENTUI_ASSET_ROOT_DIRECTORY,
} from '../termweave/constants'
import { getFfmpegResourceDirectory } from './build-ffmpeg'
import { errorMessage } from './tooling'

const projectRoot = resolve(import.meta.dir, '..')

export const desktopIconFiles = [
  '32x32.png',
  '128x128.png',
  '128x128@2x.png',
  'icon.icns',
  'icon.ico',
] as const

export type IconGenerator = (options: {
  root: string
  iconPath: string
  outputDirectory: string
}) => Promise<void>

type PrepareOptions = {
  root?: string
  generateIcons?: IconGenerator
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
}

export type OpenTuiNativeLibrary = Readonly<{
  packageName: string
  fileName: string
  sourcePath: string
  resourcePath: string
}>

export type BundledMediaAsset = Readonly<{
  sourcePath: string
  resourcePath: string
}>

const supportedBundledMediaExtension = /\.(?:gif|jpe?g|mp4|png)$/i

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
}

async function loadConfig(root: string): Promise<AppConfig> {
  const configPath = resolve(root, 'app.config.json')
  let source: string
  try {
    source = await readFile(configPath, 'utf8')
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') {
      throw new Error(`Missing app.config.json at ${configPath}`)
    }
    throw new Error(`Could not read app.config.json: ${errorMessage(error)}`)
  }

  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    throw new Error('Invalid app.config.json: expected valid JSON')
  }
  return parseAppConfig(value)
}

async function resolveIcon(root: string, config: AppConfig): Promise<string> {
  const iconPath = resolve(root, config.icon)
  let iconStats
  try {
    iconStats = await stat(iconPath)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') {
      throw new Error(`Invalid app.config.json: icon file does not exist: ${config.icon}`)
    }
    throw new Error(`Could not inspect configured icon ${config.icon}: ${errorMessage(error)}`)
  }
  if (!iconStats.isFile()) {
    throw new Error(`Invalid app.config.json: icon must point to a file: ${config.icon}`)
  }

  const [realRoot, realIconPath] = await Promise.all([realpath(root), realpath(iconPath)])
  if (!isInside(realRoot, realIconPath)) {
    throw new Error('Invalid app.config.json: icon must resolve inside the project root')
  }
  return iconPath
}

export function getOpenTuiNativeAsset(
  root: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): OpenTuiNativeLibrary {
  if (platform !== 'darwin' || (arch !== 'arm64' && arch !== 'x64')) {
    throw new Error(`Termweave v2 supports only macOS arm64 and x64, not ${platform}-${arch}`)
  }

  const packageName = `@opentui/core-${platform}-${arch}`
  const fileName = 'libopentui.dylib'
  return {
    packageName,
    fileName,
    sourcePath: resolve(root, 'node_modules', packageName, fileName),
    resourcePath: `${OPENTUI_ASSET_ROOT_DIRECTORY}/${packageName}/${fileName}`,
  }
}

async function requireOpenTuiNativeAsset(
  root: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
) {
  const asset = getOpenTuiNativeAsset(root, platform, arch)
  try {
    if (!(await stat(asset.sourcePath)).isFile()) throw new Error('not a file')
  } catch {
    throw new Error(
      `OpenTUI native runtime is missing: ${relative(root, asset.sourcePath)}; run \`bun install\` for ${platform}-${arch}`,
    )
  }
  return asset
}

export async function collectBundledMediaAssets(root: string): Promise<BundledMediaAsset[]> {
  const mediaRoot = resolve(root, 'app/media')
  let entries
  try {
    entries = await readdir(mediaRoot, { recursive: true, withFileTypes: true })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') return []
    throw error
  }

  const assets: BundledMediaAsset[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const sourcePath = resolve(entry.parentPath, entry.name)
    const mediaPath = relative(mediaRoot, sourcePath).replaceAll(sep, '/')
    if (!supportedBundledMediaExtension.test(mediaPath)) {
      throw new Error(
        `Unsupported bundled media file app/media/${mediaPath}; expected MP4, GIF, PNG, or JPEG.`,
      )
    }
    assets.push({
      sourcePath,
      resourcePath: `${BUNDLED_MEDIA_ROOT_DIRECTORY}/${mediaPath}`,
    })
  }
  return assets.sort((left, right) => left.resourcePath.localeCompare(right.resourcePath))
}

async function generateTauriIcons({
  root,
  iconPath,
  outputDirectory,
}: Parameters<IconGenerator>[0]): Promise<void> {
  const tauriCliPath = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js')
  try {
    const cliStats = await stat(tauriCliPath)
    if (!cliStats.isFile()) throw new Error('not a file')
  } catch {
    throw new Error('Tauri CLI is not installed; run `bun install` first')
  }

  const child = Bun.spawn(
    [process.execPath, tauriCliPath, 'icon', iconPath, '--output', outputDirectory],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) {
    const details = (stderr.trim() || stdout.trim()).split('\n').slice(-5).join('\n')
    throw new Error(`Tauri icon generation failed${details ? `:\n${details}` : ''}`)
  }
}

function createOverride(
  root: string,
  config: AppConfig,
  nativeAsset: OpenTuiNativeLibrary,
  mediaAssets: readonly BundledMediaAsset[],
) {
  const resources: Record<string, string> = {
    [nativeAsset.sourcePath]: nativeAsset.resourcePath,
    [getFfmpegResourceDirectory(root)]: FFMPEG_RESOURCE_DIRECTORY,
  }
  for (const asset of mediaAssets) resources[asset.sourcePath] = asset.resourcePath

  return {
    productName: config.name,
    version: config.version,
    identifier: config.bundleIdentifier,
    app: {
      windows: [
        {
          label: 'main',
          title: config.name,
          backgroundColor: config.themeColor,
        },
      ],
    },
    bundle: {
      icon: desktopIconFiles.map((icon) => `.generated/icons/${icon}`),
      externalBin: ['binaries/opentui-sidecar', 'binaries/ffmpeg'],
      resources,
    },
  }
}

export async function prepareProject({
  root = projectRoot,
  generateIcons = generateTauriIcons,
  platform = process.platform,
  arch = process.arch,
}: PrepareOptions = {}) {
  const config = await loadConfig(root)
  const iconPath = await resolveIcon(root, config)
  const nativeAsset = await requireOpenTuiNativeAsset(root, platform, arch)
  const mediaAssets = await collectBundledMediaAssets(root)
  const generatedDirectory = resolve(root, 'src-tauri/.generated')
  const iconOutputDirectory = resolve(generatedDirectory, 'icons')
  const overridePath = resolve(generatedDirectory, 'override.json')

  await rm(generatedDirectory, { recursive: true, force: true })
  await mkdir(iconOutputDirectory, { recursive: true })

  try {
    await generateIcons({ root, iconPath, outputDirectory: iconOutputDirectory })
    for (const icon of desktopIconFiles) {
      const generatedIcon = resolve(iconOutputDirectory, icon)
      try {
        const generatedIconStats = await stat(generatedIcon)
        if (!generatedIconStats.isFile()) throw new Error('not a file')
      } catch {
        throw new Error(`Icon generation did not produce ${icon}`)
      }
    }

    await writeFile(
      overridePath,
      `${JSON.stringify(createOverride(root, config, nativeAsset, mediaAssets), null, 2)}\n`,
    )
  } catch (error) {
    await rm(generatedDirectory, { recursive: true, force: true })
    throw error
  }

  return { config, generatedDirectory, iconOutputDirectory, overridePath }
}

if (import.meta.main) {
  try {
    await prepareProject()
    console.log('Prepared Tauri configuration and icons.')
  } catch (error) {
    console.error(errorMessage(error))
    process.exitCode = 1
  }
}
