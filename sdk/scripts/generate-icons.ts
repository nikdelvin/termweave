import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const configPath = resolve(root, 'app.config.json')
const config = JSON.parse(await readFile(configPath, 'utf8')) as { icon?: unknown }

if (typeof config.icon !== 'string' || config.icon.trim() === '') {
  throw new Error('Invalid app.config.json: icon must be a non-empty string')
}

const sourcePath = resolve(root, config.icon)
if (!(await Bun.file(sourcePath).exists())) {
  throw new Error(`Invalid app.config.json: icon points to missing file: ${config.icon}`)
}

const tauriCliPath = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js')
if (!(await Bun.file(tauriCliPath).exists())) {
  throw new Error('Tauri CLI is not installed; run bun install first')
}

const outputPath = resolve(root, 'src-tauri/icons')
const subprocess = Bun.spawn(
  [process.execPath, tauriCliPath, 'icon', sourcePath, '--output', outputPath],
  {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  },
)

const exitCode = await subprocess.exited
if (exitCode !== 0) process.exit(exitCode)

await Promise.all([
  rm(resolve(outputPath, 'android'), { recursive: true, force: true }),
  rm(resolve(outputPath, 'ios'), { recursive: true, force: true }),
])
