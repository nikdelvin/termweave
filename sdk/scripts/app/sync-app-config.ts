import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { format, resolveConfig } from 'prettier'
import { TERMINAL_SURFACE } from '../../shared/terminal-config'
import { loadAppConfig } from './app-config'
import { runCli } from '../lib/process'

type JsonObject = Record<string, unknown>

const SDK_ROOT = resolve(import.meta.dir, '../..')

async function writeIfChanged(path: string, content: string) {
  const current = await readFile(path, 'utf8').catch(() => undefined)
  if (current === content) return false
  await writeFile(path, content)
  return true
}

function replaceRequired(
  content: string,
  pattern: RegExp,
  replacement: string,
  description: string,
) {
  const updated = content.replace(pattern, replacement)
  if (updated === content && !pattern.test(content)) {
    throw new Error(`Could not update ${description}`)
  }
  return updated
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

export function replaceBunRootWorkspaceName(content: string, packageName: string) {
  const rootWorkspaceName = /("workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*)"(?:[^"\\]|\\.)*"/
  if (!rootWorkspaceName.test(content)) {
    throw new Error('Could not find workspaces[""].name in bun.lock')
  }

  return content.replace(
    rootWorkspaceName,
    (_, prefix: string) => `${prefix}${JSON.stringify(packageName)}`,
  )
}

export async function syncAppConfig(root = SDK_ROOT) {
  const { config, configPath } = await loadAppConfig(root)
  const cols = TERMINAL_SURFACE.width / config.fontSize
  const rows = TERMINAL_SURFACE.height / config.fontSize
  const crateName = `${config.packageName.replaceAll('-', '_')}_lib`

  const tauriPath = resolve(root, 'src-tauri/tauri.conf.json')
  const tauriConfig = JSON.parse(await readFile(tauriPath, 'utf8')) as {
    productName: string
    version: string
    identifier: string
    app: { windows: Array<JsonObject> }
  }
  const mainWindow = tauriConfig.app.windows[0]
  if (!mainWindow) throw new Error('src-tauri/tauri.conf.json must define a main window')
  tauriConfig.productName = config.name
  tauriConfig.version = config.version
  tauriConfig.identifier = config.bundleIdentifier
  Object.assign(mainWindow, {
    title: config.name,
    width: TERMINAL_SURFACE.width,
    height: TERMINAL_SURFACE.height,
    backgroundColor: config.backgroundColor,
  })

  const packagePath = resolve(root, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as JsonObject
  packageJson.name = config.packageName
  packageJson.version = config.version
  packageJson.description = config.description

  const bunLockPath = resolve(root, 'bun.lock')
  const updatedBunLock = replaceBunRootWorkspaceName(
    await readFile(bunLockPath, 'utf8'),
    config.packageName,
  )

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
  let updatedHtml = await readFile(htmlPath, 'utf8')
  const escapedHtmlTitle = config.name
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
  updatedHtml = replaceRequired(
    updatedHtml,
    /<title>.*?<\/title>/,
    `<title>${escapedHtmlTitle}</title>`,
    'the HTML title',
  )
  updatedHtml = replaceRequired(
    updatedHtml,
    /(<meta name="theme-color" content=")[^"]*(" \/>)/,
    `$1${config.backgroundColor}$2`,
    'the HTML theme color',
  )
  updatedHtml = replaceRequired(
    updatedHtml,
    /(<style id="initial-paint">[\s\S]*?background:\s*)#[0-9A-Fa-f]{6}/,
    `$1${config.backgroundColor}`,
    'the initial background color',
  )
  updatedHtml = replaceRequired(
    updatedHtml,
    /(<div id="terminal" aria-label=")[^"]*(")/,
    `$1${escapedHtmlTitle} terminal$2`,
    'the terminal accessibility label',
  )

  const cssPath = resolve(root, 'src/styles.css')
  let updatedCss = await readFile(cssPath, 'utf8')
  updatedCss = replaceRequired(
    updatedCss,
    /(--background-color:\s*)#[0-9A-Fa-f]{6}/,
    `$1${config.backgroundColor}`,
    'the CSS background color',
  )
  updatedCss = replaceRequired(
    updatedCss,
    /(--foreground-color:\s*)#[0-9A-Fa-f]{6}/,
    `$1${config.foregroundColor}`,
    'the CSS foreground color',
  )

  const prettierConfig = (await resolveConfig(configPath)) ?? {}
  const [formattedTauriConfig, formattedPackageJson, formattedHtml, formattedCss] =
    await Promise.all([
      format(JSON.stringify(tauriConfig), { ...prettierConfig, filepath: tauriPath }),
      format(JSON.stringify(packageJson), { ...prettierConfig, filepath: packagePath }),
      format(updatedHtml, { ...prettierConfig, filepath: htmlPath }),
      format(updatedCss, { ...prettierConfig, filepath: cssPath }),
    ])

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
    `App config ${status}; ${config.fontSize}px -> ${cols}x${rows} on the fixed ` +
      `${TERMINAL_SURFACE.width}x${TERMINAL_SURFACE.height} terminal surface.\n`,
  )

  return changed
}

if (import.meta.main) runCli(() => syncAppConfig())
