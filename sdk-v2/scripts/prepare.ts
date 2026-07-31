import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { parseAppConfig, type AppConfig } from '../shared/config'

const projectRoot = resolve(import.meta.dir, '..')

export const desktopIconFiles = [
  '32x32.png',
  '128x128.png',
  '128x128@2x.png',
  'icon.icns',
  'icon.ico',
] as const

export type GenerateIcons = (options: {
  root: string
  iconPath: string
  outputDirectory: string
}) => Promise<void>

type PrepareOptions = {
  root?: string
  generateIcons?: GenerateIcons
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

async function generateTauriIcons({
  root,
  iconPath,
  outputDirectory,
}: Parameters<GenerateIcons>[0]): Promise<void> {
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

function createOverride(config: AppConfig) {
  return {
    productName: config.name,
    version: config.version,
    identifier: config.bundleIdentifier,
    app: {
      windows: [
        {
          label: 'main',
          title: config.name,
          backgroundColor: config.backgroundColor,
        },
      ],
    },
    bundle: {
      icon: desktopIconFiles.map((icon) => `.generated/icons/${icon}`),
    },
  }
}

export async function prepareProject({
  root = projectRoot,
  generateIcons = generateTauriIcons,
}: PrepareOptions = {}) {
  const config = await loadConfig(root)
  const iconPath = await resolveIcon(root, config)
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

    await writeFile(overridePath, `${JSON.stringify(createOverride(config), null, 2)}\n`)
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
