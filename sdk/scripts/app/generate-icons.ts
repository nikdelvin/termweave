import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadAppConfig } from './app-config'
import { runCli, runRequired } from '../lib/process'

const SDK_ROOT = resolve(import.meta.dir, '../..')

export async function generateIcons(root = SDK_ROOT) {
  const { iconPath } = await loadAppConfig(root)
  const tauriCliPath = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js')
  if (!(await Bun.file(tauriCliPath).exists())) {
    throw new Error('Tauri CLI is not installed; run bun install first')
  }

  const outputPath = resolve(root, 'src-tauri/icons')
  await runRequired(
    [process.execPath, tauriCliPath, 'icon', iconPath, '--output', outputPath],
    root,
    'Tauri icon generation',
  )
  await Promise.all([
    rm(resolve(outputPath, 'android'), { recursive: true, force: true }),
    rm(resolve(outputPath, 'ios'), { recursive: true, force: true }),
  ])
}

if (import.meta.main) runCli(() => generateIcons())
