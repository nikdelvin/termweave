import { WebglAddon } from '@xterm/addon-webgl'
import {
  Terminal,
  type IDisposable,
  type ITerminalAddon,
  type ITerminalInitOnlyOptions,
  type ITerminalOptions,
} from '@xterm/xterm'
import type { AppConfig } from '../config'
import {
  TERMINAL_CURSOR_COLOR,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_FOREGROUND_COLOR,
  TERMINAL_GRID,
} from '../constants'
import {
  CrtPostprocessor,
  discoverActivatedWebglCanvas,
  type CrtPostprocessorOptions,
} from './crt-postprocessor'
import { browserAnimationFrameScheduler, createGlyphAtlasMonitor } from './glyph-atlas'

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

export function terminalOptions(
  config: Pick<AppConfig, 'themeColor'>,
): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    cols: TERMINAL_GRID.cols,
    rows: TERMINAL_GRID.rows,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: TERMINAL_FONT_SIZE,
    letterSpacing: 0,
    lineHeight: 1,
    scrollback: 0,
    cursorBlink: false,
    convertEol: false,
    customGlyphs: true,
    theme: {
      background: config.themeColor,
      foreground: TERMINAL_FOREGROUND_COLOR,
      cursor: TERMINAL_CURSOR_COLOR,
    },
  }
}

export function createTerminal(config: Pick<AppConfig, 'themeColor'>) {
  const terminal = new Terminal(terminalOptions(config))
  terminal.attachCustomWheelEventHandler((event) => {
    event.preventDefault()
    event.stopPropagation()
    return false
  })
  return terminal
}

export interface WebglAddonLike extends ITerminalAddon {
  readonly textureAtlas?: HTMLCanvasElement
  onContextLoss(handler: () => void): IDisposable
  onChangeTextureAtlas?(handler: (canvas: HTMLCanvasElement) => void): IDisposable
  onAddTextureAtlasCanvas?(handler: (canvas: HTMLCanvasElement) => void): IDisposable
  onRemoveTextureAtlasCanvas?(handler: (canvas: HTMLCanvasElement) => void): IDisposable
}

export type CreateWebglAddon = () => WebglAddonLike
export type CreateCrtPostprocessor = (
  options: CrtPostprocessorOptions,
) => Pick<CrtPostprocessor, 'dispose'>

type RendererConfig = Pick<AppConfig, 'themeColor'>

export type WebglRendererStatus =
  | Readonly<{
      kind: 'active'
    }>
  | Readonly<{
      kind: 'fallback'
      message: string
    }>

export interface WebglRendererController extends IDisposable {
  readonly status: WebglRendererStatus
  onStatusChange(handler: (status: WebglRendererStatus) => void): IDisposable
}

type RendererTerminal = Pick<Terminal, 'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'>

export function enableWebglRenderer(
  terminal: RendererTerminal,
  config: RendererConfig,
  createAddon?: CreateWebglAddon,
  createPostprocessor: CreateCrtPostprocessor = (options) => new CrtPostprocessor(options),
): WebglRendererController {
  const createWebglAddon = createAddon ?? (() => new WebglAddon(false))
  type RendererGeneration = {
    addon: WebglAddonLike
    postprocessor?: Pick<CrtPostprocessor, 'dispose'>
    subscriptions: IDisposable[]
  }

  let generation: RendererGeneration | undefined
  let disposed = false
  let fallbackLatched = false
  let status: WebglRendererStatus = {
    kind: 'fallback',
    message: 'Renderer activation did not complete.',
  }
  const statusHandlers = new Set<(status: WebglRendererStatus) => void>()
  let recycleWebglAddon = () => {}
  const atlasMonitor = createGlyphAtlasMonitor({
    onRecycle: () => recycleWebglAddon(),
    scheduler: browserAnimationFrameScheduler,
  })

  const setStatus = (nextStatus: WebglRendererStatus) => {
    status = nextStatus
    for (const handler of statusHandlers) {
      try {
        handler(status)
      } catch {
        // A diagnostic observer must not interrupt renderer fallback or disposal.
      }
    }
  }

  const disposeGeneration = () => {
    const current = generation
    generation = undefined
    atlasMonitor.resetGeneration()
    if (!current) return
    for (const subscription of current.subscriptions.splice(0)) {
      try {
        subscription.dispose()
      } catch {
        // Renderer replacement must survive partially disposed event state.
      }
    }
    try {
      current.postprocessor?.dispose()
    } catch {
      // Partial WebGL state must not prevent the stock addon from being removed.
    }
    try {
      current.addon.dispose()
    } catch {
      // xterm's default renderer remains the final fallback.
    }
  }

  const requestDefaultRendererRedraw = () => {
    const redrawTerminal = terminal as Partial<RendererTerminal>
    if (typeof redrawTerminal.refresh !== 'function' || typeof redrawTerminal.rows !== 'number')
      return
    try {
      redrawTerminal.refresh(0, Math.max(0, redrawTerminal.rows - 1))
    } catch {
      // Default-renderer activation remains useful even if redraw scheduling fails.
    }
  }

  const fallback = (message: string, failure?: { emergencyHandoff(): void }) => {
    if (fallbackLatched || disposed) return
    fallbackLatched = true
    setStatus({ kind: 'fallback', message })
    try {
      failure?.emergencyHandoff()
    } catch {
      // Emergency handoff is best effort and never replaces renderer fallback.
    }
    atlasMonitor.dispose()
    disposeGeneration()
    requestDefaultRendererRedraw()
  }

  const activateGeneration = () => {
    const addon = createWebglAddon()
    const current: RendererGeneration = { addon, subscriptions: [] }
    generation = current
    const terminalElement = terminal.element
    if (!terminalElement) throw new Error('CRT effects require an open public xterm element')
    const canvasesBeforeActivation = new Set(
      terminalElement.querySelectorAll<HTMLCanvasElement>('canvas'),
    )

    try {
      current.subscriptions.push(
        addon.onContextLoss(() => {
          if (generation === current) fallback('The WebGL context was permanently lost.')
        }),
      )
      if (addon.onChangeTextureAtlas) {
        current.subscriptions.push(
          addon.onChangeTextureAtlas((canvas) => {
            if (generation === current) atlasMonitor.changePage(canvas)
          }),
        )
      }
      if (addon.onAddTextureAtlasCanvas) {
        current.subscriptions.push(
          addon.onAddTextureAtlasCanvas((canvas) => {
            if (generation === current) atlasMonitor.addPage(canvas)
          }),
        )
      }
      if (addon.onRemoveTextureAtlasCanvas) {
        current.subscriptions.push(
          addon.onRemoveTextureAtlasCanvas((canvas) => {
            if (generation === current) atlasMonitor.removePage(canvas)
          }),
        )
      }

      terminal.loadAddon(addon)

      const activated = discoverActivatedWebglCanvas(terminalElement, canvasesBeforeActivation)
      const textureUnits = activated.gl.getParameter(activated.gl.MAX_TEXTURE_IMAGE_UNITS)
      if (typeof textureUnits !== 'number' || !Number.isFinite(textureUnits) || textureUnits < 1) {
        throw new Error('The WebGL glyph-atlas page limit is unavailable')
      }
      atlasMonitor.setMaximumPages(Math.min(32, Math.floor(textureUnits)))
      if (addon.textureAtlas) atlasMonitor.addPage(addon.textureAtlas)

      current.postprocessor = createPostprocessor({
        terminal,
        canvas: activated.canvas,
        gl: activated.gl,
        themeColor: config.themeColor,
        onRuntimeFailure: (failure) => {
          if (generation === current) {
            fallback(
              'The CRT postprocessor failed a framebuffer, resize, restoration, or presentation check.',
              failure,
            )
          }
        },
      })
      setStatus({ kind: 'active' })
    } catch (error) {
      if (generation === current) disposeGeneration()
      throw error
    }
  }

  recycleWebglAddon = () => {
    if (disposed || fallbackLatched || !generation) return
    disposeGeneration()
    try {
      activateGeneration()
      requestDefaultRendererRedraw()
    } catch (error) {
      fallback(`Renderer reactivation failed: ${errorMessage(error)}`)
    }
  }

  try {
    activateGeneration()
  } catch (error) {
    fallback(`Renderer activation failed: ${errorMessage(error)}`)
  }

  return {
    get status() {
      return status
    },
    onStatusChange(handler) {
      statusHandlers.add(handler)
      return {
        dispose() {
          statusHandlers.delete(handler)
        },
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      atlasMonitor.dispose()
      disposeGeneration()
      statusHandlers.clear()
    },
  }
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
