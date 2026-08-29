import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import * as ts from 'typescript'

const projectRoot = resolve(import.meta.dir, '..')
const termweaveRoot = resolve(projectRoot, 'termweave')
const mediaRoot = resolve(termweaveRoot, 'media')
const allowedMediaEdges: Readonly<Record<string, readonly string[]>> = {
  source: [],
  frame: [],
  ffmpeg: ['source', 'frame'],
  playback: ['source', 'frame', 'ffmpeg'],
  audio: ['playback'],
  controller: ['source', 'frame', 'ffmpeg', 'playback', 'audio'],
  PixelRenderer: ['controller', 'frame'],
}

async function sourceFiles(pattern: string) {
  return Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: projectRoot, onlyFiles: true }))
}

function runtimeImportSpecifiers(source: string) {
  const file = ts.createSourceFile(
    'ownership.tsx',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  )
  const specifiers: string[] = []
  const add = (node: ts.Expression | undefined) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text)
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const hasRuntimeBinding =
        !clause ||
        (!clause.isTypeOnly &&
          (Boolean(clause.name) ||
            !bindings ||
            ts.isNamespaceImport(bindings) ||
            bindings.elements.length === 0 ||
            bindings.elements.some((element) => !element.isTypeOnly)))
      if (hasRuntimeBinding) add(node.moduleSpecifier)
    } else if (ts.isExportDeclaration(node)) {
      const exports = node.exportClause
      const hasRuntimeBinding =
        !node.isTypeOnly &&
        (!exports ||
          ts.isNamespaceExport(exports) ||
          exports.elements.length === 0 ||
          exports.elements.some((element) => !element.isTypeOnly))
      if (hasRuntimeBinding) add(node.moduleSpecifier)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return specifiers
}

function runtimeImportGraph(sources: ReadonlyMap<string, string>) {
  const graph = new Map<string, string[]>()
  for (const [file, source] of sources) {
    const dependencies: string[] = []
    for (const specifier of runtimeImportSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue
      const base = relative(projectRoot, resolve(projectRoot, dirname(file), specifier))
      const candidates = extname(base)
        ? [base]
        : [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
      const dependency = candidates.find((candidate) => sources.has(candidate))
      if (dependency) dependencies.push(dependency)
    }
    graph.set(file, dependencies)
  }
  return graph
}

function assertAcyclicRuntimeImports(sources: ReadonlyMap<string, string>) {
  const graph = runtimeImportGraph(sources)
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
}

function validateMediaEdges(sources: ReadonlyMap<string, string>) {
  for (const [file, source] of sources) {
    const importer = basename(file, extname(file))
    for (const specifier of runtimeImportSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue
      const imported = resolve(projectRoot, dirname(file), specifier)
      if (imported !== termweaveRoot && !imported.startsWith(`${termweaveRoot}/`)) {
        throw new Error(`Media module ${importer} imports outside Termweave: ${specifier}.`)
      }
      if (imported !== mediaRoot && !imported.startsWith(`${mediaRoot}/`)) continue
      const dependency = basename(imported, extname(imported))
      if (!allowedMediaEdges[importer]?.includes(dependency)) {
        throw new Error(`Illegal media ownership edge: ${importer} imports ${dependency}.`)
      }
    }
  }
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
      for (const specifier of runtimeImportSpecifiers(source)) {
        if (file.startsWith('app/') && file !== 'app/index.tsx') {
          expect(specifier, file).not.toMatch(/(?:^|\/)termweave(?:\/|$)/)
        }
        if (file.startsWith('termweave/') && specifier.startsWith('.')) {
          const imported = resolve(projectRoot, dirname(file), specifier)
          expect(imported, file).not.toStartWith(`${resolve(projectRoot, 'app')}/`)
        }
      }
    }

    assertAcyclicRuntimeImports(sources)
  })

  test('keeps the FFmpeg media pipeline layered and dependency-free', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
    }
    for (const dependency of ['@jimp/core', '@jimp/js-jpeg', '@jimp/js-png', 'gifuct-js']) {
      expect(packageJson.dependencies).not.toHaveProperty(dependency)
    }

    const mediaFiles = (await sourceFiles('termweave/media/**/*.{ts,tsx}')).sort()
    const mediaModules = mediaFiles.map((file) => basename(file, extname(file)))
    expect(mediaModules, 'Every media module must have an explicit ownership rule.').toEqual(
      Object.keys(allowedMediaEdges).sort(),
    )
    expect(await sourceFiles('termweave/components/**')).toEqual([])
    validateMediaEdges(
      new Map(
        await Promise.all(
          mediaFiles.map(
            async (file) => [file, await readFile(resolve(projectRoot, file), 'utf8')] as const,
          ),
        ),
      ),
    )
  })

  test('enforces side-effect, export, and dynamic runtime edges without type-only false positives', () => {
    expect(
      runtimeImportSpecifiers(`
        import value from './ordinary'
        export { value } from './exported'
        import './side-effect'
        void import('./dynamic')
        import type { TypeImport } from './type-import'
        import { type InlineType } from './inline-type-import'
        export type { TypeExport } from './type-export'
        export { type InlineExport } from './inline-type-export'
        type Query = import('./type-query').Query
      `),
    ).toEqual(['./ordinary', './exported', './side-effect', './dynamic'])

    expect(() =>
      validateMediaEdges(new Map([['termweave/media/source.ts', "import './controller'"]])),
    ).toThrow('Illegal media ownership edge: source imports controller.')

    expect(() =>
      assertAcyclicRuntimeImports(
        new Map([
          ['termweave/media/source.ts', "import './frame'"],
          ['termweave/media/frame.ts', "void import('./source')"],
        ]),
      ),
    ).toThrow('Runtime import cycle')
  })

  test('keeps dedicated starter media and excludes routing compatibility layers', async () => {
    const lockfile = await readFile(resolve(projectRoot, 'bun.lock'), 'utf8')

    expect(lockfile).not.toContain('@solidjs/router')
    expect(await sourceFiles('app/routes/**')).toEqual([])
    expect(await sourceFiles('app/components/**')).toEqual([])
    expect(await sourceFiles('tests/fixtures.ts')).toEqual([])
    expect(await sourceFiles('patches/**')).toEqual([])
    expect((await sourceFiles('app/assets/**')).sort()).toEqual([
      'app/assets/campfire.gif',
      'app/assets/campfire.png',
    ])
  })
})
