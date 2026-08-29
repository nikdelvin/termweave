import { describe, expect, test } from 'bun:test'
import type { Terminal } from '@xterm/xterm'
import {
  activateCrtRenderer,
  type WebglAddonPort,
} from '../termweave/host/crt-effects/crt-renderer'
import type { AnimationFrameScheduler } from '../termweave/host/crt-effects/glyph-atlas'
import { fakeWebglCanvas } from './support/rendering-fakes'

class ManualAnimationFrameScheduler implements AnimationFrameScheduler<number> {
  private readonly callbacks = new Map<number, () => void>()
  private nextHandle = 1

  request(callback: () => void) {
    const handle = this.nextHandle
    this.nextHandle += 1
    this.callbacks.set(handle, callback)
    return handle
  }

  cancel(handle: number) {
    this.callbacks.delete(handle)
  }

  flush() {
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const callback of callbacks) callback()
  }
}

class FakeWebglAddon implements WebglAddonPort {
  disposeCount = 0
  contextLossSubscriptionDisposeCount = 0
  private contextLossHandler: (() => void) | undefined

  activate() {}

  dispose() {
    this.disposeCount += 1
  }

  onContextLoss(handler: () => void) {
    this.contextLossHandler = handler
    return {
      dispose: () => {
        this.contextLossSubscriptionDisposeCount += 1
        this.contextLossHandler = undefined
      },
    }
  }

  loseContext() {
    const handler = this.contextLossHandler
    handler?.()
  }
}

class FakeAtlasWebglAddon extends FakeWebglAddon {
  private readonly addHandlers = new Set<(canvas: HTMLCanvasElement) => void>()
  private readonly changeHandlers = new Set<(canvas: HTMLCanvasElement) => void>()
  private readonly removeHandlers = new Set<(canvas: HTMLCanvasElement) => void>()

  private subscribe(
    handlers: Set<(canvas: HTMLCanvasElement) => void>,
    handler: (canvas: HTMLCanvasElement) => void,
  ) {
    handlers.add(handler)
    return { dispose: () => handlers.delete(handler) }
  }

  onAddTextureAtlasCanvas(handler: (canvas: HTMLCanvasElement) => void) {
    return this.subscribe(this.addHandlers, handler)
  }

  onChangeTextureAtlas(handler: (canvas: HTMLCanvasElement) => void) {
    return this.subscribe(this.changeHandlers, handler)
  }

  onRemoveTextureAtlasCanvas(handler: (canvas: HTMLCanvasElement) => void) {
    return this.subscribe(this.removeHandlers, handler)
  }

  addAtlasPage(canvas = {} as HTMLCanvasElement) {
    for (const handler of this.addHandlers) handler(canvas)
    return canvas
  }

  changeAtlasPage(canvas = {} as HTMLCanvasElement) {
    for (const handler of this.changeHandlers) handler(canvas)
  }

  removeAtlasPage(canvas: HTMLCanvasElement) {
    for (const handler of this.removeHandlers) handler(canvas)
  }
}

type TestRendererTerminal = Pick<
  Terminal,
  'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'
>

function enableTestRenderer(
  terminal: Pick<Terminal, 'loadAddon'> & Partial<TestRendererTerminal>,
  configOrCreateAddon: Readonly<{ themeColor: string }> | (() => WebglAddonPort),
  suppliedCreateAddon?: () => WebglAddonPort,
) {
  const createAddon =
    typeof configOrCreateAddon === 'function' ? configOrCreateAddon : suppliedCreateAddon!
  const localCanvases: HTMLCanvasElement[] = []
  const hasElement = Boolean(terminal.element)
  let postprocessorCreateCount = 0
  let postprocessorHandoffPresentCount = 0
  const animationFrameScheduler = new ManualAnimationFrameScheduler()
  const rendererTerminal = {
    element:
      terminal.element ?? ({ querySelectorAll: () => localCanvases } as unknown as HTMLElement),
    loadAddon(addon: WebglAddonPort) {
      terminal.loadAddon(addon)
      if (!hasElement) localCanvases.push(fakeWebglCanvas())
    },
    onRender:
      terminal.onRender ??
      (() => ({
        dispose() {},
      })),
    refresh: terminal.refresh ?? (() => {}),
    rows: terminal.rows ?? 90,
  } as TestRendererTerminal
  const controller = activateCrtRenderer(
    rendererTerminal,
    { themeColor: '#010416' },
    createAddon,
    () => {
      postprocessorCreateCount += 1
      return {
        dispose() {},
        presentForHandoff() {
          postprocessorHandoffPresentCount += 1
        },
      }
    },
    animationFrameScheduler,
  )
  return Object.defineProperties(controller, {
    flushScheduledFrames: { value: () => animationFrameScheduler.flush() },
    postprocessorCreateCount: { get: () => postprocessorCreateCount },
    postprocessorHandoffPresentCount: { get: () => postprocessorHandoffPresentCount },
  }) as typeof controller & {
    flushScheduledFrames(): void
    readonly postprocessorCreateCount: number
    readonly postprocessorHandoffPresentCount: number
  }
}

describe('xterm WebGL fallback', () => {
  test('loads the addon and disposes it idempotently', () => {
    const addon = new FakeWebglAddon()
    const loaded: WebglAddonPort[] = []
    const renderer = enableTestRenderer(
      {
        loadAddon(candidate) {
          loaded.push(candidate as WebglAddonPort)
        },
      },
      () => addon,
    )

    expect(loaded).toEqual([addon])
    expect(addon.disposeCount).toBe(0)
    expect(renderer.status).toEqual({ kind: 'active' })
    expect(renderer.postprocessorCreateCount).toBe(1)
    renderer.dispose()
    renderer.dispose()
    expect(addon.contextLossSubscriptionDisposeCount).toBe(1)
    expect(addon.disposeCount).toBe(1)
  })

  test('disposes the addon on context loss without disposing or reloading xterm', () => {
    const addon = new FakeWebglAddon()
    let loadCount = 0
    let terminalDisposeCount = 0
    const renderer = enableTestRenderer(
      {
        loadAddon() {
          loadCount += 1
        },
        dispose() {
          terminalDisposeCount += 1
        },
      } as Pick<Terminal, 'loadAddon'>,
      () => addon,
    )

    addon.loseContext()
    addon.loseContext()
    renderer.dispose()

    expect(renderer.status).toEqual({
      kind: 'fallback',
      message: 'The WebGL context was permanently lost.',
    })
    expect(loadCount).toBe(1)
    expect(terminalDisposeCount).toBe(0)
    expect(addon.contextLossSubscriptionDisposeCount).toBe(1)
    expect(addon.disposeCount).toBe(1)
  })

  test('continues without WebGL when construction fails', () => {
    let loadCount = 0
    const renderer = enableTestRenderer(
      {
        loadAddon() {
          loadCount += 1
        },
      },
      () => {
        throw new Error('WebGL unavailable')
      },
    )

    expect(loadCount).toBe(0)
    expect(renderer.status).toEqual({
      kind: 'fallback',
      message: 'Renderer activation failed: WebGL unavailable',
    })
    expect(() => renderer.dispose()).not.toThrow()
  })

  test('disposes partial addon state when xterm activation fails', () => {
    const addon = new FakeWebglAddon()
    let terminalDisposeCount = 0
    const renderer = enableTestRenderer(
      {
        loadAddon() {
          throw new Error('renderer activation failed')
        },
        dispose() {
          terminalDisposeCount += 1
        },
      } as Pick<Terminal, 'loadAddon'>,
      () => addon,
    )

    expect(terminalDisposeCount).toBe(0)
    expect(addon.contextLossSubscriptionDisposeCount).toBe(1)
    expect(addon.disposeCount).toBe(1)
    expect(() => renderer.dispose()).not.toThrow()
  })

  test('discovers the WebGL limit and always initializes CRT postprocessing', () => {
    const addon = new FakeWebglAddon()
    let queryCount = 0
    const canvases: HTMLCanvasElement[] = []
    const terminal = {
      element: {
        querySelectorAll() {
          queryCount += 1
          return canvases
        },
      },
      loadAddon() {
        canvases.push(fakeWebglCanvas())
      },
      onRender() {
        throw new Error('CRT render subscription must not be installed')
      },
      refresh() {},
      rows: 90,
    }
    const renderer = enableTestRenderer(
      terminal as unknown as Pick<
        Terminal,
        'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'
      >,
      { themeColor: '#010416' },
      () => addon,
    )

    expect(queryCount).toBe(2)
    expect(addon.disposeCount).toBe(0)
    expect(renderer.status).toEqual({ kind: 'active' })
    expect(renderer.postprocessorCreateCount).toBe(1)
    renderer.dispose()
    expect(addon.disposeCount).toBe(1)
  })

  test('recreates the addon at the runtime WebGL atlas limit and refreshes the full terminal', () => {
    const addons: FakeAtlasWebglAddon[] = []
    const canvases: HTMLCanvasElement[] = []
    const refreshes: [number, number][] = []
    const terminal = {
      element: { querySelectorAll: () => canvases },
      loadAddon(candidate: WebglAddonPort) {
        expect(candidate).toBe(addons[addons.length - 1])
        canvases.push(fakeWebglCanvas(16))
      },
      onRender() {
        throw new Error('CRT render subscription must not be installed')
      },
      refresh(start: number, end: number) {
        refreshes.push([start, end])
      },
      rows: 90,
    }
    const renderer = enableTestRenderer(
      terminal as unknown as Pick<
        Terminal,
        'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'
      >,
      { themeColor: '#010416' },
      () => {
        const addon = new FakeAtlasWebglAddon()
        addons.push(addon)
        return addon
      },
    )

    for (let page = 0; page < 15; page += 1) addons[0]!.addAtlasPage()
    renderer.flushScheduledFrames()
    expect(addons).toHaveLength(1)

    addons[0]!.addAtlasPage()
    renderer.flushScheduledFrames()

    expect(addons).toHaveLength(2)
    expect(addons[0]!.disposeCount).toBe(1)
    expect(addons[0]!.contextLossSubscriptionDisposeCount).toBe(1)
    expect(addons[1]!.disposeCount).toBe(0)
    expect(refreshes).toEqual([[0, 89]])
    expect(renderer.status).toEqual({ kind: 'active' })
    expect(renderer.postprocessorCreateCount).toBe(2)

    renderer.dispose()
    expect(addons[1]!.disposeCount).toBe(1)
  })

  test('retains the outgoing canvas until the replacement renderer presents', () => {
    const addons: FakeAtlasWebglAddon[] = []
    const canvases: HTMLCanvasElement[] = []
    const parentByCanvas = new WeakMap<HTMLCanvasElement, HTMLElement>()
    const canvasHost = {
      appendChild(canvas: HTMLCanvasElement) {
        const index = canvases.indexOf(canvas)
        if (index !== -1) canvases.splice(index, 1)
        canvases.push(canvas)
        parentByCanvas.set(canvas, canvasHost as unknown as HTMLElement)
        return canvas
      },
    } as unknown as HTMLElement
    const createAttachedCanvas = () => {
      const canvas = fakeWebglCanvas(16)
      Object.defineProperties(canvas, {
        parentElement: { get: () => parentByCanvas.get(canvas) ?? null },
        remove: {
          value: () => {
            const index = canvases.indexOf(canvas)
            if (index !== -1) canvases.splice(index, 1)
            parentByCanvas.delete(canvas)
          },
        },
      })
      canvasHost.appendChild(canvas)
      return canvas
    }
    const renderHandlers = new Set<() => void>()
    const renderer = enableTestRenderer(
      {
        element: { querySelectorAll: () => canvases },
        loadAddon() {
          createAttachedCanvas()
        },
        onRender(handler: Parameters<TestRendererTerminal['onRender']>[0]) {
          const callback = handler as () => void
          renderHandlers.add(callback)
          return { dispose: () => renderHandlers.delete(callback) }
        },
        refresh() {},
        rows: 90,
      } as unknown as Pick<Terminal, 'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'>,
      { themeColor: '#010416' },
      () => {
        const addon = new FakeAtlasWebglAddon()
        addons.push(addon)
        return addon
      },
    )
    const outgoingCanvas = canvases[0]!

    for (let page = 0; page < 16; page += 1) addons[0]!.addAtlasPage()
    renderer.flushScheduledFrames()

    expect(renderer.postprocessorHandoffPresentCount).toBe(1)
    expect(canvases).toHaveLength(2)
    expect(canvases[1]).toBe(outgoingCanvas)
    expect(renderHandlers.size).toBe(1)

    for (const render of [...renderHandlers]) render()

    expect(canvases).toHaveLength(1)
    expect(canvases[0]).not.toBe(outgoingCanvas)
    expect(renderHandlers.size).toBe(0)
    renderer.dispose()
  })

  test('falls back safely when atlas-driven addon recreation fails', () => {
    const first = new FakeAtlasWebglAddon()
    const canvases: HTMLCanvasElement[] = []
    let creations = 0
    let refreshCount = 0
    const renderer = enableTestRenderer(
      {
        element: { querySelectorAll: () => canvases },
        loadAddon() {
          canvases.push(fakeWebglCanvas(8))
        },
        onRender() {
          throw new Error('CRT render subscription must not be installed')
        },
        refresh() {
          refreshCount += 1
        },
        rows: 90,
      } as unknown as Pick<Terminal, 'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'>,
      { themeColor: '#010416' },
      () => {
        creations += 1
        if (creations > 1) throw new Error('replacement unavailable')
        return first
      },
    )

    for (let page = 0; page < 8; page += 1) first.addAtlasPage()
    renderer.flushScheduledFrames()

    expect(renderer.status).toEqual({
      kind: 'fallback',
      message: 'Renderer reactivation failed: replacement unavailable',
    })
    expect(first.disposeCount).toBe(1)
    expect(refreshCount).toBe(1)
    renderer.dispose()
  })

  test('transactionally returns to the default renderer when CRT canvas discovery fails', () => {
    const addon = new FakeWebglAddon()
    let refreshCount = 0
    const terminal = {
      element: { querySelectorAll: () => [] },
      loadAddon() {},
      onRender() {
        throw new Error('no postprocessor should be subscribed')
      },
      refresh(start: number, end: number) {
        expect([start, end]).toEqual([0, 89])
        refreshCount += 1
      },
      rows: 90,
    }
    const renderer = enableTestRenderer(
      terminal as unknown as Pick<
        Terminal,
        'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'
      >,
      { themeColor: '#010416' },
      () => addon,
    )

    expect(addon.disposeCount).toBe(1)
    expect(addon.contextLossSubscriptionDisposeCount).toBe(1)
    expect(refreshCount).toBe(1)
    expect(renderer.status.kind).toBe('fallback')
    if (renderer.status.kind === 'fallback') {
      expect(renderer.status.message).toContain(
        'Expected one newly activated xterm WebGL2 canvas, found 0',
      )
    }
    renderer.dispose()
    expect(addon.disposeCount).toBe(1)
    expect(refreshCount).toBe(1)
  })

  test('reports a runtime fallback once and allows lifecycle subscribers to detach', () => {
    const addon = new FakeWebglAddon()
    const renderer = enableTestRenderer(
      {
        loadAddon() {},
      },
      () => addon,
    )
    const statuses: unknown[] = []
    const subscription = renderer.onStatusChange((status) => statuses.push(status))

    addon.loseContext()
    addon.loseContext()
    subscription.dispose()
    renderer.dispose()

    expect(statuses).toEqual([
      { kind: 'fallback', message: 'The WebGL context was permanently lost.' },
    ])
  })

  test('keeps fallback and disposal intact when a status observer throws', () => {
    const addon = new FakeWebglAddon()
    const renderer = enableTestRenderer(
      {
        loadAddon() {},
      },
      () => addon,
    )
    renderer.onStatusChange(() => {
      throw new Error('diagnostic host was removed')
    })

    expect(() => addon.loseContext()).not.toThrow()
    expect(renderer.status.kind).toBe('fallback')
    expect(addon.disposeCount).toBe(1)
  })
})
