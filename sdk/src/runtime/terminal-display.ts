import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  BACKGROUND_COLOR,
  FOREGROUND_COLOR,
  MONITOR_OVERLAY_ENABLED,
  TERMINAL_GRID,
} from '../../shared/terminal-config'
import type { TerminalFrame } from '../../shared/terminal-protocol'
import { createCrtRenderer } from './crt-renderer'
import { FONT_FAMILY, MONITOR_LAYOUT, monitorBezelFilter, terminalScale } from './monitor-layout'

const loadingFrames = ['|', '/', '-', '\\'] as const
const loadingLabel = 'Loading...'
const loadingTextWidth = `${loadingFrames[0]} ${loadingLabel}`.length
const loadingRow = Math.floor(TERMINAL_GRID.rows / 2) + 1
const loadingColumn = Math.max(1, Math.floor((TERMINAL_GRID.cols - loadingTextWidth) / 2) + 1)

function requiredElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector} element`)
  return element
}

export function createTerminalDisplay() {
  const appWebview = getCurrentWebview()
  const appWindow = getCurrentWindow()
  const appHost = requiredElement<HTMLElement>('#app')
  const displayStage = requiredElement<HTMLDivElement>('#display-stage')
  const monitorArtboard = requiredElement<HTMLDivElement>('#monitor-artboard')
  const monitorSurround = requiredElement<HTMLDivElement>('#monitor-surround')
  const monitorOverlay = requiredElement<HTMLDivElement>('#monitor-overlay')
  const terminalHost = requiredElement<HTMLDivElement>('#terminal')
  const crtEffectsHost = requiredElement<HTMLDivElement>('#crt-effects')
  const crtAberrationHost = requiredElement<HTMLDivElement>('#crt-aberration')
  const crtAberrationCanvas = requiredElement<HTMLCanvasElement>('#crt-aberration-canvas')
  const terminal = new Terminal({
    cols: TERMINAL_GRID.cols,
    rows: TERMINAL_GRID.rows,
    scrollback: 0,
    cursorBlink: false,
    convertEol: false,
    customGlyphs: true,
    fontFamily: FONT_FAMILY,
    fontSize: TERMINAL_GRID.fontSize,
    letterSpacing: 0,
    lineHeight: 1,
    theme: {
      background: BACKGROUND_COLOR,
      foreground: FOREGROUND_COLOR,
      cursor: FOREGROUND_COLOR,
    },
  })
  terminal.attachCustomWheelEventHandler((event) => {
    event.preventDefault()
    event.stopPropagation()
    return false
  })

  let disposed = false
  let fit = () => {}
  let focusFrame: number | undefined
  let inputSender: (data: string) => boolean = () => false
  let loadingFrame = 0
  let loadingTimer: number | undefined
  let resizeFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined
  let terminalOpened = false
  let unlistenWindowFocus: (() => void) | undefined
  let resolveFirstFrame: (() => void) | undefined
  const firstFrame = new Promise<void>((resolve) => {
    resolveFirstFrame = resolve
  })

  monitorSurround.hidden = !MONITOR_OVERLAY_ENABLED
  monitorOverlay.hidden = !MONITOR_OVERLAY_ENABLED
  const bezel = monitorBezelFilter(BACKGROUND_COLOR)
  const monitorStyles = {
    '--monitor-bezel-brightness': bezel.brightness,
    '--monitor-bezel-contrast': bezel.contrast,
    '--monitor-bezel-sepia': bezel.sepia,
    '--monitor-bezel-saturation': bezel.saturation,
    '--monitor-bezel-hue': `${bezel.hueRotation}deg`,
    '--monitor-width': `${MONITOR_LAYOUT.width}px`,
    '--monitor-height': `${MONITOR_LAYOUT.height}px`,
    '--monitor-artboard-left': `${-MONITOR_LAYOUT.screenCenterX}px`,
    '--monitor-artboard-top': `${-MONITOR_LAYOUT.screenCenterY}px`,
    '--monitor-screen-left': `${MONITOR_LAYOUT.screenLeft}px`,
    '--monitor-screen-top': `${MONITOR_LAYOUT.screenTop}px`,
    '--monitor-screen-width': `${MONITOR_LAYOUT.screenWidth}px`,
    '--monitor-screen-height': `${MONITOR_LAYOUT.screenHeight}px`,
  }
  for (const [property, value] of Object.entries(monitorStyles)) {
    monitorArtboard.style.setProperty(property, String(value))
  }
  const crtRenderer = createCrtRenderer({
    aberrationCanvas: crtAberrationCanvas,
    aberrationHost: crtAberrationHost,
    effectsHost: crtEffectsHost,
    onRendererChanged: () => {
      if (!disposed && terminalOpened) fit()
    },
    terminal,
    terminalHost,
  })

  const renderLoadingIndicator = (onParsed?: () => void) => {
    const frame = loadingFrames[loadingFrame % loadingFrames.length]
    loadingFrame += 1
    terminal.write(
      `\x1b[?25l\x1b[${loadingRow};${loadingColumn}H${frame} ${loadingLabel}\x1b[H`,
      onParsed,
    )
  }

  const startLoadingIndicator = () => {
    if (MONITOR_OVERLAY_ENABLED) return Promise.resolve()
    if (loadingTimer !== undefined) return Promise.resolve()

    loadingTimer = window.setInterval(renderLoadingIndicator, 120)
    return new Promise<void>((resolve) => renderLoadingIndicator(resolve))
  }

  const stopLoadingIndicator = () => {
    if (loadingTimer === undefined) return
    window.clearInterval(loadingTimer)
    loadingTimer = undefined
    terminal.write(`\x1b[${loadingRow};${loadingColumn}H${' '.repeat(loadingTextWidth)}\x1b[H`)
  }

  fit = () => {
    const scale = terminalScale(appHost.clientWidth, appHost.clientHeight)

    // Keep xterm on one fixed logical surface and scale the complete monitor stage.
    terminalHost.style.width = `${TERMINAL_GRID.targetWidth}px`
    terminalHost.style.height = `${TERMINAL_GRID.targetHeight}px`
    displayStage.style.setProperty('--terminal-scale', String(scale))
    terminal.options.fontSize = TERMINAL_GRID.fontSize
    terminal.options.letterSpacing = 0
  }

  const scheduleFocus = () => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    crtRenderer.clearAberration()
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      if (disposed || !terminalOpened) return

      void appWebview
        .setFocus()
        .catch(() => {})
        .then(() => {
          if (!disposed) terminal.focus()
        })
    })
  }

  const scheduleFit = () => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      if (!disposed) {
        fit()
        scheduleFocus()
      }
    })
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') scheduleFocus()
  }

  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (document.activeElement === terminal.textarea) return
    scheduleFocus()
    if (event.metaKey || event.ctrlKey || event.altKey) return

    const data = {
      ArrowLeft: '\u001b[D',
      ArrowRight: '\u001b[C',
      ArrowUp: '\u001b[A',
      ArrowDown: '\u001b[B',
    }[event.key]
    if (!data || !inputSender(data)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  window.addEventListener('focus', scheduleFocus)
  window.addEventListener('keydown', handleGlobalKeyDown, true)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return {
    firstFrame,
    fit,
    scheduleFocus,

    async open() {
      if (disposed) return

      fit()
      terminal.open(terminalHost)
      terminalOpened = true
      crtRenderer.enable()
      await startLoadingIndicator()
      if (disposed) return

      unlistenWindowFocus = await appWindow.onFocusChanged(({ payload }) => {
        if (payload) scheduleFocus()
      })

      resizeObserver = new ResizeObserver(scheduleFit)
      resizeObserver.observe(appHost)
    },

    setInputSender(sender: (data: string) => boolean) {
      inputSender = sender
    },

    subscribeInput(handler: (data: string) => void) {
      return terminal.onData(handler)
    },

    showStartupError(error: unknown) {
      if (disposed) return Promise.resolve()

      if (!terminalOpened) {
        fit()
        terminal.open(terminalHost)
        terminalOpened = true
        crtRenderer.enable()
      }
      return new Promise<void>((resolve) => {
        terminal.write(`\r\nFailed to start sidecar: ${String(error)}\r\n`, resolve)
      })
    },

    writeFrame(frame: TerminalFrame, acknowledge: () => void) {
      stopLoadingIndicator()
      const completeFrame = () => {
        acknowledge()
        const resolve = resolveFirstFrame
        if (!resolve) return

        resolveFirstFrame = undefined
        resolve()
      }

      terminal.write(frame.data, completeFrame)
    },

    writeRecoveryError(error: unknown) {
      terminal.write(`\r\nSidecar recovery failed: ${String(error)}\r\n`)
    },

    stopLoadingIndicator,

    dispose() {
      if (disposed) return
      disposed = true
      resizeObserver?.disconnect()
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
      if (loadingTimer !== undefined) window.clearInterval(loadingTimer)
      unlistenWindowFocus?.()
      window.removeEventListener('focus', scheduleFocus)
      window.removeEventListener('keydown', handleGlobalKeyDown, true)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      crtRenderer.dispose()
      if (terminalOpened) terminal.dispose()
    },
  }
}

export type TerminalDisplay = ReturnType<typeof createTerminalDisplay>
