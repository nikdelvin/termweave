import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildProductionSidecar,
  buildSidecarBinary,
  getSidecarBinaryPath,
} from '../scripts/build-sidecar'

let root = ''
const prepareFfmpeg = async (projectRoot: string, triple: string) =>
  resolve(projectRoot, `src-tauri/binaries/ffmpeg-${triple}`)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'termweave-sidecar-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('production sidecar build', () => {
  test('uses Tauri external-binary names for both macOS architectures', () => {
    expect(getSidecarBinaryPath('/sdk', 'aarch64-apple-darwin')).toBe(
      '/sdk/src-tauri/binaries/opentui-sidecar-aarch64-apple-darwin',
    )
    expect(getSidecarBinaryPath('/sdk', 'x86_64-apple-darwin')).toBe(
      '/sdk/src-tauri/binaries/opentui-sidecar-x86_64-apple-darwin',
    )
  })

  test('rejects non-macOS platforms and host tuples before building', async () => {
    await expect(
      buildProductionSidecar({
        root,
        triple: 'x86_64-pc-windows-msvc',
        platform: 'win32',
        build: async () => ({ success: true, logs: [] }),
      }),
    ).rejects.toThrow('support only macOS')
    await expect(
      buildProductionSidecar({
        root,
        triple: 'x86_64-unknown-linux-gnu',
        platform: 'darwin',
        build: async () => ({ success: true, logs: [] }),
      }),
    ).rejects.toThrow('requires an Apple Darwin host tuple')
  })

  test('uses the production entry and preserves mutable DEBUG environment access', async () => {
    let buildOptions: Parameters<typeof Bun.build>[0] | undefined
    const outputPath = await buildProductionSidecar({
      root,
      triple: 'aarch64-apple-darwin',
      platform: 'darwin',
      prepareFfmpeg,
      build: async (options) => {
        buildOptions = options
        return { success: true, logs: [] }
      },
    })

    expect(outputPath).toBe(
      resolve(root, 'src-tauri/binaries/opentui-sidecar-aarch64-apple-darwin'),
    )
    expect(buildOptions?.entrypoints).toEqual([resolve(root, 'app/index.tsx')])
    expect(buildOptions?.compile).toEqual({ outfile: outputPath })
    expect(buildOptions?.define).toEqual({
      'process.env.NODE_ENV': '"production"',
    })
    expect(buildOptions?.define).not.toHaveProperty('process.env.DEBUG')
    expect(buildOptions?.plugins).toHaveLength(1)
  })

  test('compiles the development launcher with the project and Bun paths', async () => {
    let buildOptions: Parameters<typeof Bun.build>[0] | undefined
    const outputPath = await buildSidecarBinary({
      mode: 'development',
      root,
      triple: 'aarch64-apple-darwin',
      platform: 'darwin',
      bunExecutable: '/opt/bun/bin/bun',
      prepareFfmpeg,
      build: async (options) => {
        buildOptions = options
        return { success: true, logs: [] }
      },
    })

    expect(buildOptions?.entrypoints).toEqual([resolve(root, 'scripts/development-launcher.ts')])
    expect(buildOptions?.compile).toEqual({ outfile: outputPath })
    expect(buildOptions?.define).toEqual({
      __TERMWEAVE_BUN_EXECUTABLE__: '"/opt/bun/bin/bun"',
      __TERMWEAVE_FFMPEG_PATH__: JSON.stringify(
        resolve(root, 'src-tauri/binaries/ffmpeg-aarch64-apple-darwin'),
      ),
      __TERMWEAVE_PROJECT_ROOT__: JSON.stringify(root),
    })
    expect(buildOptions?.plugins).toBeUndefined()
  })

  test('surfaces Bun build diagnostics without fallback behavior', async () => {
    await expect(
      buildProductionSidecar({
        root,
        triple: 'aarch64-apple-darwin',
        prepareFfmpeg,
        build: async () => ({
          success: false,
          logs: ['app/index.tsx: unexpected token', 'build stopped'],
        }),
      }),
    ).rejects.toThrow(
      'OpenTUI sidecar build failed:\napp/index.tsx: unexpected token\nbuild stopped',
    )
  })

  test('labels development launcher build failures', async () => {
    await expect(
      buildSidecarBinary({
        mode: 'development',
        root,
        triple: 'aarch64-apple-darwin',
        prepareFfmpeg,
        build: async () => ({ success: false, logs: ['launcher failed'] }),
      }),
    ).rejects.toThrow('Development launcher build failed:\nlauncher failed')
  })
})
