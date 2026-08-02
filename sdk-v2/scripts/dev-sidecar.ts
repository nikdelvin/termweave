import { watch as watchFileSystem } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

declare const __TERMWEAVE_BUN_EXECUTABLE__: string
declare const __TERMWEAVE_PROJECT_ROOT__: string

export const restartDelayMs = 75

export interface DevelopmentChild {
  readonly exited: Promise<number>
  kill(signal: NodeJS.Signals): void
}

export interface DevelopmentWatcher {
  close(): void
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type WatchDevelopmentSource = (
  path: string,
  options: Readonly<{ recursive: true }>,
  onChange: () => void,
) => DevelopmentWatcher

export type SpawnDevelopmentChild = (
  command: string[],
  options: Readonly<{
    cwd: string
    env: Record<string, string | undefined>
    stdin: 'inherit'
    stdout: 'inherit'
    stderr: 'inherit'
  }>,
) => DevelopmentChild

export type DevelopmentSignal = 'SIGINT' | 'SIGTERM'

type TimerHandle = unknown

type DevelopmentLauncherOptions = {
  root: string
  bunExecutable: string
  watch?: WatchDevelopmentSource
  spawn?: SpawnDevelopmentChild
  schedule?: (callback: () => void, delay: number) => TimerHandle
  cancel?: (timer: TimerHandle) => void
  onSignal?: (signal: DevelopmentSignal, listener: () => void) => void
  offSignal?: (signal: DevelopmentSignal, listener: () => void) => void
  writeStderr?: (message: string) => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const defaultWatch: WatchDevelopmentSource = (path, options, onChange) =>
  watchFileSystem(path, options, onChange)

const defaultSpawn: SpawnDevelopmentChild = (command, options) => Bun.spawn(command, options)

export function runDevelopmentLauncher({
  root,
  bunExecutable,
  watch = defaultWatch,
  spawn = defaultSpawn,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  onSignal = (signal, listener) => {
    process.once(signal, listener)
  },
  offSignal = (signal, listener) => {
    process.off(signal, listener)
  },
  writeStderr = (message) => process.stderr.write(message),
}: DevelopmentLauncherOptions): Promise<number> {
  const watchers: DevelopmentWatcher[] = []
  const expectedExits = new WeakSet<DevelopmentChild>()
  const stopPromises = new WeakMap<DevelopmentChild, Promise<void>>()
  const signalHandlers = new Map<DevelopmentSignal, () => void>()

  let child: DevelopmentChild | undefined
  let finish: ((exitCode: number) => void) | undefined
  let finished = false
  let restartQueued = false
  let restarting = false
  let restartTimer: TimerHandle | undefined
  let shutdownPromise: Promise<void> | undefined
  let stopping = false

  const completed = new Promise<number>((resolveCompleted) => {
    finish = resolveCompleted
  })

  const report = (message: string) => {
    writeStderr(`[termweave] ${message}\n`)
  }

  const cancelRestartTimer = () => {
    if (restartTimer === undefined) return
    cancel(restartTimer)
    restartTimer = undefined
  }

  const closeWatchers = () => {
    for (const watcher of watchers.splice(0)) {
      try {
        watcher.close()
      } catch {
        // Cleanup tolerates a watcher that has already closed.
      }
    }
  }

  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) offSignal(signal, handler)
    signalHandlers.clear()
  }

  const resolveCompletion = (exitCode: number) => {
    if (finished) return
    finished = true
    finish?.(exitCode)
  }

  const stopChild = (target: DevelopmentChild, signal: NodeJS.Signals) => {
    expectedExits.add(target)

    try {
      target.kill(signal)
    } catch {
      // The child may have exited between selection and signal delivery.
    }

    const existingStop = stopPromises.get(target)
    if (existingStop) return existingStop

    const stop = target.exited.then(() => {
      if (child === target) child = undefined
    })
    stopPromises.set(target, stop)
    return stop
  }

  const stopCurrentChild = (signal: NodeJS.Signals) => {
    const target = child
    return target ? stopChild(target, signal) : Promise.resolve()
  }

  const shutdown = (signal: NodeJS.Signals | undefined, exitCode: number) => {
    if (shutdownPromise) return shutdownPromise

    stopping = true
    restartQueued = false
    cancelRestartTimer()
    removeSignalHandlers()
    closeWatchers()

    shutdownPromise = (async () => {
      if (signal) await stopCurrentChild(signal)
      resolveCompletion(exitCode)
    })()
    return shutdownPromise
  }

  const handleChildExit = (target: DevelopmentChild, exitCode: number) => {
    if (child !== target) return
    child = undefined

    if (expectedExits.delete(target) || stopping) return
    if (exitCode === 0) {
      void shutdown(undefined, 0)
      return
    }

    report(`OpenTUI exited with code ${exitCode}; waiting for the next source change.`)
  }

  const startChild = () => {
    if (stopping) return

    let nextChild: DevelopmentChild
    try {
      nextChild = spawn(
        [bunExecutable, '--preload', '@opentui/solid/preload', resolve(root, 'app/index.tsx')],
        {
          cwd: root,
          env: { ...process.env, DEBUG: undefined },
          stdin: 'inherit',
          stdout: 'inherit',
          stderr: 'inherit',
        },
      )
    } catch (error) {
      report(`Could not start OpenTUI: ${errorMessage(error)}; waiting for the next source change.`)
      return
    }

    child = nextChild
    void nextChild.exited.then((exitCode) => handleChildExit(nextChild, exitCode))
  }

  const restart = async () => {
    restartQueued = true
    if (restarting || stopping) return

    restarting = true
    try {
      do {
        restartQueued = false
        await stopCurrentChild('SIGTERM')
      } while (restartQueued && !stopping)
    } finally {
      restarting = false
    }

    if (!stopping) startChild()
  }

  const handleSourceChange = () => {
    if (stopping) return
    cancelRestartTimer()
    restartTimer = schedule(() => {
      restartTimer = undefined
      void restart()
    }, restartDelayMs)
  }

  const handleWatcherError = (error: Error) => {
    if (stopping) return
    report(`Source watcher failed: ${errorMessage(error)}`)
    void shutdown('SIGTERM', 1)
  }

  try {
    for (const directory of ['app', 'shared']) {
      const watcher = watch(resolve(root, directory), { recursive: true }, handleSourceChange)
      watcher.on('error', handleWatcherError)
      watchers.push(watcher)
    }
  } catch (error) {
    report(`Could not watch application source: ${errorMessage(error)}`)
    closeWatchers()
    resolveCompletion(1)
    return completed
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = () => {
      void shutdown(signal, 0)
    }
    signalHandlers.set(signal, handler)
    onSignal(signal, handler)
  }

  startChild()
  return completed
}

if (import.meta.main) {
  const exitCode = await runDevelopmentLauncher({
    root: __TERMWEAVE_PROJECT_ROOT__,
    bunExecutable: __TERMWEAVE_BUN_EXECUTABLE__,
  })
  process.exit(exitCode)
}
