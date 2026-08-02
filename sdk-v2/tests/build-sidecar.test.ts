import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildProductionSidecar, getSidecarOutputPath } from '../scripts/build-sidecar'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'termweave-sidecar-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('production sidecar build', () => {
  test('uses Tauri external-binary names for macOS and Windows targets', () => {
    expect(getSidecarOutputPath('/sdk', 'aarch64-apple-darwin', 'darwin')).toBe(
      '/sdk/src-tauri/binaries/opentui-sidecar-aarch64-apple-darwin',
    )
    expect(getSidecarOutputPath('/sdk', 'x86_64-apple-darwin', 'darwin')).toBe(
      '/sdk/src-tauri/binaries/opentui-sidecar-x86_64-apple-darwin',
    )
    expect(getSidecarOutputPath('/sdk', 'x86_64-pc-windows-msvc', 'win32')).toBe(
      '/sdk/src-tauri/binaries/opentui-sidecar-x86_64-pc-windows-msvc.exe',
    )
  })

  test('uses the production entry, Solid plugin, and target-suffixed output', async () => {
    let buildOptions: Parameters<typeof Bun.build>[0] | undefined
    const outputPath = await buildProductionSidecar({
      root,
      triple: 'aarch64-apple-darwin',
      platform: 'darwin',
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
      'process.env.DEBUG': 'undefined',
      'process.env.NODE_ENV': '"production"',
    })
    expect(buildOptions?.plugins).toHaveLength(1)
  })

  test('surfaces Bun build diagnostics without fallback behavior', async () => {
    await expect(
      buildProductionSidecar({
        root,
        triple: 'aarch64-apple-darwin',
        build: async () => ({
          success: false,
          logs: ['app/index.tsx: unexpected token', 'build stopped'],
        }),
      }),
    ).rejects.toThrow(
      'OpenTUI sidecar build failed:\napp/index.tsx: unexpected token\nbuild stopped',
    )
  })
})
