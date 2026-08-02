import { WebglAddon } from '@xterm/addon-webgl'
import {
  Terminal,
  type IDisposable,
  type ITerminalAddon,
  type ITerminalInitOnlyOptions,
  type ITerminalOptions,
} from '@xterm/xterm'
import type { AppConfig } from '../shared/config'
import { terminalFontFamily } from './presentation'

export type ProcessExit = Readonly<{
  code: number | null
  signal: number | null
}>

export interface TerminalLike {
  write(data: string | Uint8Array, callback?: () => void): void
  onData(handler: (data: string) => void): IDisposable
  dispose(): void
  focus(): void
}

export interface ChildLike {
  write(data: string | Uint8Array | number[]): Promise<void>
  kill(): Promise<void>
}

interface DataEmitter<T> {
  on(event: 'data', listener: (data: T) => void): unknown
  off(event: 'data', listener: (data: T) => void): unknown
}

export type RawChunk = Uint8Array | number[]

export interface SidecarCommandLike {
  stdout: DataEmitter<RawChunk>
  stderr: DataEmitter<RawChunk>
  on(event: 'error', listener: (error: string) => void): unknown
  on(event: 'close', listener: (exit: ProcessExit) => void): unknown
  off(event: 'error', listener: (error: string) => void): unknown
  off(event: 'close', listener: (exit: ProcessExit) => void): unknown
  spawn(): Promise<ChildLike>
}

interface CloseRequestLike {
  preventDefault(): void
}

export interface AppWindowLike {
  show(): Promise<void>
  setFocus(): Promise<void>
  close(): Promise<void>
  onCloseRequested(handler: (event: CloseRequestLike) => void | Promise<void>): Promise<() => void>
}

type TerminalSessionOptions = {
  terminal: TerminalLike
  command: SidecarCommandLike
  appWindow: AppWindowLike
}

export function terminalOptions(config: AppConfig): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    cols: config.terminalGrid.cols,
    rows: config.terminalGrid.rows,
    fontFamily: terminalFontFamily,
    fontSize: config.terminalGrid.fontSize,
    letterSpacing: 0,
    lineHeight: 1,
    scrollback: 0,
    cursorBlink: false,
    convertEol: false,
    customGlyphs: true,
    theme: {
      background: config.backgroundColor,
      foreground: config.foregroundColor,
      cursor: config.foregroundColor,
    },
  }
}

export function createTerminal(config: AppConfig) {
  const terminal = new Terminal(terminalOptions(config))
  terminal.attachCustomWheelEventHandler((event) => {
    event.preventDefault()
    event.stopPropagation()
    return false
  })
  return terminal
}

export interface WebglAddonLike extends ITerminalAddon {
  onContextLoss(handler: () => void): IDisposable
}

export type CreateWebglAddon = () => WebglAddonLike

export function enableWebglRenderer(
  terminal: Pick<Terminal, 'loadAddon'>,
  createAddon: CreateWebglAddon = () => new WebglAddon(),
): IDisposable {
  let addon: WebglAddonLike | undefined
  let contextLossSubscription: IDisposable | undefined
  let disposed = false

  const dispose = () => {
    if (disposed) return
    disposed = true
    try {
      contextLossSubscription?.dispose()
    } catch {
      // Renderer fallback must survive partially disposed event state.
    }
    contextLossSubscription = undefined
    try {
      addon?.dispose()
    } catch {
      // xterm's default renderer remains the final fallback.
    }
    addon = undefined
  }

  try {
    addon = createAddon()
    contextLossSubscription = addon.onContextLoss(dispose)
    terminal.loadAddon(addon)
  } catch {
    dispose()
  }

  return { dispose }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function terminalText(text: string) {
  return text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
}

function rawBytes(data: RawChunk) {
  return data instanceof Uint8Array ? data : Uint8Array.from(data)
}

export function createTerminalSession({ terminal, command, appWindow }: TerminalSessionOptions) {
  const stderrDecoder = new TextDecoder()

  let child: ChildLike | undefined
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
  let spawnPromise: Promise<ChildLike> | undefined
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

  const handleStdout = (data: RawChunk) => {
    const bytes = rawBytes(data)
    if (disposed || bytes.byteLength === 0) return
    terminal.write(bytes, () => {
      void revealWindow()
    })
  }

  const handleStderr = (data: RawChunk) => {
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

  async function handleClose(exit: ProcessExit) {
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

  const handleCloseRequested = (event: CloseRequestLike) => {
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
