import { describe, expect, test } from 'bun:test'
import { Terminal } from '@xterm/xterm'
import { parseAppConfig } from '../termweave/config'
import {
  createTerminalSession,
  enableWebglRenderer,
  terminalOptions,
  type AppWindowLike,
  type ChildLike,
  type ProcessExit,
  type RawChunk,
  type SidecarCommandLike,
  type TerminalLike,
  type WebglAddonLike,
} from '../termweave/host/terminal'
import { validAppConfig } from './fixtures'

class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void
  reject!: (error: unknown) => void

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

class DataEmitter<T> {
  private readonly listeners = new Set<(data: T) => void>()

  constructor(
    private readonly label: string,
    private readonly events: string[],
  ) {}

  on(_event: 'data', listener: (data: T) => void) {
    this.events.push(`${this.label}:on`)
    this.listeners.add(listener)
    return this
  }

  off(_event: 'data', listener: (data: T) => void) {
    this.events.push(`${this.label}:off`)
    this.listeners.delete(listener)
    return this
  }

  emit(data: T) {
    for (const listener of this.listeners) listener(data)
  }
}

class FakeCommand implements SidecarCommandLike {
  readonly events: string[] = []
  readonly stdout = new DataEmitter<RawChunk>('stdout', this.events)
  readonly stderr = new DataEmitter<RawChunk>('stderr', this.events)
  private readonly closeListeners = new Set<(exit: ProcessExit) => void>()
  private readonly errorListeners = new Set<(error: string) => void>()

  constructor(private readonly spawnChild: () => Promise<ChildLike>) {}

  on(event: 'error', listener: (error: string) => void): this
  on(event: 'close', listener: (exit: ProcessExit) => void): this
  on(
    event: 'error' | 'close',
    listener: ((error: string) => void) | ((exit: ProcessExit) => void),
  ) {
    this.events.push(`${event}:on`)
    if (event === 'error') this.errorListeners.add(listener as (error: string) => void)
    else this.closeListeners.add(listener as (exit: ProcessExit) => void)
    return this
  }

  off(event: 'error', listener: (error: string) => void): this
  off(event: 'close', listener: (exit: ProcessExit) => void): this
  off(
    event: 'error' | 'close',
    listener: ((error: string) => void) | ((exit: ProcessExit) => void),
  ) {
    this.events.push(`${event}:off`)
    if (event === 'error') this.errorListeners.delete(listener as (error: string) => void)
    else this.closeListeners.delete(listener as (exit: ProcessExit) => void)
    return this
  }

  spawn() {
    this.events.push('spawn')
    return this.spawnChild()
  }

  emitClose(exit: ProcessExit) {
    for (const listener of this.closeListeners) listener(exit)
  }

  emitError(error: string) {
    for (const listener of this.errorListeners) listener(error)
  }
}

class FakeTerminal implements TerminalLike {
  readonly writes: { data: string | Uint8Array; parsed?: () => void }[] = []
  disposeCount = 0
  focusCount = 0
  inputDisposed = 0
  private inputHandler: ((data: string) => void) | undefined

  write(data: string | Uint8Array, callback?: () => void) {
    this.writes.push({ data, parsed: callback })
  }

  onData(handler: (data: string) => void) {
    this.inputHandler = handler
    return {
      dispose: () => {
        this.inputDisposed += 1
        this.inputHandler = undefined
      },
    }
  }

  emitInput(data: string) {
    this.inputHandler?.(data)
  }

  dispose() {
    this.disposeCount += 1
  }

  focus() {
    this.focusCount += 1
  }
}

class FakeWindow implements AppWindowLike {
  closeCount = 0
  focusFailure: Error | undefined
  focusCount = 0
  preventDefaultCount = 0
  showFailure: Error | undefined
  showCount = 0
  unlistenCount = 0
  readonly events: string[] = []
  private closeHandler: ((event: { preventDefault(): void }) => void | Promise<void>) | undefined

  async show() {
    this.events.push('show')
    this.showCount += 1
    const failure = this.showFailure
    this.showFailure = undefined
    if (failure) throw failure
  }

  async setFocus() {
    this.events.push('focus')
    this.focusCount += 1
    const failure = this.focusFailure
    this.focusFailure = undefined
    if (failure) throw failure
  }

  async close() {
    this.events.push('close')
    this.closeCount += 1
  }

  async onCloseRequested(handler: (event: { preventDefault(): void }) => void | Promise<void>) {
    this.closeHandler = handler
    return () => {
      this.unlistenCount += 1
      this.closeHandler = undefined
    }
  }

  requestClose() {
    this.closeHandler?.({
      preventDefault: () => {
        this.preventDefaultCount += 1
      },
    })
  }
}

function fakeChild(overrides: Partial<ChildLike> = {}): ChildLike {
  return {
    write: async () => {},
    kill: async () => {},
    ...overrides,
  }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function createStartedSession(child: ChildLike = fakeChild()) {
  const terminal = new FakeTerminal()
  const command = new FakeCommand(async () => child)
  const appWindow = new FakeWindow()
  const session = createTerminalSession({ terminal, command, appWindow })
  return { appWindow, command, session, terminal }
}

describe('fixed xterm configuration', () => {
  test('uses the fixed grid, foreground, cursor, and non-scrolling terminal options', () => {
    const options = terminalOptions(parseAppConfig(validAppConfig()))
    expect(options).toMatchObject({
      cols: 128,
      rows: 72,
      fontFamily: '"Kreative Square", monospace',
      fontSize: 20,
      letterSpacing: 0,
      lineHeight: 1,
      scrollback: 0,
      cursorBlink: false,
      convertEol: false,
      customGlyphs: true,
      theme: {
        background: '#010416',
        foreground: '#F59B5A',
        cursor: '#F59B5A',
      },
    })
  })

  test('xterm accepts UTF-8 and escape sequences split across byte chunks', async () => {
    const terminal = new Terminal({ cols: 20, rows: 2 })
    const encoded = new TextEncoder().encode('café\u001b[31m red\u001b[0m')

    terminal.write(encoded.slice(0, 4))
    terminal.write(encoded.slice(4, 9))
    await new Promise<void>((resolve) => terminal.write(encoded.slice(9), resolve))

    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('café red')
    terminal.dispose()
  })
})

class FakeWebglAddon implements WebglAddonLike {
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

function fakeWebglCanvas(maximumTextureUnits = 16) {
  const maximumTextureUnitsParameter = 0x8872
  const gl = {
    MAX_TEXTURE_IMAGE_UNITS: maximumTextureUnitsParameter,
    getParameter(parameter: number) {
      expect(parameter).toBe(maximumTextureUnitsParameter)
      return maximumTextureUnits
    },
  } as unknown as WebGL2RenderingContext
  return {
    getContext(type: string) {
      return type === 'webgl2' ? gl : null
    },
  } as unknown as HTMLCanvasElement
}

type TestRendererTerminal = Pick<
  Terminal,
  'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'
>

function enableTestRenderer(
  terminal: Pick<Terminal, 'loadAddon'> & Partial<TestRendererTerminal>,
  configOrCreateAddon: Readonly<{ themeColor: string }> | (() => WebglAddonLike),
  suppliedCreateAddon?: () => WebglAddonLike,
) {
  const createAddon =
    typeof configOrCreateAddon === 'function' ? configOrCreateAddon : suppliedCreateAddon!
  const localCanvases: HTMLCanvasElement[] = []
  const hasElement = Boolean(terminal.element)
  let postprocessorCreateCount = 0
  const rendererTerminal = {
    element:
      terminal.element ?? ({ querySelectorAll: () => localCanvases } as unknown as HTMLElement),
    loadAddon(addon: WebglAddonLike) {
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
  const controller = enableWebglRenderer(
    rendererTerminal,
    { themeColor: '#010416' },
    createAddon,
    () => {
      postprocessorCreateCount += 1
      return { dispose() {} }
    },
  )
  return Object.defineProperty(controller, 'postprocessorCreateCount', {
    get: () => postprocessorCreateCount,
  }) as typeof controller & { readonly postprocessorCreateCount: number }
}

describe('xterm WebGL fallback', () => {
  test('loads the addon and disposes it idempotently', () => {
    const addon = new FakeWebglAddon()
    const loaded: WebglAddonLike[] = []
    const renderer = enableTestRenderer(
      {
        loadAddon(candidate) {
          loaded.push(candidate as WebglAddonLike)
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

  test('recreates the addon before atlas exhaustion and refreshes the full terminal', async () => {
    const addons: FakeAtlasWebglAddon[] = []
    const canvases: HTMLCanvasElement[] = []
    const refreshes: [number, number][] = []
    const terminal = {
      element: { querySelectorAll: () => canvases },
      loadAddon(candidate: WebglAddonLike) {
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

    for (let page = 0; page < 12; page += 1) addons[0]!.addAtlasPage()
    await new Promise((resolve) => setTimeout(resolve, 5))

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

  test('falls back safely when atlas-driven addon recreation fails', async () => {
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

    for (let page = 0; page < 4; page += 1) first.addAtlasPage()
    await new Promise((resolve) => setTimeout(resolve, 5))

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

describe('raw sidecar transport', () => {
  test('registers every command listener before spawn and preserves stdout byte identity', async () => {
    const { command, session, terminal } = createStartedSession()
    await session.start()

    expect(command.events.slice(0, 5)).toEqual([
      'stdout:on',
      'stderr:on',
      'error:on',
      'close:on',
      'spawn',
    ])

    const first = Uint8Array.of(0xc3)
    const second = Uint8Array.of(0xa9, 0x1b, 0x5b)
    const third = Uint8Array.of(0x33, 0x31, 0x6d)
    command.stdout.emit(first)
    command.stdout.emit(second)
    command.stdout.emit(third)

    expect(terminal.writes.map(({ data }) => data)).toEqual([first, second, third])
    expect(terminal.writes[0]?.data).toBe(first)
    expect(terminal.writes[1]?.data).toBe(second)
    expect(terminal.writes[2]?.data).toBe(third)
  })

  test('reconstructs production channel byte arrays without decoding stdout', async () => {
    const { command, session, terminal } = createStartedSession()
    await session.start()

    command.stdout.emit([0xc3, 0xa9, 0x1b, 0x5b, 0x33, 0x31, 0x6d])

    const written = terminal.writes[0]?.data
    expect(written).toBeInstanceOf(Uint8Array)
    expect(Array.from(written as Uint8Array)).toEqual([0xc3, 0xa9, 0x1b, 0x5b, 0x33, 0x31, 0x6d])
  })

  test('serializes rapid input writes through one promise chain', async () => {
    const firstWrite = new Deferred<void>()
    const writes: string[] = []
    const child = fakeChild({
      write: (data) => {
        writes.push(String(data))
        return writes.length === 1 ? firstWrite.promise : Promise.resolve()
      },
    })
    const { session, terminal } = createStartedSession(child)
    await session.start()

    terminal.emitInput('a')
    terminal.emitInput('b')
    terminal.emitInput('c')
    await settle()
    expect(writes).toEqual(['a'])

    firstWrite.resolve()
    await session.inputIdle()
    expect(writes).toEqual(['a', 'b', 'c'])
  })

  test('reports one input failure and ignores later input', async () => {
    const writes: string[] = []
    const child = fakeChild({
      write: async (data) => {
        writes.push(String(data))
        throw new Error('stdin closed')
      },
    })
    const { session, terminal } = createStartedSession(child)
    await session.start()

    terminal.emitInput('a')
    terminal.emitInput('b')
    await session.inputIdle()
    terminal.emitInput('c')
    await settle()

    expect(writes).toEqual(['a'])
    expect(
      terminal.writes.filter(
        ({ data }) => typeof data === 'string' && data.includes('Could not write to sidecar input'),
      ),
    ).toHaveLength(1)
  })
})

describe('reveal, diagnostics, and process lifecycle', () => {
  test('reveals exactly once only after xterm parses the first stdout write', async () => {
    const { appWindow, command, session, terminal } = createStartedSession()
    await session.start()

    command.stdout.emit(Uint8Array.of(1))
    command.stdout.emit(Uint8Array.of(2))
    expect(appWindow.showCount).toBe(0)

    terminal.writes[0]?.parsed?.()
    await settle()
    expect(appWindow.showCount).toBe(1)
    expect(appWindow.focusCount).toBe(1)
    expect(terminal.focusCount).toBe(1)

    terminal.writes[1]?.parsed?.()
    await settle()
    expect(appWindow.showCount).toBe(1)
  })

  test('retries reveal after a failed window show without leaking a rejection', async () => {
    const { appWindow, command, session, terminal } = createStartedSession()
    appWindow.showFailure = new Error('show failed')
    await session.start()

    command.stdout.emit(Uint8Array.of(1))
    terminal.writes[0]?.parsed?.()
    await settle()
    expect(appWindow.showCount).toBe(1)
    expect(appWindow.focusCount).toBe(0)
    expect(terminal.focusCount).toBe(0)

    command.stdout.emit(Uint8Array.of(2))
    terminal.writes[1]?.parsed?.()
    await settle()
    expect(appWindow.showCount).toBe(2)
    expect(appWindow.focusCount).toBe(1)
    expect(terminal.focusCount).toBe(1)
  })

  test('keeps a shown window revealed when native focus fails', async () => {
    const { appWindow, command, session, terminal } = createStartedSession()
    appWindow.focusFailure = new Error('focus failed')
    await session.start()

    command.stdout.emit(Uint8Array.of(1))
    terminal.writes[0]?.parsed?.()
    await settle()
    expect(appWindow.showCount).toBe(1)
    expect(appWindow.focusCount).toBe(1)
    expect(terminal.focusCount).toBe(1)

    command.stdout.emit(Uint8Array.of(2))
    terminal.writes[1]?.parsed?.()
    await settle()
    expect(appWindow.showCount).toBe(1)
  })

  test('decodes split stderr with one streaming decoder and reveals the diagnostic', async () => {
    const { appWindow, command, session, terminal } = createStartedSession()
    await session.start()
    const bytes = new TextEncoder().encode('café')

    command.stderr.emit(bytes.slice(0, 4))
    command.stderr.emit(bytes.slice(4))

    const rendered = terminal.writes.map(({ data }) => String(data)).join('')
    expect(rendered).toBe('\r\n[sidecar] café')
    expect(rendered).not.toContain('\uFFFD')
    expect(appWindow.showCount).toBe(0)

    terminal.writes[terminal.writes.length - 1]?.parsed?.()
    await settle()
    expect(appWindow.showCount).toBe(1)
  })

  test('reveals spawn and command failures instead of leaving the window hidden', async () => {
    const terminal = new FakeTerminal()
    const command = new FakeCommand(async () => {
      throw new Error('not found')
    })
    const appWindow = new FakeWindow()
    const session = createTerminalSession({ terminal, command, appWindow })

    await session.start()
    expect(String(terminal.writes[0]?.data)).toContain('Failed to start sidecar: not found')
    terminal.writes[0]?.parsed?.()
    await settle()
    expect(appWindow.showCount).toBe(1)

    const running = createStartedSession()
    await running.session.start()
    running.command.emitError('pipe failed')
    expect(String(running.terminal.writes[0]?.data)).toContain('Sidecar process error: pipe failed')
  })

  test('normal exit closes the app while abnormal and signal exits remain visible', async () => {
    const normal = createStartedSession()
    await normal.session.start()
    normal.command.emitClose({ code: 0, signal: null })
    await settle()
    expect(normal.appWindow.closeCount).toBe(1)
    expect(normal.terminal.disposeCount).toBe(1)

    for (const exit of [
      { code: 2, signal: null },
      { code: null, signal: 15 },
    ]) {
      const abnormal = createStartedSession()
      await abnormal.session.start()
      abnormal.command.emitClose(exit)
      await settle()
      expect(abnormal.appWindow.closeCount).toBe(0)
      expect(abnormal.terminal.disposeCount).toBe(0)
      expect(String(abnormal.terminal.writes[abnormal.terminal.writes.length - 1]?.data)).toContain(
        'Sidecar exited',
      )
      abnormal.terminal.writes[abnormal.terminal.writes.length - 1]?.parsed?.()
      await settle()
      expect(abnormal.appWindow.showCount).toBe(1)
    }
  })

  test('window close kills the child before closing and cleanup is idempotent', async () => {
    const killed = new Deferred<void>()
    const child = fakeChild({
      kill: () => {
        appWindow.events.push('kill')
        return killed.promise
      },
    })
    const { appWindow, session, terminal } = createStartedSession(child)
    await session.start()

    appWindow.requestClose()
    expect(appWindow.preventDefaultCount).toBe(1)
    await settle()
    expect(appWindow.events).toEqual(['kill'])
    expect(appWindow.closeCount).toBe(0)

    const firstCleanup = session.cleanup()
    const secondCleanup = session.cleanup()
    expect(secondCleanup).toBe(firstCleanup)
    killed.resolve()
    await firstCleanup
    await settle()

    expect(appWindow.events).toEqual(['kill', 'close'])
    expect(terminal.disposeCount).toBe(1)
    expect(appWindow.unlistenCount).toBe(1)
  })

  test('direct cleanup removes the native close listener', async () => {
    const { appWindow, session, terminal } = createStartedSession()
    await session.start()

    const firstCleanup = session.cleanup()
    const secondCleanup = session.cleanup()
    expect(secondCleanup).toBe(firstCleanup)
    await firstCleanup

    expect(appWindow.unlistenCount).toBe(1)
    expect(terminal.inputDisposed).toBe(1)
    expect(terminal.disposeCount).toBe(1)

    appWindow.requestClose()
    await settle()
    expect(appWindow.preventDefaultCount).toBe(0)
    expect(appWindow.closeCount).toBe(0)
  })

  test('waits for and kills a child that resolves after window cleanup starts', async () => {
    const spawned = new Deferred<ChildLike>()
    const terminal = new FakeTerminal()
    const command = new FakeCommand(() => spawned.promise)
    const appWindow = new FakeWindow()
    const events = appWindow.events
    const session = createTerminalSession({ terminal, command, appWindow })
    const start = session.start()
    await settle()

    appWindow.requestClose()
    await settle()
    expect(appWindow.closeCount).toBe(0)

    spawned.resolve(
      fakeChild({
        kill: async () => {
          events.push('late-kill')
        },
      }),
    )
    await start
    await settle()

    expect(events).toEqual(['late-kill', 'close'])
    expect(terminal.disposeCount).toBe(1)
  })
})
