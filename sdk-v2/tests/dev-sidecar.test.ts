import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  restartDelayMs,
  runDevelopmentLauncher,
  type DevelopmentChild,
  type DevelopmentSignal,
  type DevelopmentWatcher,
  type SpawnDevelopmentChild,
  type WatchDevelopmentSource,
} from '../scripts/dev-sidecar'

class Deferred<T> {
  readonly promise: Promise<T>
  resolve!: (value: T) => void

  constructor() {
    this.promise = new Promise<T>((resolvePromise) => {
      this.resolve = resolvePromise
    })
  }
}

class FakeChild implements DevelopmentChild {
  readonly exit = new Deferred<number>()
  readonly exited = this.exit.promise
  readonly signals: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals) {
    this.signals.push(signal)
  }
}

class FakeWatcher implements DevelopmentWatcher {
  closeCount = 0
  private errorHandler: ((error: Error) => void) | undefined

  constructor(
    readonly path: string,
    readonly recursive: boolean,
    private readonly changeHandler: () => void,
  ) {}

  on(_event: 'error', listener: (error: Error) => void) {
    this.errorHandler = listener
    return this
  }

  emitChange() {
    this.changeHandler()
  }

  emitError(error: Error) {
    this.errorHandler?.(error)
  }

  close() {
    this.closeCount += 1
  }
}

class FakeClock {
  private now = 0
  private nextId = 1
  private readonly timers = new Map<number, { at: number; callback: () => void }>()

  schedule = (callback: () => void, delay: number) => {
    const id = this.nextId++
    this.timers.set(id, { at: this.now + delay, callback })
    return id
  }

  cancel = (timer: unknown) => {
    this.timers.delete(timer as number)
  }

  advance(milliseconds: number) {
    const target = this.now + milliseconds

    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!next) break

      const [id, timer] = next
      this.now = timer.at
      this.timers.delete(id)
      timer.callback()
    }

    this.now = target
  }
}

class FakeSignals {
  readonly removed: DevelopmentSignal[] = []
  private readonly listeners = new Map<DevelopmentSignal, Set<() => void>>()

  on = (signal: DevelopmentSignal, listener: () => void) => {
    const listeners = this.listeners.get(signal) ?? new Set()
    listeners.add(listener)
    this.listeners.set(signal, listeners)
  }

  off = (signal: DevelopmentSignal, listener: () => void) => {
    this.removed.push(signal)
    this.listeners.get(signal)?.delete(listener)
  }

  emit(signal: DevelopmentSignal) {
    for (const listener of [...(this.listeners.get(signal) ?? [])]) listener()
  }
}

type SpawnCall = {
  command: string[]
  options: Parameters<SpawnDevelopmentChild>[1]
}

function createHarness(children: FakeChild[]) {
  const clock = new FakeClock()
  const signals = new FakeSignals()
  const watchers: FakeWatcher[] = []
  const spawnCalls: SpawnCall[] = []
  const diagnostics: string[] = []

  const watch: WatchDevelopmentSource = (path, options, onChange) => {
    const watcher = new FakeWatcher(path, options.recursive, onChange)
    watchers.push(watcher)
    return watcher
  }
  const spawn: SpawnDevelopmentChild = (command, options) => {
    spawnCalls.push({ command, options })
    const child = children[spawnCalls.length - 1]
    if (!child) throw new Error('unexpected spawn')
    return child
  }

  const completed = runDevelopmentLauncher({
    root: '/sdk-v2',
    bunExecutable: '/bin/bun',
    watch,
    spawn,
    schedule: clock.schedule,
    cancel: clock.cancel,
    onSignal: signals.on,
    offSignal: signals.off,
    writeStderr: (message) => diagnostics.push(message),
  })

  return { children, clock, completed, diagnostics, signals, spawnCalls, watchers }
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('development sidecar startup', () => {
  test('watches both source trees recursively and inherits the raw Tauri pipes', async () => {
    const child = new FakeChild()
    const harness = createHarness([child])

    expect(
      harness.watchers.map((watcher) => ({
        path: watcher.path,
        recursive: watcher.recursive,
      })),
    ).toEqual([
      { path: resolve('/sdk-v2', 'app'), recursive: true },
      { path: resolve('/sdk-v2', 'termweave'), recursive: true },
    ])
    expect(harness.spawnCalls).toHaveLength(1)
    expect(harness.spawnCalls[0]?.command).toEqual([
      '/bin/bun',
      '--preload',
      '@opentui/solid/preload',
      resolve('/sdk-v2', 'app/index.tsx'),
    ])
    expect(harness.spawnCalls[0]?.options).toMatchObject({
      cwd: '/sdk-v2',
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    expect(
      Object.prototype.hasOwnProperty.call(harness.spawnCalls[0]?.options.env ?? {}, 'DEBUG'),
    ).toBe(true)
    expect(harness.spawnCalls[0]?.options.env.DEBUG).toBeUndefined()

    harness.signals.emit('SIGTERM')
    child.exit.resolve(0)
    await expect(harness.completed).resolves.toBe(0)
  })
})

describe('development source restarts', () => {
  test('debounces changes for 75 ms and performs one restart', async () => {
    const first = new FakeChild()
    const second = new FakeChild()
    const harness = createHarness([first, second])

    harness.watchers[0]?.emitChange()
    harness.clock.advance(restartDelayMs - 1)
    expect(first.signals).toEqual([])

    harness.watchers[1]?.emitChange()
    harness.clock.advance(restartDelayMs - 1)
    expect(first.signals).toEqual([])

    harness.clock.advance(1)
    expect(first.signals).toEqual(['SIGTERM'])
    expect(harness.spawnCalls).toHaveLength(1)

    first.exit.resolve(0)
    await settle()
    expect(harness.spawnCalls).toHaveLength(2)

    harness.signals.emit('SIGTERM')
    second.exit.resolve(0)
    await expect(harness.completed).resolves.toBe(0)
  })

  test('coalesces changes received while the current child is shutting down', async () => {
    const first = new FakeChild()
    const replacement = new FakeChild()
    const harness = createHarness([first, replacement])

    harness.watchers[0]?.emitChange()
    harness.clock.advance(restartDelayMs)
    expect(first.signals).toEqual(['SIGTERM'])

    harness.watchers[0]?.emitChange()
    harness.clock.advance(20)
    harness.watchers[1]?.emitChange()
    harness.clock.advance(restartDelayMs)
    expect(first.signals).toEqual(['SIGTERM'])
    expect(harness.spawnCalls).toHaveLength(1)

    first.exit.resolve(0)
    await settle()
    expect(harness.spawnCalls).toHaveLength(2)
    expect(replacement.signals).toEqual([])

    harness.signals.emit('SIGTERM')
    replacement.exit.resolve(0)
    await expect(harness.completed).resolves.toBe(0)
  })

  test('waits after a syntax-error exit and recovers on the next edit', async () => {
    const syntaxError = new FakeChild()
    const recovered = new FakeChild()
    const harness = createHarness([syntaxError, recovered])

    syntaxError.exit.resolve(1)
    await settle()
    expect(harness.spawnCalls).toHaveLength(1)
    expect(harness.watchers.every((watcher) => watcher.closeCount === 0)).toBe(true)
    expect(harness.diagnostics.join('')).toContain(
      'OpenTUI exited with code 1; waiting for the next source change.',
    )

    harness.watchers[0]?.emitChange()
    harness.clock.advance(restartDelayMs)
    await settle()
    expect(harness.spawnCalls).toHaveLength(2)

    recovered.exit.resolve(0)
    await expect(harness.completed).resolves.toBe(0)
    expect(harness.watchers.every((watcher) => watcher.closeCount === 1)).toBe(true)
  })
})

describe('development launcher shutdown', () => {
  test('a natural clean child exit closes watchers and signal handlers', async () => {
    const child = new FakeChild()
    const harness = createHarness([child])

    child.exit.resolve(0)
    await expect(harness.completed).resolves.toBe(0)

    expect(child.signals).toEqual([])
    expect(harness.watchers.map((watcher) => watcher.closeCount)).toEqual([1, 1])
    expect(harness.signals.removed.sort()).toEqual(['SIGINT', 'SIGTERM'])
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    test(`${signal} reaches the child, waits for exit, and cancels pending work`, async () => {
      const child = new FakeChild()
      const harness = createHarness([child])
      let completed = false
      void harness.completed.then(() => {
        completed = true
      })

      harness.watchers[0]?.emitChange()
      harness.signals.emit(signal)
      await settle()

      expect(child.signals).toEqual([signal])
      expect(completed).toBe(false)
      expect(harness.watchers.map((watcher) => watcher.closeCount)).toEqual([1, 1])
      expect(harness.signals.removed.sort()).toEqual(['SIGINT', 'SIGTERM'])

      harness.clock.advance(restartDelayMs)
      expect(child.signals).toEqual([signal])
      expect(harness.spawnCalls).toHaveLength(1)

      child.exit.resolve(0)
      await expect(harness.completed).resolves.toBe(0)
      harness.signals.emit(signal)
      expect(harness.watchers.map((watcher) => watcher.closeCount)).toEqual([1, 1])
    })
  }

  test('a watcher error terminates the child and exits non-zero', async () => {
    const child = new FakeChild()
    const harness = createHarness([child])

    harness.watchers[1]?.emitError(new Error('watch failed'))
    expect(child.signals).toEqual(['SIGTERM'])
    expect(harness.watchers.map((watcher) => watcher.closeCount)).toEqual([1, 1])

    child.exit.resolve(0)
    await expect(harness.completed).resolves.toBe(1)
    expect(harness.diagnostics.join('')).toContain('Source watcher failed: watch failed')
  })
})
