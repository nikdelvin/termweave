import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  BACKGROUND_COLOR,
  FOREGROUND_COLOR,
  MONITOR_OVERLAY_ENABLED,
  SHOW_DIAGNOSTICS,
  TERMINAL_GRID,
} from '../../shared/terminal-config'
import type { TerminalFrame } from '../../shared/terminal-protocol'
import { diagnostic } from '../diagnostics'
import { createCrtRenderer } from './crt-renderer'
import {
  FONT_FAMILY,
  MIN_HORIZONTAL_BEZEL_PX,
  MIN_VERTICAL_BEZEL_PX,
  MONITOR_LAYOUT,
  MONITOR_OVERLAY,
  monitorBezelFilter,
  terminalScale,
} from './monitor-layout'

const FONT_MEASUREMENT_SIZE = 100
const loadingFrames = ['|', '/', '-', '\\'] as const
const loadingLabel = 'Loading...'
const loadingTextWidth = `${loadingFrames[0]} ${loadingLabel}`.length
const loadingRow = Math.floor(TERMINAL_GRID.rows / 2) + 1
const loadingColumn = Math.max(1, Math.floor((TERMINAL_GRID.cols - loadingTextWidth) / 2) + 1)

function requiredElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector} element`)
  diagnostic('dom', 'required element found', { selector, tag: element.tagName })
  return element
}

function canvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to measure terminal font')
  return context
}

function rectSnapshot(rect: DOMRect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }
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
  const metricsContext = canvasContext(document.createElement('canvas'))
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
  let lastFitSignature = ''
  let loadingFrame = 0
  let loadingTimer: number | undefined
  let resizeFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined
  let socketBytesReceived = 0
  let socketMessageCount = 0
  let terminalOpened = false
  let unlistenWindowFocus: (() => void) | undefined
  let xtermParseCount = 0
  let xtermRenderCount = 0
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

  diagnostic('xterm', 'Terminal instance created', {
    cols: terminal.cols,
    rows: terminal.rows,
  })

  if (SHOW_DIAGNOSTICS) {
    terminal.onRender(({ start, end }) => {
      xtermRenderCount += 1
      diagnostic('xterm', 'render event', {
        count: xtermRenderCount,
        startRow: start,
        endRow: end,
      })
    })
    terminal.onWriteParsed(() => {
      xtermParseCount += 1
      diagnostic('xterm', 'write parsed', { count: xtermParseCount })
    })
    terminal.onResize(({ cols, rows }) => {
      diagnostic('xterm', 'terminal resized', { cols, rows })
    })
  }

  const terminalSnapshot = () => {
    const buffer = terminal.buffer.active
    const nonEmptyLines: string[] = []
    for (let row = 0; row < Math.min(buffer.length, 12); row += 1) {
      const text = buffer.getLine(row)?.translateToString(true).trimEnd()
      if (text) nonEmptyLines.push(`${row}: ${text}`)
    }

    return {
      bufferType: terminal.buffer.active.type,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      baseY: buffer.baseY,
      viewportY: buffer.viewportY,
      lines: nonEmptyLines,
    }
  }

  const renderLoadingIndicator = (onParsed?: () => void) => {
    const frame = loadingFrames[loadingFrame % loadingFrames.length]
    loadingFrame += 1
    terminal.write(
      `\x1b[?25l\x1b[${loadingRow};${loadingColumn}H${frame} ${loadingLabel}\x1b[H`,
      onParsed,
    )
  }

  const startLoadingIndicator = () => {
    if (MONITOR_OVERLAY_ENABLED) {
      diagnostic('xterm', 'loading indicator skipped for monitor overlay')
      return Promise.resolve()
    }
    if (loadingTimer !== undefined) return Promise.resolve()

    loadingTimer = window.setInterval(renderLoadingIndicator, 120)
    diagnostic('xterm', 'loading indicator started', {
      row: loadingRow,
      column: loadingColumn,
    })
    return new Promise<void>((resolve) => renderLoadingIndicator(resolve))
  }

  const stopLoadingIndicator = () => {
    if (loadingTimer === undefined) return
    window.clearInterval(loadingTimer)
    loadingTimer = undefined
    terminal.write(`\x1b[${loadingRow};${loadingColumn}H${' '.repeat(loadingTextWidth)}\x1b[H`)
    diagnostic('xterm', 'loading indicator stopped')
  }

  const monitorLayoutSnapshot = (scale: number) => {
    const artboardRect = monitorArtboard.getBoundingClientRect()
    const terminalRect = terminalHost.getBoundingClientRect()
    const expectedScreenRect = {
      x: artboardRect.x + MONITOR_LAYOUT.screenLeft * scale,
      y: artboardRect.y + MONITOR_LAYOUT.screenTop * scale,
      width: MONITOR_LAYOUT.screenWidth * scale,
      height: MONITOR_LAYOUT.screenHeight * scale,
    }

    return {
      source: MONITOR_OVERLAY,
      normalized: MONITOR_LAYOUT,
      artboardRect: rectSnapshot(artboardRect),
      terminalRect: rectSnapshot(terminalRect),
      expectedScreenRect,
      alignmentError: {
        x: terminalRect.x - expectedScreenRect.x,
        y: terminalRect.y - expectedScreenRect.y,
        width: terminalRect.width - expectedScreenRect.width,
        height: terminalRect.height - expectedScreenRect.height,
      },
    }
  }

  const measureFont = () => {
    metricsContext.font = `${FONT_MEASUREMENT_SIZE}px ${FONT_FAMILY}`
    const metrics = metricsContext.measureText('W')
    return {
      widthRatio: metrics.width / FONT_MEASUREMENT_SIZE,
      heightRatio:
        (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / FONT_MEASUREMENT_SIZE,
    }
  }

  fit = () => {
    const pixelRatio = window.devicePixelRatio || 1
    const scale = terminalScale(appHost.clientWidth, appHost.clientHeight)
    const screenInsetX = (appHost.clientWidth - TERMINAL_GRID.targetWidth * scale) / 2
    const screenInsetY = (appHost.clientHeight - TERMINAL_GRID.targetHeight * scale) / 2
    const fontMetrics = measureFont()
    const deviceCharWidth = Math.floor(fontMetrics.widthRatio * TERMINAL_GRID.fontSize * pixelRatio)
    const deviceCharHeight = Math.ceil(
      fontMetrics.heightRatio * TERMINAL_GRID.fontSize * pixelRatio,
    )

    // Keep xterm on one fixed logical surface and scale the complete monitor stage.
    terminalHost.style.width = `${TERMINAL_GRID.targetWidth}px`
    terminalHost.style.height = `${TERMINAL_GRID.targetHeight}px`
    displayStage.style.setProperty('--terminal-scale', String(scale))
    terminal.options.fontSize = TERMINAL_GRID.fontSize
    terminal.options.letterSpacing = 0

    const fitSignature = [appHost.clientWidth, appHost.clientHeight, pixelRatio, scale].join(':')
    if (fitSignature === lastFitSignature) return
    lastFitSignature = fitSignature
    diagnostic('layout', 'terminal fitted', {
      app: `${appHost.clientWidth}x${appHost.clientHeight}`,
      terminal: `${TERMINAL_GRID.targetWidth}x${TERMINAL_GRID.targetHeight}`,
      displayedTerminal: `${TERMINAL_GRID.targetWidth * scale}x${TERMINAL_GRID.targetHeight * scale}`,
      displayedMonitor: `${MONITOR_LAYOUT.width * scale}x${MONITOR_LAYOUT.height * scale}`,
      screenInsets: {
        x: screenInsetX,
        y: screenInsetY,
        minimumHorizontalBezel: MIN_HORIZONTAL_BEZEL_PX,
        minimumVerticalBezel: MIN_VERTICAL_BEZEL_PX,
      },
      pixelRatio,
      deviceCharWidth,
      deviceCharHeight,
      scale,
      fontSize: TERMINAL_GRID.fontSize,
      letterSpacing: terminal.options.letterSpacing,
      fontMetrics,
      renderer: crtRenderer.rendererName(),
      terminalOpened,
      monitor: monitorLayoutSnapshot(scale),
    })
  }

  const scheduleFocus = () => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    crtRenderer.clearAberration()
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      if (disposed || !terminalOpened) return

      diagnostic('focus', 'requesting webview and xterm focus')
      void appWebview
        .setFocus()
        .catch((error: unknown) => {
          diagnostic('focus', 'webview focus failed', error, 'error')
        })
        .then(() => {
          if (!disposed) {
            terminal.focus()
            diagnostic('focus', 'xterm focus requested', {
              activeElement: document.activeElement?.tagName,
            })
          }
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
    diagnostic('window', 'visibility changed', { state: document.visibilityState })
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
      diagnostic('xterm', 'opening terminal', {
        hostInlineSize: `${terminalHost.style.width}x${terminalHost.style.height}`,
      })
      terminal.open(terminalHost)
      terminalOpened = true
      crtRenderer.enable()
      await startLoadingIndicator()
      if (disposed) return

      const terminalRect = terminalHost.getBoundingClientRect()
      diagnostic('xterm', 'terminal opened', {
        cols: terminal.cols,
        rows: terminal.rows,
        hostRect: rectSnapshot(terminalRect),
        hasElement: Boolean(terminal.element),
        hasTextarea: Boolean(terminal.textarea),
        rowContainers: terminalHost.querySelectorAll('.xterm-rows').length,
      })

      unlistenWindowFocus = await appWindow.onFocusChanged(({ payload }) => {
        diagnostic('tauri', 'window focus changed', { focused: payload })
        if (payload) scheduleFocus()
      })
      diagnostic('tauri', 'window focus listener installed')

      resizeObserver = new ResizeObserver(scheduleFit)
      resizeObserver.observe(appHost)
      diagnostic('layout', 'resize observer installed')
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
        diagnostic('bootstrap', 'first OpenTUI frame parsed', {
          frameId: frame.frameId,
          bytes: frame.data.byteLength,
        })
        resolve()
      }

      if (!SHOW_DIAGNOSTICS) {
        terminal.write(frame.data, completeFrame)
        return
      }

      const byteLength = frame.data.byteLength
      const messageNumber = ++socketMessageCount
      socketBytesReceived += byteLength
      diagnostic('websocket', 'message received', {
        message: messageNumber,
        frameId: frame.frameId,
        bytes: byteLength,
        totalBytes: socketBytesReceived,
        dataType: frame.data.constructor.name,
      })
      terminal.write(frame.data, () => {
        try {
          diagnostic('xterm', 'write callback completed', {
            message: messageNumber,
            frameId: frame.frameId,
            bytes: byteLength,
            snapshot: terminalSnapshot(),
          })
        } finally {
          completeFrame()
        }
      })
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
      crtRenderer.dispose('frontend cleanup')
      if (terminalOpened) terminal.dispose()
    },
  }
}

export type TerminalDisplay = ReturnType<typeof createTerminalDisplay>
