import { describe, expect, test } from 'bun:test'
import { discoverActivatedWebglCanvas } from '../termweave/host/crt-effects/crt-postprocessor'

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

    const terminalIntegration = await read('termweave/host/crt-effects/crt-renderer.ts')
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

  test('uses the backpressure-aware native stdout feed and initializes the raw canvas background', async () => {
    const sidecar = await read('termweave/sidecar-runtime.tsx')
    const postprocessor = await read('termweave/host/crt-effects/crt-postprocessor.ts')
    const opentuiChunks = await Array.fromAsync(
      new Bun.Glob('node_modules/@opentui/core/chunk-bun-*.js').scan('.'),
    )
    const opentuiSources = await Promise.all(opentuiChunks.map(read))
    const rendererSources = opentuiSources.filter((source) =>
      source.includes('this._usesProcessStdout = stdout === process.stdout;'),
    )
    expect(rendererSources).toHaveLength(1)
    const opentui = rendererSources[0]!

    expect(sidecar).toContain('const nativeFeedStdout = {')
    expect(sidecar).toContain('write: process.stdout.write.bind(process.stdout)')
    expect(sidecar).toContain('stdout: nativeFeedStdout')
    expect(sidecar).not.toContain('stdout: process.stdout')
    expect(opentui).toContain('this._usesProcessStdout = stdout === process.stdout;')
    expect(opentui).toContain(
      'const useFeedOutput = !this._usesProcessStdout && !useMemoryBufferedOutput;',
    )
    expect(opentui).toContain('feed = NativeSpanFeed.create();')
    expect(opentui).toContain('this.realStdoutWrite.call(this.stdout, bytes, () => resolve());')
    expect(opentui).toContain('if (this._feed?.isBackpressured()) {')
    expect(postprocessor).toContain('function clearRenderSurfaces(')
    expect(postprocessor).toContain('for (const framebuffer of [targetFramebuffer, null])')
    expect(postprocessor).toContain('canvas.style.backgroundColor = themeColor')
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
      await read('termweave/host/crt-effects/crt-renderer.ts'),
      await read('termweave/host/crt-effects/crt-postprocessor.ts'),
      await read('termweave/host/crt-effects/crt-optics.ts'),
      await read('termweave/host/crt-effects/glyph-atlas.ts'),
    ].join('\n')
    expect(integration).not.toContain("from '@xterm/xterm/src")
    expect(integration).not.toContain("from '@xterm/addon-webgl/src")
    expect(integration).not.toContain('readPixels')
    expect(integration).not.toContain('preserveDrawingBuffer: true')
    expect(integration).not.toContain("createElement('canvas')")
    expect(integration).not.toContain('drawImage')
    expect(integration.match(/blitFramebuffer\(/g)).toHaveLength(1)
  })

  test('keeps application mouse tracking disabled without installing a remapping layer', async () => {
    const sidecar = await read('termweave/sidecar-runtime.tsx')
    const terminal = await read('termweave/host/xterm-terminal.ts')
    const postprocessor = await read('termweave/host/crt-effects/crt-postprocessor.ts')
    expect(sidecar).toContain('useMouse: false')
    expect(sidecar).toContain('enableMouseMovement: false')
    expect(terminal).toContain('attachCustomWheelEventHandler')
    expect(postprocessor).not.toMatch(/mousedown|mousemove|mouseup|contextmenu|auxclick/)
  })
})
