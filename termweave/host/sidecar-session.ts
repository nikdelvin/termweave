import type { IDisposable } from '@xterm/xterm'

export type SidecarExit = Readonly<{
  code: number | null
  signal: number | null
}>

export interface TerminalPort {
  write(data: string | Uint8Array, callback?: () => void): void
  onData(handler: (data: string) => void): IDisposable
  dispose(): void
  focus(): void
}

export interface SidecarProcess {
  write(data: string | Uint8Array | number[]): Promise<void>
  kill(): Promise<void>
}

interface DataEmitter<T> {
  on(event: 'data', listener: (data: T) => void): unknown
  off(event: 'data', listener: (data: T) => void): unknown
}

export type SidecarOutputChunk = Uint8Array | number[]

export interface SidecarCommand {
  stdout: DataEmitter<SidecarOutputChunk>
  stderr: DataEmitter<SidecarOutputChunk>
  on(event: 'error', listener: (error: string) => void): unknown
  on(event: 'close', listener: (exit: SidecarExit) => void): unknown
  off(event: 'error', listener: (error: string) => void): unknown
  off(event: 'close', listener: (exit: SidecarExit) => void): unknown
  spawn(): Promise<SidecarProcess>
}

interface CloseRequest {
  preventDefault(): void
}

export interface DesktopWindow {
  show(): Promise<void>
  setFocus(): Promise<void>
  close(): Promise<void>
  onCloseRequested(handler: (event: CloseRequest) => void | Promise<void>): Promise<() => void>
}

type SidecarSessionOptions = {
  terminal: TerminalPort
  command: SidecarCommand
  appWindow: DesktopWindow
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function terminalText(text: string) {
  return text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
}

function rawBytes(data: SidecarOutputChunk) {
  return data instanceof Uint8Array ? data : Uint8Array.from(data)
}

export function createSidecarSession({ terminal, command, appWindow }: SidecarSessionOptions) {
  const stderrDecoder = new TextDecoder()

  let child: SidecarProcess | undefined
  let cleanupPromise: Promise<void> | undefined
  let closePromise: Promise<void> | undefined
  let disposed = false
  let inputFailed = false
  let inputSubscription: IDisposable | undefined
  let inputWrite = Promise.resolve()
  let processExited = false
  let processListenersAttached = false
  let revealPromise: Promise<void> | undefined
  let revealed = false
  let spawnPromise: Promise<SidecarProcess> | undefined
  let stderrStarted = false
  let unlistenCloseRequested: (() => void) | undefined

  const revealWindow = () => {
    if (disposed || revealed) return Promise.resolve()
    if (revealPromise) return revealPromise

    revealPromise = (async () => {
      try {
        await appWindow.show()
      } catch {
        return
      }

      revealed = true
      if (disposed) return

      try {
        await appWindow.setFocus()
      } catch {
        // The window is already visible; terminal focus is still worth attempting.
      }
      if (!disposed) terminal.focus()
    })().finally(() => {
      revealPromise = undefined
    })
    return revealPromise
  }

  const writeDiagnostic = (message: string) => {
    if (disposed) return
    terminal.write(`\r\n[termweave] ${terminalText(message)}\r\n`, () => {
      void revealWindow()
    })
  }

  const writeStderr = (text: string) => {
    if (disposed || text === '') return
    const prefix = stderrStarted ? '' : '\r\n[sidecar] '
    stderrStarted = true
    terminal.write(`${prefix}${terminalText(text)}`, () => {
      void revealWindow()
    })
  }

  const flushStderr = () => {
    writeStderr(stderrDecoder.decode())
  }

  const handleStdout = (data: SidecarOutputChunk) => {
    const bytes = rawBytes(data)
    if (disposed || bytes.byteLength === 0) return
    terminal.write(bytes, () => {
      void revealWindow()
    })
  }

  const handleStderr = (data: SidecarOutputChunk) => {
    const bytes = rawBytes(data)
    if (disposed || bytes.byteLength === 0) return
    writeStderr(stderrDecoder.decode(bytes, { stream: true }))
  }

  const handleCommandError = (error: string) => {
    writeDiagnostic(`Sidecar process error: ${error}`)
  }

  const removeProcessListeners = () => {
    if (!processListenersAttached) return
    processListenersAttached = false
    command.stdout.off('data', handleStdout)
    command.stderr.off('data', handleStderr)
    command.off('error', handleCommandError)
    command.off('close', handleClose)
  }

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    disposed = true
    inputSubscription?.dispose()
    inputSubscription = undefined
    unlistenCloseRequested?.()
    unlistenCloseRequested = undefined
    removeProcessListeners()

    cleanupPromise = (async () => {
      const spawnedChild = await spawnPromise?.catch(() => undefined)
      const processToKill = child ?? spawnedChild
      child = undefined
      if (processToKill && !processExited) {
        try {
          await processToKill.kill()
        } catch {
          // Cleanup tolerates a child that exited before the kill reached it.
        }
      }
      terminal.dispose()
    })()
    return cleanupPromise
  }

  const closeWindow = () => {
    if (closePromise) return closePromise
    closePromise = (async () => {
      await cleanup()
      await appWindow.close()
    })()
    return closePromise
  }

  async function handleClose(exit: SidecarExit) {
    if (processExited) return
    processExited = true
    child = undefined
    inputSubscription?.dispose()
    inputSubscription = undefined
    flushStderr()
    removeProcessListeners()

    if (disposed) return
    if (exit.code === 0) {
      await closeWindow()
      return
    }

    const reason =
      exit.code === null
        ? `Sidecar exited after signal ${exit.signal ?? 'unknown'}.`
        : `Sidecar exited with code ${exit.code}.`
    writeDiagnostic(reason)
  }

  const handleInput = (data: string) => {
    if (disposed || inputFailed || !child) return
    const target = child
    inputWrite = inputWrite
      .then(() => {
        if (disposed || inputFailed) return
        return target.write(data)
      })
      .catch((error: unknown) => {
        if (disposed || inputFailed) return
        inputFailed = true
        writeDiagnostic(`Could not write to sidecar input: ${errorMessage(error)}`)
      })
  }

  const handleCloseRequested = (event: CloseRequest) => {
    event.preventDefault()
    void closeWindow()
  }

  const attachProcessListeners = () => {
    if (processListenersAttached) return
    processListenersAttached = true
    command.stdout.on('data', handleStdout)
    command.stderr.on('data', handleStderr)
    command.on('error', handleCommandError)
    command.on('close', handleClose)
  }

  return {
    async start() {
      try {
        unlistenCloseRequested = await appWindow.onCloseRequested(handleCloseRequested)
      } catch (error) {
        writeDiagnostic(`Could not register the window close handler: ${errorMessage(error)}`)
        return
      }

      if (disposed) {
        unlistenCloseRequested()
        unlistenCloseRequested = undefined
        return
      }

      attachProcessListeners()
      spawnPromise = command.spawn().then((spawnedChild) => {
        child = spawnedChild
        return spawnedChild
      })

      try {
        await spawnPromise
      } catch (error) {
        removeProcessListeners()
        if (!disposed) writeDiagnostic(`Failed to start sidecar: ${errorMessage(error)}`)
        return
      }

      if (disposed || processExited) return
      inputSubscription = terminal.onData(handleInput)
    },

    cleanup,

    inputIdle() {
      return inputWrite
    },
  }
}
