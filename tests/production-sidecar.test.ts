import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProductionSidecar } from '../scripts/build-sidecar'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const smokeTriple = 'production-smoke-apple-darwin'
const outputPath = resolve(projectRoot, `src-tauri/binaries/opentui-sidecar-${smokeTriple}`)

afterEach(async () => {
  await rm(outputPath, { force: true })
})

describe('compiled production sidecar', () => {
  test('boots with mutable environment access and a physical OpenTUI native library', async () => {
    const executable = await buildProductionSidecar({
      root: projectRoot,
      triple: smokeTriple,
      prepareFfmpeg: async () =>
        resolve(projectRoot, 'src-tauri/binaries/ffmpeg-aarch64-apple-darwin'),
    })
    const child = spawn(executable, [], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DEBUG: '',
        OTUI_ASSET_ROOT: resolve(projectRoot, 'node_modules'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let exitCode: number | null | undefined
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    const exited = new Promise<void>((resolveExit) => {
      child.once('exit', (code) => {
        exitCode = code
        resolveExit()
      })
    })

    try {
      const deadline = performance.now() + 10_000
      while (!stdout.includes('ANIMATION SCREEN') && performance.now() < deadline) {
        if (exitCode !== undefined) {
          throw new Error(`Production sidecar exited with ${String(exitCode)}: ${stderr}`)
        }
        await Bun.sleep(20)
      }
      expect(stdout).toContain('ANIMATION SCREEN')
      expect(stderr).toBe('')
    } finally {
      child.kill('SIGTERM')
      await Promise.race([exited, Bun.sleep(1_000)])
      if (exitCode === undefined) child.kill('SIGKILL')
      await exited
    }
  }, 20_000)
})
