import rawAppConfig from '../app.config.json'

export const terminalSurface = Object.freeze({ width: 2560, height: 1440 } as const)

export type TerminalGrid = Readonly<{
  cols: number
  rows: number
  fontSize: number
  width: 2560
  height: 1440
}>

export type AppConfig = Readonly<{
  name: string
  description: string
  packageName: string
  bundleIdentifier: string
  version: string
  authors: readonly string[]
  fontSize: number
  backgroundColor: string
  foregroundColor: string
  monitorOverlay: boolean
  crtEffects: boolean
  icon: string
  terminalGrid: TerminalGrid
}>

export interface TermweaveConfig {
  readonly backgroundColor: string
  readonly foregroundColor: string
  readonly terminalGrid: TerminalGrid
}

type JsonObject = Record<string, unknown>

const packageNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const bundleIdentifierPattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/
const semanticVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const colorPattern = /^#[0-9A-Fa-f]{6}$/
const uriSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/
const windowsDrivePattern = /^[A-Za-z]:\//

let cachedAppConfig: AppConfig | undefined
let cachedTermweaveConfig: Readonly<TermweaveConfig> | undefined

function fail(message: string): never {
  throw new Error(`Invalid app.config.json: ${message}`)
}

function requireObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('root must be an object')
  }
  return value as JsonObject
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${field} must be a non-empty string`)
  }
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(`${field} must be a boolean`)
  return value
}

function requireColor(value: unknown, field: string): string {
  const color = requireString(value, field)
  if (!colorPattern.test(color)) {
    fail(`${field} must be a six-digit hexadecimal color such as #010416`)
  }
  return color
}

function requireIconPath(value: unknown): string {
  const icon = requireString(value, 'icon').replaceAll('\\', '/')
  if (icon.startsWith('/') || windowsDrivePattern.test(icon) || uriSchemePattern.test(icon)) {
    fail('icon must be a project-relative path')
  }

  const segments: string[] = []
  for (const segment of icon.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) fail('icon must not escape the project root')
      segments.pop()
    } else {
      segments.push(segment)
    }
  }

  const normalizedIcon = segments.join('/')
  if (normalizedIcon === '') fail('icon must be a non-empty project-relative path')
  if (!/\.(?:png|svg)$/i.test(normalizedIcon)) {
    fail('icon must point to a PNG or SVG file')
  }
  return normalizedIcon
}

export function parseAppConfig(value: unknown): AppConfig {
  const config = requireObject(value)

  const packageName = requireString(config.packageName, 'packageName')
  if (!packageNamePattern.test(packageName)) {
    fail('packageName must be lowercase kebab case and start with a letter')
  }

  const bundleIdentifier = requireString(config.bundleIdentifier, 'bundleIdentifier')
  if (!bundleIdentifierPattern.test(bundleIdentifier)) {
    fail('bundleIdentifier must be a reverse-domain identifier with at least two segments')
  }

  const version = requireString(config.version, 'version')
  if (!semanticVersionPattern.test(version)) {
    fail('version must be a valid three-part semantic version such as 1.0.0')
  }

  if (!Array.isArray(config.authors) || config.authors.length === 0) {
    fail('authors must contain at least one author')
  }
  const authors = Object.freeze(
    config.authors.map((author, index) => requireString(author, `authors[${index}]`)),
  )

  if (typeof config.fontSize !== 'number' || !Number.isFinite(config.fontSize)) {
    fail('fontSize must be a finite number greater than zero')
  }
  if (config.fontSize <= 0) fail('fontSize must be greater than zero')

  const cols = terminalSurface.width / config.fontSize
  const rows = terminalSurface.height / config.fontSize
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    fail(
      `fontSize ${config.fontSize} must divide the fixed ${terminalSurface.width}x${terminalSurface.height} terminal surface into whole columns and rows`,
    )
  }

  const terminalGrid: TerminalGrid = Object.freeze({
    cols,
    rows,
    fontSize: config.fontSize,
    width: terminalSurface.width,
    height: terminalSurface.height,
  })

  return Object.freeze({
    name: requireString(config.name, 'name'),
    description: requireString(config.description, 'description'),
    packageName,
    bundleIdentifier,
    version,
    authors,
    fontSize: config.fontSize,
    backgroundColor: requireColor(config.backgroundColor, 'backgroundColor'),
    foregroundColor: requireColor(config.foregroundColor, 'foregroundColor'),
    monitorOverlay: requireBoolean(config.monitorOverlay, 'monitorOverlay'),
    crtEffects: requireBoolean(config.crtEffects, 'crtEffects'),
    icon: requireIconPath(config.icon),
    terminalGrid,
  })
}

export function getAppConfig(): AppConfig {
  cachedAppConfig ??= parseAppConfig(rawAppConfig)
  return cachedAppConfig
}

export function getTermweaveConfig(): Readonly<TermweaveConfig> {
  const config = getAppConfig()
  cachedTermweaveConfig ??= Object.freeze({
    backgroundColor: config.backgroundColor,
    foregroundColor: config.foregroundColor,
    terminalGrid: config.terminalGrid,
  })
  return cachedTermweaveConfig
}
