import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import type { PixelRendererProps, TermweaveConfig } from '#termweave'

const projectRoot = resolve(import.meta.dir, '..')
const componentRoot = resolve(projectRoot, 'termweave/components')

async function sourceFiles(pattern: string) {
  return Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: projectRoot, onlyFiles: true }))
}

describe('termweave public module and ownership contract', () => {
  test('has exactly the required runtime export surface and narrow public configuration', async () => {
    const termweave = await import('#termweave')
    expect(Object.keys(termweave).sort()).toEqual(['PixelRenderer', 'getTermweaveConfig'])

    const props = {
      uri: '/tmp/example.png',
      width: '100%',
      height: 10,
    } satisfies PixelRendererProps
    const config: Readonly<TermweaveConfig> = termweave.getTermweaveConfig()
    expect(props.uri).toBe('/tmp/example.png')
    expect(config).toEqual({
      themeColor: '#010416',
      terminalForegroundColor: '#F59B5A',
    })
    expect(Object.keys(config).sort()).toEqual(['terminalForegroundColor', 'themeColor'])
  })

  test('enforces one visible SDK boundary and an acyclic runtime import graph', async () => {
    const files = (
      await Promise.all([sourceFiles('app/**/*.{ts,tsx}'), sourceFiles('termweave/**/*.{ts,tsx}')])
    )
      .flat()
      .sort()
    const sources = new Map(
      await Promise.all(
        files.map(
          async (file) => [file, await readFile(resolve(projectRoot, file), 'utf8')] as const,
        ),
      ),
    )

    for (const [file, source] of sources) {
      if (file.startsWith('app/') && file !== 'app/index.tsx') {
        expect(source, file).not.toMatch(/from ['"][^'"]*termweave\//)
        expect(source, file).not.toMatch(/from ['"]\.\.\/termweave/)
      }
      if (file.startsWith('termweave/')) {
        expect(source, file).not.toMatch(/from ['"][^'"]*\/app(?:\/|['"])/)
      }
    }

    const appIndex = sources.get('app/index.tsx')!
    expect(appIndex).toContain("import { App } from './App'")
    expect(appIndex).toContain("import { runTermweaveApp } from '../termweave/sidecar'")
    expect(appIndex).toContain('await runTermweaveApp(() => <App />)')

    const graph = new Map<string, string[]>()
    for (const [file, source] of sources) {
      const runtimeSource = source.replace(/import\s+type\b[\s\S]*?from\s+['"][^'"]+['"]/g, '')
      const imports = Array.from(
        runtimeSource.matchAll(/from\s+['"](\.[^'"]+)['"]/g),
        (match) => match[1]!,
      )
      const dependencies: string[] = []
      for (const specifier of imports) {
        const base = relative(projectRoot, resolve(projectRoot, dirname(file), specifier))
        const candidates = extname(base)
          ? [base]
          : [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
        const dependency = candidates.find((candidate) => sources.has(candidate))
        if (dependency) dependencies.push(dependency)
      }
      graph.set(file, dependencies)
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (file: string) => {
      if (visiting.has(file)) throw new Error(`Runtime import cycle at ${file}`)
      if (visited.has(file)) return
      visiting.add(file)
      for (const dependency of graph.get(file) ?? []) visit(dependency)
      visiting.delete(file)
      visited.add(file)
    }
    for (const file of graph.keys()) visit(file)
  })

  test('pins decoders and uses direct native pixel drawing without excluded media architecture', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
    }
    expect(packageJson.dependencies).toMatchObject({
      '@jimp/core': '1.6.1',
      '@jimp/js-jpeg': '1.6.1',
      '@jimp/js-png': '1.6.1',
      'gifuct-js': '2.1.2',
    })

    const implementation = (
      await Promise.all(
        ['crt-palette.ts', 'image.ts', 'PixelRenderer.tsx'].map((file) =>
          readFile(resolve(componentRoot, file), 'utf8'),
        ),
      )
    ).join('\n')
    expect(implementation).toContain('ptr(frame.data)')
    expect(implementation).toContain('drawSuperSampleBuffer(')
    expect(implementation).toContain("'rgba8unorm'")
    expect(implementation).toContain('pushScissorRect(')
    expect(implementation).toContain('applyCrtPalette(data, background)')

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

  test('keeps the native Solid examples, direct navigation, and deliberate icon reuse', async () => {
    const appFiles = await Promise.all(
      [
        'app/App.tsx',
        'app/app-store.ts',
        'app/screens.ts',
        'app/components/ScreenControls.tsx',
        'app/screens/HomeScreen.tsx',
        'app/screens/GalleryScreen.tsx',
        'app/screens/PlainScreen.tsx',
      ].map((file) => readFile(resolve(projectRoot, file), 'utf8')),
    )
    const implementation = appFiles.join('\n')
    const sidecar = await readFile(resolve(projectRoot, 'termweave/sidecar.tsx'), 'utf8')
    const lockfile = await readFile(resolve(projectRoot, 'bun.lock'), 'utf8')

    expect(sidecar).toContain("createReadStream('/dev/fd/0', {")
    expect(sidecar).toContain('stdin: sidecarStdin')
    expect(sidecar).not.toContain('stdin: process.stdin')
    expect(implementation).toContain('export type ScreenKey = keyof typeof screens')
    expect(implementation).toContain('export function navigate(destination: ScreenKey)')
    expect(implementation.match(/useKeyboard\(/g)).toHaveLength(1)
    expect(implementation.match(/<PixelRenderer /g)).toHaveLength(2)
    expect(appFiles[6]).not.toContain('PixelRenderer')
    expect(implementation).toContain("from '../assets/campfire.gif' with { type: 'file' }")
    expect(implementation).toContain("from '../../app.icon.png' with { type: 'file' }")
    expect(implementation).not.toMatch(/RGB EDGE TEST|CENTER REFERENCE|TOP LEFT/)
    expect(implementation).not.toMatch(/MemoryRouter|useNavigate|createContext|@solidjs\/router/)
    expect(lockfile).not.toContain('@solidjs/router')
    expect(await sourceFiles('app/routes/**')).toEqual([])
    expect(await sourceFiles('patches/**')).toEqual([])
    expect((await sourceFiles('app/assets/**')).sort()).toEqual(['app/assets/campfire.gif'])
  })
})
