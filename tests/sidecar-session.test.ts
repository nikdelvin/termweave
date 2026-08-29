import { describe, expect, test } from 'bun:test'
import {
  createSidecarSession,
  type DesktopWindow,
  type SidecarCommand,
  type SidecarExit,
  type SidecarOutputChunk,
  type SidecarProcess,
  type TerminalPort,
} from '../termweave/host/sidecar-session'
import { Deferred } from './support/deferred'

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

class FakeCommand implements SidecarCommand {
  readonly events: string[] = []
  readonly stdout = new DataEmitter<SidecarOutputChunk>('stdout', this.events)
  readonly stderr = new DataEmitter<SidecarOutputChunk>('stderr', this.events)
  private readonly closeListeners = new Set<(exit: SidecarExit) => void>()
  private readonly errorListeners = new Set<(error: string) => void>()

  constructor(private readonly spawnChild: () => Promise<SidecarProcess>) {}

  on(event: 'error', listener: (error: string) => void): this
  on(event: 'close', listener: (exit: SidecarExit) => void): this
  on(
    event: 'error' | 'close',
    listener: ((error: string) => void) | ((exit: SidecarExit) => void),
  ) {
    this.events.push(`${event}:on`)
    if (event === 'error') this.errorListeners.add(listener as (error: string) => void)
    else this.closeListeners.add(listener as (exit: SidecarExit) => void)
    return this
  }

  off(event: 'error', listener: (error: string) => void): this
  off(event: 'close', listener: (exit: SidecarExit) => void): this
  off(
    event: 'error' | 'close',
    listener: ((error: string) => void) | ((exit: SidecarExit) => void),
  ) {
    this.events.push(`${event}:off`)
    if (event === 'error') this.errorListeners.delete(listener as (error: string) => void)
    else this.closeListeners.delete(listener as (exit: SidecarExit) => void)
    return this
  }

  spawn() {
    this.events.push('spawn')
    return this.spawnChild()
  }

  emitClose(exit: SidecarExit) {
    for (const listener of this.closeListeners) listener(exit)
  }

  emitError(error: string) {
    for (const listener of this.errorListeners) listener(error)
  }
}

class FakeTerminal implements TerminalPort {
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

class FakeWindow implements DesktopWindow {
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

function fakeChild(overrides: Partial<SidecarProcess> = {}): SidecarProcess {
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

function createStartedSession(child: SidecarProcess = fakeChild()) {
  const terminal = new FakeTerminal()
  const command = new FakeCommand(async () => child)
  const appWindow = new FakeWindow()
  const session = createSidecarSession({ terminal, command, appWindow })
  return { appWindow, command, session, terminal }
}

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
    const session = createSidecarSession({ terminal, command, appWindow })

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
    const spawned = new Deferred<SidecarProcess>()
    const terminal = new FakeTerminal()
    const command = new FakeCommand(() => spawned.promise)
    const appWindow = new FakeWindow()
    const events = appWindow.events
    const session = createSidecarSession({ terminal, command, appWindow })
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
