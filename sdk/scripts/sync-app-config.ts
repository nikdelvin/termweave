import { relative, resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { format, resolveConfig } from 'prettier'

type AppBuilderConfig = {
  name: string
  description: string
  packageName: string
  bundleIdentifier: string
  version: string
  authors: string[]
  windowWidth: number
  windowHeight: number
  fontSize: number
  showDiagnostics: boolean
  themeColor: string
  foregroundColor: string
  icon: string
}

type JsonObject = Record<string, unknown>

const root = resolve(import.meta.dir, '..')
const configPath = resolve(root, 'app.config.json')

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

function requirePositiveInteger(value: unknown, path: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    fail(`${path} must be a positive integer`)
  }
  return Number(value)
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

function parseConfig(value: unknown): AppBuilderConfig {
  const config = requireObject(value, 'root')

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

  const windowWidth = requirePositiveInteger(config.windowWidth, 'windowWidth')
  const windowHeight = requirePositiveInteger(config.windowHeight, 'windowHeight')
  if (windowWidth * 9 !== windowHeight * 16) {
    fail('windowWidth and windowHeight must use an exact 16:9 aspect ratio')
  }

  const fontSize = requirePositiveNumber(config.fontSize, 'fontSize')
  const cols = windowWidth / fontSize
  const rows = windowHeight / fontSize
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    fail(
      `fontSize ${fontSize} produces a non-integer ${cols}x${rows} grid at ${windowWidth}x${windowHeight}`,
    )
  }

  return {
    name: requireString(config.name, 'name'),
    description: requireString(config.description, 'description'),
    packageName,
    bundleIdentifier,
    version,
    authors,
    windowWidth,
    windowHeight,
    fontSize,
    showDiagnostics: requireBoolean(config.showDiagnostics, 'showDiagnostics'),
    themeColor: requireHexColor(config.themeColor, 'themeColor'),
    foregroundColor: requireHexColor(config.foregroundColor, 'foregroundColor'),
    icon: requireString(config.icon, 'icon'),
  }
}

async function requireFile(path: string, configKey: string) {
  if (!(await Bun.file(resolve(root, path)).exists())) {
    fail(`${configKey} points to missing file: ${path}`)
  }
}

async function writeIfChanged(path: string, content: string) {
  const current = await readFile(path, 'utf8').catch(() => undefined)
  if (current === content) return false
  await writeFile(path, content)
  return true
}

function replaceTomlValue(content: string, section: string, key: string, value: string) {
  const sectionHeader = `[${section}]`
  const sectionStart = content.indexOf(sectionHeader)
  if (sectionStart < 0) throw new Error(`Missing ${sectionHeader} in src-tauri/Cargo.toml`)

  const nextSection = content.indexOf('\n[', sectionStart + sectionHeader.length)
  const sectionEnd = nextSection < 0 ? content.length : nextSection
  const sectionContent = content.slice(sectionStart, sectionEnd)
  const linePattern = new RegExp(`^${key}\\s*=.*$`, 'm')
  if (!linePattern.test(sectionContent)) {
    throw new Error(`Missing ${key} in ${sectionHeader} in src-tauri/Cargo.toml`)
  }

  const updatedSection = sectionContent.replace(linePattern, `${key} = ${value}`)
  return content.slice(0, sectionStart) + updatedSection + content.slice(sectionEnd)
}

function replaceBunRootWorkspaceName(content: string, packageName: string) {
  const rootWorkspaceName = /("workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*)"(?:[^"\\]|\\.)*"/

  if (!rootWorkspaceName.test(content)) {
    throw new Error('Could not find workspaces[""].name in bun.lock')
  }

  return content.replace(
    rootWorkspaceName,
    (_, prefix: string) => `${prefix}${JSON.stringify(packageName)}`,
  )
}

const rawConfig = JSON.parse(await readFile(configPath, 'utf8')) as unknown
const config = parseConfig(rawConfig)

await requireFile(config.icon, 'icon')

const cols = config.windowWidth / config.fontSize
const rows = config.windowHeight / config.fontSize
const crateName = `${config.packageName.replaceAll('-', '_')}_lib`

const tauriPath = resolve(root, 'src-tauri/tauri.conf.json')
const tauriConfig = JSON.parse(await readFile(tauriPath, 'utf8')) as {
  productName: string
  version: string
  identifier: string
  app: { windows: Array<JsonObject> }
  bundle: JsonObject & { icon?: string[] }
}
const mainWindow = tauriConfig.app.windows[0]
if (!mainWindow) throw new Error('src-tauri/tauri.conf.json must define a main window')
tauriConfig.productName = config.name
tauriConfig.version = config.version
tauriConfig.identifier = config.bundleIdentifier
Object.assign(mainWindow, {
  title: config.name,
  width: config.windowWidth,
  height: config.windowHeight,
  visible: false,
  backgroundColor: config.themeColor,
})
tauriConfig.bundle.icon = [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.icns',
  'icons/icon.ico',
]

const packagePath = resolve(root, 'package.json')
const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as JsonObject
packageJson.name = config.packageName
packageJson.version = config.version
packageJson.description = config.description

const bunLockPath = resolve(root, 'bun.lock')
const bunLock = await readFile(bunLockPath, 'utf8')
const updatedBunLock = replaceBunRootWorkspaceName(bunLock, config.packageName)

const cargoPath = resolve(root, 'src-tauri/Cargo.toml')
let cargoToml = await readFile(cargoPath, 'utf8')
cargoToml = replaceTomlValue(cargoToml, 'package', 'name', JSON.stringify(config.packageName))
cargoToml = replaceTomlValue(cargoToml, 'package', 'version', JSON.stringify(config.version))
cargoToml = replaceTomlValue(
  cargoToml,
  'package',
  'description',
  JSON.stringify(config.description),
)
cargoToml = replaceTomlValue(cargoToml, 'package', 'authors', JSON.stringify(config.authors))
cargoToml = replaceTomlValue(cargoToml, 'lib', 'name', JSON.stringify(crateName))

const rustMainPath = resolve(root, 'src-tauri/src/main.rs')
const rustMain = await readFile(rustMainPath, 'utf8')
const updatedRustMain = rustMain.replace(
  /^\s*[a-zA-Z_][a-zA-Z0-9_]*::run\(\)$/m,
  `    ${crateName}::run()`,
)
if (updatedRustMain === rustMain && !rustMain.includes(`${crateName}::run()`)) {
  throw new Error('Could not update the Tauri library name in src-tauri/src/main.rs')
}

const htmlPath = resolve(root, 'index.html')
const html = await readFile(htmlPath, 'utf8')
const escapedHtmlTitle = config.name
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
const updatedHtml = html
  .replace(/<title>.*?<\/title>/, `<title>${escapedHtmlTitle}</title>`)
  .replace(/(<meta name="theme-color" content=")[^"]*(" \/>)/, `$1${config.themeColor}$2`)
  .replace(/(<div id="terminal" aria-label=")[^"]*(")/, `$1${escapedHtmlTitle} terminal$2`)

const cssPath = resolve(root, 'src/styles.css')
const css = await readFile(cssPath, 'utf8')
const updatedCss = css
  .replace(/(--theme-color:\s*)#[0-9A-Fa-f]{6}/, `$1${config.themeColor}`)
  .replace(/(--foreground-color:\s*)#[0-9A-Fa-f]{6}/, `$1${config.foregroundColor}`)

const prettierConfig = (await resolveConfig(configPath)) ?? {}
const [formattedTauriConfig, formattedPackageJson, formattedHtml, formattedCss] = await Promise.all(
  [
    format(JSON.stringify(tauriConfig), { ...prettierConfig, filepath: tauriPath }),
    format(JSON.stringify(packageJson), { ...prettierConfig, filepath: packagePath }),
    format(updatedHtml, { ...prettierConfig, filepath: htmlPath }),
    format(updatedCss, { ...prettierConfig, filepath: cssPath }),
  ],
)

const outputs: Array<[string, string]> = [
  [tauriPath, formattedTauriConfig],
  [packagePath, formattedPackageJson],
  [bunLockPath, updatedBunLock],
  [cargoPath, cargoToml],
  [rustMainPath, updatedRustMain],
  [htmlPath, formattedHtml],
  [cssPath, formattedCss],
]

const changed: string[] = []
for (const [path, content] of outputs) {
  if (await writeIfChanged(path, content)) changed.push(relative(root, path))
}

const status = changed.length === 0 ? 'already synchronized' : `updated ${changed.join(', ')}`
process.stdout.write(
  `App config ${status}; ${config.fontSize}px -> ${cols}x${rows} at ${config.windowWidth}x${config.windowHeight}.\n`,
)
