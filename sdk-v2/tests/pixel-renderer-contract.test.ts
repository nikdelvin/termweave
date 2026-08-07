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

  test('uses the final native Solid screen template without a router or patch', async () => {
    const appFiles = await Promise.all(
      [
        'app/App.tsx',
        'app/app-store.ts',
        'app/screens.ts',
        'app/components/ScreenControls.tsx',
        'app/screens/HomeScreen.tsx',
        'app/screens/GalleryScreen.tsx',
        'app/screens/PlainScreen.tsx',
      ].map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')),
    )
    const implementation = appFiles.join('\n')
    const appIndex = await readFile(new URL('../app/index.tsx', import.meta.url), 'utf8')
    const packageJson = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    const lockfile = await readFile(new URL('../bun.lock', import.meta.url), 'utf8')

    expect(appIndex).toContain("import { App } from './App'")
    expect(appIndex).toContain("createReadStream('/dev/fd/0', {")
    expect(appIndex).toContain('autoClose: true')
    expect(appIndex).toContain('stdin: sidecarStdin')
    expect(appIndex).not.toContain('stdin: process.stdin')
    expect(appIndex).toContain('await render(() => <App />, renderer)')
    expect(implementation).toContain('export type ScreenKey = keyof typeof screens')
    expect(implementation).toContain('export const screen: Accessor<ScreenKey> = activeScreen')
    expect(implementation).toContain('export function navigate(destination: ScreenKey)')
    expect(implementation).toContain('<Dynamic component={screens[screen()]} />')
    expect(implementation.match(/useKeyboard\(/g)).toHaveLength(1)
    expect(implementation.match(/<PixelRenderer /g)).toHaveLength(2)
    expect(appFiles[6]).not.toContain('PixelRenderer')
    expect(implementation).toContain("from '../assets/campfire.gif' with { type: 'file' }")
    expect(implementation).toContain("from '../assets/gallery.png' with { type: 'file' }")
    expect(appFiles[1]).not.toMatch(/KeyEvent|useKeyboard|keybinding|binding/i)
    expect(appFiles[2]).toContain("import { HomeScreen } from './screens/HomeScreen'")
    expect(implementation).not.toMatch(/MemoryRouter|useNavigate|createContext|@solidjs\/router/)
    expect(packageJson).not.toContain('@solidjs/router')
    expect(lockfile).not.toContain('@solidjs/router')
    expect(await Array.fromAsync(new Bun.Glob('app/routes/**').scan('.'))).toEqual([])
    expect(await Array.fromAsync(new Bun.Glob('app/navigation.ts').scan('.'))).toEqual([])
    expect(await Array.fromAsync(new Bun.Glob('patches/**').scan('.'))).toEqual([])
    expect((await Array.fromAsync(new Bun.Glob('app/assets/**').scan('.'))).sort()).toEqual([
      'app/assets/campfire.gif',
      'app/assets/gallery.png',
    ])
  })
})
