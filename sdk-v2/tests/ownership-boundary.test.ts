import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dir, '..')
const componentRoot = resolve(projectRoot, 'termweave/components')

async function sourceFiles(pattern: string) {
  return Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: projectRoot, onlyFiles: true }))
}

describe('Termweave ownership boundaries', () => {
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

  test('pins decoders and excludes unsupported media architecture', async () => {
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
        [
          '../host/crt-effects/crt-palette.ts',
          'image-source.ts',
          'pixel-frame.ts',
          'image-decoder.ts',
          'image-playback.ts',
          'image-controller.ts',
          'PixelRenderer.tsx',
        ].map((file) => readFile(resolve(componentRoot, file), 'utf8')),
      )
    ).join('\n')
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

  test('keeps dedicated starter media and excludes routing compatibility layers', async () => {
    const lockfile = await readFile(resolve(projectRoot, 'bun.lock'), 'utf8')

    expect(lockfile).not.toContain('@solidjs/router')
    expect(await sourceFiles('app/routes/**')).toEqual([])
    expect(await sourceFiles('patches/**')).toEqual([])
    expect((await sourceFiles('app/assets/**')).sort()).toEqual([
      'app/assets/campfire.gif',
      'app/assets/campfire.png',
    ])
  })
})
