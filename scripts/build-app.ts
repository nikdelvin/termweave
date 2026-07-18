import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const tauriCliPath = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js')
const cargoManifestPath = resolve(root, 'src-tauri/Cargo.toml')

if (!(await Bun.file(tauriCliPath).exists())) {
  throw new Error('Tauri CLI is not installed; run bun install first')
}

async function run(command: string[]) {
  const subprocess = Bun.spawn(command, {
    cwd: root,
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

const buildCommand = [process.execPath, tauriCliPath, 'build']
const firstBuild = await run(buildCommand)

if (firstBuild.exitCode === 0) process.exit(0)

const hasStalePermissionCache =
  firstBuild.output.includes('failed to read plugin permissions:') &&
  /[\\/]target[\\/].*[\\/]permissions[\\/]/s.test(firstBuild.output)

if (!hasStalePermissionCache) process.exit(firstBuild.exitCode)

process.stderr.write(
  '\nDetected stale Tauri permission metadata after a project path change. Cleaning Cargo artifacts and retrying once...\n',
)

const clean = Bun.spawn(['cargo', 'clean', '--manifest-path', cargoManifestPath], {
  cwd: root,
  stdout: 'inherit',
  stderr: 'inherit',
})

const cleanExitCode = await clean.exited
if (cleanExitCode !== 0) process.exit(cleanExitCode)

const retry = await run(buildCommand)
process.exit(retry.exitCode)
