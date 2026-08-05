import { describe, expect, test } from 'bun:test'
import { discoverActivatedWebglCanvas } from '../src/crt-postprocessor'

const project = new URL('../', import.meta.url)
const read = (path: string) => Bun.file(new URL(path, project)).text()

describe('pinned stock xterm WebGL source contract', () => {
  test('pins the exact public packages without changing the lock contract', async () => {
    const packageJson = JSON.parse(await read('package.json')) as {
      dependencies: Record<string, string>
    }
    expect(packageJson.dependencies['@xterm/addon-webgl']).toBe('0.19.0')
    expect(packageJson.dependencies['@xterm/xterm']).toBe('6.0.0')
    const lock = await read('bun.lock')
    expect(lock).toContain('"@xterm/addon-webgl": "0.19.0"')
    expect(lock).toContain('"@xterm/xterm": "6.0.0"')
    const installedAddon = JSON.parse(
      await read('node_modules/@xterm/addon-webgl/package.json'),
    ) as { version: string }
    const installedXterm = JSON.parse(await read('node_modules/@xterm/xterm/package.json')) as {
      version: string
    }
    expect(installedAddon.version).toBe('0.19.0')
    expect(installedXterm.version).toBe('6.0.0')
  })

  test('uses preserveDrawingBuffer false and exposes no addon framebuffer hook', async () => {
    const addon = await read('node_modules/@xterm/addon-webgl/src/WebglAddon.ts')
    const renderer = await read('node_modules/@xterm/addon-webgl/src/WebglRenderer.ts')
    expect(addon).toContain('private _preserveDrawingBuffer?: boolean')
    expect(renderer).toContain('preserveDrawingBuffer\n    };')
    expect(addon).not.toContain('bindFramebuffer')
    expect(renderer).not.toContain('bindFramebuffer')

    const terminalIntegration = await read('src/terminal.ts')
    expect(terminalIntegration).toContain('new WebglAddon(false)')
  })

  test('renders rows before public onRender synchronously', async () => {
    const renderService = await read(
      'node_modules/@xterm/xterm/src/browser/services/RenderService.ts',
    )
    const renderRows = renderService.indexOf('_renderer.value.renderRows(start, end)')
    const publicOnRender = renderService.indexOf('_onRender.fire({ start, end })')
    expect(renderRows).toBeGreaterThan(-1)
    expect(publicOnRender).toBeGreaterThan(renderRows)
  })

  test('stock restoration rebuilds state before scheduling its redraw', async () => {
    const renderer = await read('node_modules/@xterm/addon-webgl/src/WebglRenderer.ts')
    const restoration = renderer.indexOf("'webglcontextrestored'")
    const initialize = renderer.indexOf('this._initializeWebGLState()', restoration)
    const redraw = renderer.indexOf('this._requestRedrawViewport()', restoration)
    expect(restoration).toBeGreaterThan(-1)
    expect(initialize).toBeGreaterThan(restoration)
    expect(redraw).toBeGreaterThan(initialize)
  })

  test('registers Termweave render and restoration listeners only after stock activation', async () => {
    const terminal = await read('src/terminal.ts')
    const postprocessor = await read('src/crt-postprocessor.ts')
    const stockActivation = terminal.indexOf('terminal.loadAddon(addon)')
    const postprocessorConstruction = terminal.indexOf('postprocessor = new CrtPostprocessor')
    const contextRestoredListener = postprocessor.indexOf(
      "canvas.addEventListener('webglcontextrestored'",
    )
    const renderListener = postprocessor.indexOf('terminal.onRender(')
    expect(stockActivation).toBeGreaterThan(-1)
    expect(postprocessorConstruction).toBeGreaterThan(stockActivation)
    expect(contextRestoredListener).toBeGreaterThan(-1)
    expect(renderListener).toBeGreaterThan(contextRestoredListener)
  })

  test('registers the window reveal gate after CRT renderer setup', async () => {
    const main = await read('src/main.ts')
    const rendererSetup = main.indexOf('renderer = enableWebglRenderer(terminal, config)')
    const sessionSetup = main.indexOf('session = createTerminalSession({')
    expect(rendererSetup).toBeGreaterThan(-1)
    expect(sessionSetup).toBeGreaterThan(rendererSetup)
  })

  test('uses the backpressure-aware native stdout feed and initializes the raw canvas background', async () => {
    const app = await read('app/index.tsx')
    const postprocessor = await read('src/crt-postprocessor.ts')
    const opentuiChunks = await Array.fromAsync(
      new Bun.Glob('node_modules/@opentui/core/chunk-bun-*.js').scan('.'),
    )
    const opentuiSources = await Promise.all(opentuiChunks.map(read))
    const rendererSources = opentuiSources.filter((source) =>
      source.includes('this._usesProcessStdout = stdout === process.stdout;'),
    )
    expect(rendererSources).toHaveLength(1)
    const opentui = rendererSources[0]!

    expect(app).toContain('const nativeFeedStdout = {')
    expect(app).toContain('write: process.stdout.write.bind(process.stdout)')
    expect(app).toContain('stdout: nativeFeedStdout')
    expect(app).not.toContain('stdout: process.stdout')
    expect(opentui).toContain('this._usesProcessStdout = stdout === process.stdout;')
    expect(opentui).toContain(
      'const useFeedOutput = !this._usesProcessStdout && !useMemoryBufferedOutput;',
    )
    expect(opentui).toContain('feed = NativeSpanFeed.create();')
    expect(opentui).toContain('this.realStdoutWrite.call(this.stdout, bytes, () => resolve());')
    expect(opentui).toContain('if (this._feed?.isBackpressured()) {')
    expect(postprocessor).toContain('function clearRenderSurfaces(')
    expect(postprocessor).toContain('for (const framebuffer of [targetFramebuffer, null])')
    expect(postprocessor).toContain('canvas.style.backgroundColor = backgroundColor')
    expect(postprocessor).not.toMatch(/2026|synchronizedOutputEnd/)
  })

  test('stock renderers reselect their own programs and vertex state', async () => {
    const rectangles = await read('node_modules/@xterm/addon-webgl/src/RectangleRenderer.ts')
    const glyphs = await read('node_modules/@xterm/addon-webgl/src/GlyphRenderer.ts')
    for (const source of [rectangles, glyphs]) {
      expect(source).toContain('.useProgram(')
      expect(source).toContain('.bindVertexArray(')
    }
  })

  test('reacquires the context from exactly one newly added descendant canvas', () => {
    const identity = {} as WebGL2RenderingContext
    const existing = { getContext: () => null } as unknown as HTMLCanvasElement
    const webglCanvas = {
      getContext(type: string) {
        expect(type).toBe('webgl2')
        return identity
      },
    } as unknown as HTMLCanvasElement
    const otherNewCanvas = { getContext: () => null } as unknown as HTMLCanvasElement
    const element = {
      querySelectorAll: () => [existing, webglCanvas, otherNewCanvas],
    } as unknown as HTMLElement

    expect(discoverActivatedWebglCanvas(element, new Set([existing]))).toEqual({
      canvas: webglCanvas,
      gl: identity,
    })
    expect(() => discoverActivatedWebglCanvas(element, new Set([existing, webglCanvas]))).toThrow(
      'found 0',
    )
  })

  test('shipping code contains no private imports, readback, capture, or extra render surface', async () => {
    const integration = [
      await read('src/terminal.ts'),
      await read('src/crt-postprocessor.ts'),
      await read('src/crt-optics.ts'),
      await read('src/glyph-atlas.ts'),
    ].join('\n')
    expect(integration).not.toContain("from '@xterm/xterm/src")
    expect(integration).not.toContain("from '@xterm/addon-webgl/src")
    expect(integration).not.toContain('readPixels')
    expect(integration).not.toContain('preserveDrawingBuffer: true')
    expect(integration).not.toContain("createElement('canvas')")
    expect(integration).not.toContain('drawImage')
    expect(integration.match(/blitFramebuffer\(/g)).toHaveLength(1)
  })

  test('keeps custom glyphs and recycles the stock addon before atlas exhaustion', async () => {
    const terminal = await read('src/terminal.ts')
    const atlas = await read('src/glyph-atlas.ts')
    expect(terminal).toContain('customGlyphs: true')
    expect(terminal).toContain('new WebglAddon(false)')
    expect(terminal).toContain('createGlyphAtlasMonitor')
    expect(terminal).toContain('disposeGeneration()')
    expect(terminal).toContain('activateGeneration()')
    expect(terminal).not.toContain('clearTextureAtlas(')
    expect(atlas).toContain('GLYPH_ATLAS_PAGE_RESERVE = 4')
    expect(atlas).toContain('pages.size < glyphAtlasRecyclePageThreshold(maximumPages)')
    expect(atlas).toContain('scheduled !== undefined')
  })

  test('keeps application mouse tracking disabled without installing a remapping layer', async () => {
    const app = await read('app/index.tsx')
    const terminal = await read('src/terminal.ts')
    const postprocessor = await read('src/crt-postprocessor.ts')
    expect(app).toContain('useMouse: false')
    expect(app).toContain('enableMouseMovement: false')
    expect(terminal).toContain('attachCustomWheelEventHandler')
    expect(postprocessor).not.toMatch(/mousedown|mousemove|mouseup|contextmenu|auxclick/)
  })

  test('keeps the GIF full-screen behind the interactive RGB edge-test screen', async () => {
    const app = await read('app/index.tsx')
    expect(app).toContain("from '#termweave'")
    expect(app).toContain("import campfireUri from './assets/campfire.gif' with { type: 'file' }")
    expect(app).toContain('<PixelRenderer uri={campfireUri} width="100%" height="100%">')
    expect(app).toContain('</PixelRenderer>')
    expect(app).toContain('WHITE PHOSPHOR / RGB EDGE TEST')
    expect(app).toContain('CENTER REFERENCE')
    expect(app.match(/borderStyle="heavy"/g)).toHaveLength(3)
    expect(app).toContain('━━━━━━╋━━━━━━')
    expect(app).toContain('USE LEFT / RIGHT ARROWS TO CHANGE')
    expect(app).toContain('VALUE: {count()}')
    expect(app).toContain('useKeyboard((key) =>')
    expect(app).toContain('setCount((value) => value - 1)')
    expect(app).toContain('setCount((value) => value + 1)')
  })
})
