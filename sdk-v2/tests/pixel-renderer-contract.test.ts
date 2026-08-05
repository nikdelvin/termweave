import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import type { PixelRendererProps, TermweaveConfig } from '#termweave'

const moduleRoot = new URL('../app/termweave/', import.meta.url)

describe('local termweave module contract', () => {
  test('has exactly the required runtime and type export surface', async () => {
    const termweave = await import('#termweave')
    expect(Object.keys(termweave).sort()).toEqual(['PixelRenderer', 'getTermweaveConfig'])

    const index = await readFile(new URL('index.ts', moduleRoot), 'utf8')
    expect(index.trim()).toBe(
      [
        "export { PixelRenderer, type PixelRendererProps } from './PixelRenderer'",
        '',
        "export { getTermweaveConfig, type TermweaveConfig } from '../../shared/config'",
      ].join('\n'),
    )

    const props = {
      uri: '/tmp/example.png',
      width: '100%',
      height: 10,
    } satisfies PixelRendererProps
    const config: Readonly<TermweaveConfig> = termweave.getTermweaveConfig()
    expect(props.uri).toBe('/tmp/example.png')
    expect(config.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  test('pins the exact decoder dependency versions', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> }
    expect(packageJson.dependencies).toMatchObject({
      '@jimp/core': '1.6.1',
      '@jimp/js-jpeg': '1.6.1',
      '@jimp/js-png': '1.6.1',
      'gifuct-js': '2.1.2',
    })
  })

  test('uses only direct native pixel drawing and contains no excluded image architecture', async () => {
    const implementation = (
      await Promise.all(
        ['crt-palette.ts', 'image.ts', 'PixelRenderer.tsx', 'index.ts'].map((file) =>
          readFile(new URL(file, moduleRoot), 'utf8'),
        ),
      )
    ).join('\n')

    expect(implementation).toContain('ptr(frame.data)')
    expect(implementation).toContain('drawSuperSampleBuffer(')
    expect(implementation).toContain("'rgba8unorm'")
    expect(implementation).toContain('frame.width * 4')
    expect(implementation).toContain('pushScissorRect(')
    expect(implementation).toContain('finally')
    expect(implementation).toContain('applyCrtPalette(data, background)')
    expect(implementation).toContain('rgb333Lookup')

    for (const forbidden of [
      /OptimizedBuffer\.create/,
      /drawFrameBuffer/,
      /drawPackedBuffer/,
      /quadrant/i,
      /preload/i,
      /\bcache\b/i,
      /\bfetch\s*\(/,
      /WebSocket/i,
      /FFmpeg/i,
      /\baudio\b/i,
      /media clock/i,
    ]) {
      expect(implementation).not.toMatch(forbidden)
    }
  })

  test('uses the Phase 5 module and bundled GIF without adding Phase 6 routes', async () => {
    const appIndex = await readFile(new URL('../app/index.tsx', import.meta.url), 'utf8')
    expect(appIndex).toContain("from '#termweave'")
    expect(appIndex).toContain("from './assets/campfire.gif' with { type: 'file' }")
    expect(appIndex).toContain('<PixelRenderer uri={campfireUri} width="100%" height="100%">')
    expect(appIndex).toContain('</PixelRenderer>')
    expect(appIndex).not.toContain('HomeRoute')
    expect(appIndex).not.toContain('GalleryRoute')
    expect(await Array.fromAsync(new Bun.Glob('app/routes/**').scan('.'))).toEqual([])
    expect(await Array.fromAsync(new Bun.Glob('app/assets/**').scan('.'))).toEqual([
      'app/assets/campfire.gif',
    ])
  })
})
