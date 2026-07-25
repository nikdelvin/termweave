import { resolve } from 'node:path'
import { runCli, runRequired } from '../lib/process'

const SDK_ROOT = resolve(import.meta.dir, '../..')

async function runCaptured(command: string[], cwd: string) {
  const subprocess = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let output = ''

  async function forward(stream: ReadableStream<Uint8Array>, target: NodeJS.WriteStream) {
    const decoder = new TextDecoder()
    const reader = stream.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })
      output += text
      target.write(text)
    }

    const remaining = decoder.decode()
    output += remaining
    target.write(remaining)
  }

  const [exitCode] = await Promise.all([
    subprocess.exited,
    forward(subprocess.stdout, process.stdout),
    forward(subprocess.stderr, process.stderr),
  ])

  return { exitCode, output }
}

export async function buildApp(root = SDK_ROOT) {
  const tauriCliPath = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js')
  if (!(await Bun.file(tauriCliPath).exists())) {
    throw new Error('Tauri CLI is not installed; run bun install first')
  }

  const buildCommand = [process.execPath, tauriCliPath, 'build']
  const firstBuild = await runCaptured(buildCommand, root)
  if (firstBuild.exitCode === 0) return

  const hasStalePermissionCache =
    firstBuild.output.includes('failed to read plugin permissions:') &&
    /[\\/]target[\\/].*[\\/]permissions[\\/]/s.test(firstBuild.output)
  if (!hasStalePermissionCache) {
    throw new Error(`Tauri build failed with exit code ${firstBuild.exitCode}`)
  }

  process.stderr.write(
    '\nDetected stale Tauri permission metadata after a project path change. Cleaning Cargo artifacts and retrying once...\n',
  )
  await runRequired(
    ['cargo', 'clean', '--manifest-path', resolve(root, 'src-tauri/Cargo.toml')],
    root,
    'Cargo artifact cleanup',
  )

  const retry = await runCaptured(buildCommand, root)
  if (retry.exitCode !== 0) {
    throw new Error(`Tauri build retry failed with exit code ${retry.exitCode}`)
  }
}

if (import.meta.main) runCli(() => buildApp())
