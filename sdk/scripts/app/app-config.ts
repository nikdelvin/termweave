import { readFile } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { TERMINAL_SURFACE } from '../../shared/terminal-config'

export type AppBuilderConfig = {
  name: string
  description: string
  packageName: string
  bundleIdentifier: string
  version: string
  authors: string[]
  fontSize: number
  showDiagnostics: boolean
  backgroundColor: string
  foregroundColor: string
  monitorOverlay: boolean
  crtEffects: boolean
  icon: string
}

export type LoadedAppConfig = {
  config: AppBuilderConfig
  configPath: string
  iconPath: string
}

type JsonObject = Record<string, unknown>

const RESERVED_ICON_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'scripts',
  'shared',
  'sidecar',
  'src',
  'src-tauri',
  'template',
  'termweave',
])

function fail(message: string): never {
  throw new Error(`Invalid app.config.json: ${message}`)
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireObject(value: unknown, path: string): JsonObject {
  if (!isObject(value)) fail(`${path} must be an object`)
  return value
}

function requireString(value: unknown, path: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${path} must be a non-empty string`)
  }
  return value
}

function requirePositiveNumber(value: unknown, path: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${path} must be a positive number`)
  }
  return value
}

function requireBoolean(value: unknown, path: string) {
  if (typeof value !== 'boolean') fail(`${path} must be a boolean`)
  return value
}

function requireHexColor(value: unknown, path: string) {
  const color = requireString(value, path)
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    fail(`${path} must be a six-digit hex color such as #181A1B`)
  }
  return color
}

function requireCurrentConfigSchema(config: JsonObject) {
  if (config.monitorOverlay !== undefined) return

  fail(
    'this project uses an outdated configuration schema and is missing monitorOverlay.\n\n' +
      `Update your project's app.config.json before continuing. Use this updated configuration as a starting point:\n\n` +
      `${JSON.stringify({ ...config, monitorOverlay: true }, null, 2)}\n\n` +
      'After saving the configuration, rerun `bun run update` or the command that reported this error.',
  )
}

export function parseAppConfig(value: unknown): AppBuilderConfig {
  const config = requireObject(value, 'root')
  requireCurrentConfigSchema(config)

  const packageName = requireString(config.packageName, 'packageName')
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(packageName)) {
    fail('packageName must be a lowercase kebab-case package name starting with a letter')
  }

  const bundleIdentifier = requireString(config.bundleIdentifier, 'bundleIdentifier')
  if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleIdentifier)) {
    fail('bundleIdentifier must be a reverse-domain identifier')
  }

  const version = requireString(config.version, 'version')
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail('version must be a semantic version such as 1.0.0')
  }

  if (!Array.isArray(config.authors) || config.authors.length === 0) {
    fail('authors must contain at least one author')
  }
  const authors = config.authors.map((author, index) => requireString(author, `authors[${index}]`))

  const fontSize = requirePositiveNumber(config.fontSize, 'fontSize')
  const cols = TERMINAL_SURFACE.width / fontSize
  const rows = TERMINAL_SURFACE.height / fontSize
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    fail(
      `fontSize ${fontSize} produces a non-integer ${cols}x${rows} grid on the fixed ` +
        `${TERMINAL_SURFACE.width}x${TERMINAL_SURFACE.height} terminal surface`,
    )
  }

  return {
    name: requireString(config.name, 'name'),
    description: requireString(config.description, 'description'),
    packageName,
    bundleIdentifier,
    version,
    authors,
    fontSize,
    showDiagnostics: requireBoolean(config.showDiagnostics, 'showDiagnostics'),
    backgroundColor: requireHexColor(config.backgroundColor, 'backgroundColor'),
    foregroundColor: requireHexColor(config.foregroundColor, 'foregroundColor'),
    monitorOverlay: requireBoolean(config.monitorOverlay, 'monitorOverlay'),
    crtEffects: requireBoolean(config.crtEffects, 'crtEffects'),
    icon: requireString(config.icon, 'icon'),
  }
}

export function resolveAppIcon(root: string, icon: string) {
  const normalizedIcon = icon.split(sep).join('/')
  if (!['.svg', '.png'].includes(extname(normalizedIcon).toLowerCase())) {
    fail('icon must point to an SVG or PNG file')
  }

  const topLevelDirectory = normalizedIcon.split('/')[0]
  if (topLevelDirectory && RESERVED_ICON_DIRECTORIES.has(topLevelDirectory)) {
    fail(`icon may not be stored under the reserved ${topLevelDirectory}/ directory`)
  }

  const iconPath = resolve(root, normalizedIcon)
  const pathFromRoot = relative(root, iconPath)
  if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
    fail('icon must be a project-relative path inside the project root')
  }

  return { icon: normalizedIcon, iconPath }
}

export async function readAppConfig(root: string) {
  const configPath = resolve(root, 'app.config.json')
  const config = parseAppConfig(JSON.parse(await readFile(configPath, 'utf8')) as unknown)
  const icon = resolveAppIcon(root, config.icon)
  return { config: { ...config, icon: icon.icon }, configPath, iconPath: icon.iconPath }
}

export async function loadAppConfig(root: string): Promise<LoadedAppConfig> {
  const loaded = await readAppConfig(root)
  if (!(await Bun.file(loaded.iconPath).exists())) {
    fail(`icon points to missing file: ${loaded.config.icon}`)
  }
  return loaded
}
