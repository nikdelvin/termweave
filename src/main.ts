import { diagnostic } from './diagnostics'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { invoke } from '@tauri-apps/api/core'
import { type Child, Command } from '@tauri-apps/plugin-shell'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  FOREGROUND_COLOR,
  SHOW_DIAGNOSTICS,
  SIDECAR_PROTOCOL,
  TERMINAL_GRID,
  THEME_COLOR,
  type SidecarAuthenticate,
  type SidecarAuthenticated,
} from '../shared/terminal-config'
import './styles.css'

const { cols: COLS, rows: ROWS } = TERMINAL_GRID
const FONT_FAMILY = '"Kreative Square"'
const FONT_MEASUREMENT_SIZE = 100
const FONT_FIT_SAFETY = 0.995
const HANDSHAKE_TIMEOUT_MS = 2_000
const CONNECTION_RETRY_DELAY_MS = 100
const STARTUP_CONNECTION_ATTEMPTS = 300
const RECOVERY_RECONNECT_ATTEMPTS = import.meta.env.DEV ? 100 : 20
const RECOVERY_CYCLE_RETRY_DELAY_MS = 2_000
const appWebview = getCurrentWebview()
const appWindow = getCurrentWindow()

type BackendDiagnostics = {
  debugBuild: boolean
  os: string
  arch: string
  executable: string
  currentDirectory: string
  instanceId: string
  sidecarToken: string
  sidecarPort: number
}

type SidecarDiagnosticMessage = {
  type: 'diagnostic'
  line: string
}

type ReceivedSidecarHello = {
  type: 'hello'
  protocol: string
  version: number
  instanceId: string
  port: number
}

class SidecarIdentityError extends Error {
  override name = 'SidecarIdentityError'
}

diagnostic('frontend', 'main module evaluating', {
  grid: `${COLS}x${ROWS}`,
  sidecarProtocol: SIDECAR_PROTOCOL,
  fontFamily: FONT_FAMILY,
  windowLabel: appWindow.label,
  webviewLabel: appWebview.label,
})

function getRequiredElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector} element`)
  diagnostic('dom', 'required element found', { selector, tag: element.tagName })
  return element
}

const appHost = getRequiredElement<HTMLElement>('#app')
const terminalHost = getRequiredElement<HTMLDivElement>('#terminal')

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to measure terminal font')
  return context
}

const metricsCanvas = document.createElement('canvas')
const metricsContext = getCanvasContext(metricsCanvas)
let socketAttempt = 0

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sidecarSocketUrl(runtime: BackendDiagnostics) {
  return `ws://127.0.0.1:${runtime.sidecarPort}/terminal`
}

function getSidecarHello(data: unknown): ReceivedSidecarHello | undefined {
  if (typeof data !== 'string') return undefined

  try {
    const message = JSON.parse(data) as Record<string, unknown>
    if (
      message.type === 'hello' &&
      typeof message.protocol === 'string' &&
      typeof message.version === 'number' &&
      typeof message.instanceId === 'string' &&
      typeof message.port === 'number'
    ) {
      return {
        type: 'hello',
        protocol: message.protocol,
        version: message.version,
        instanceId: message.instanceId,
        port: message.port,
      }
    }
  } catch {
    // The first frame must be a valid identity handshake.
  }

  return undefined
}

function getSidecarAuthenticated(data: unknown): SidecarAuthenticated | undefined {
  if (typeof data !== 'string') return undefined

  try {
    const message = JSON.parse(data) as Record<string, unknown>
    if (message.type === 'authenticated') return { type: 'authenticated' }
  } catch {
    // Authentication acknowledgements must be valid JSON.
  }

  return undefined
}

function openSocket(url: string, attempt: number, runtime: BackendDiagnostics) {
  return new Promise<WebSocket>((resolve, reject) => {
    const attemptStartedAt = performance.now()
    let settled = false
    let accepted = false
    let identityAccepted = false
    let handshakeTimer: number | undefined
    diagnostic('websocket', 'connection attempt started', { attempt, url })

    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'

    const rejectConnection = (error: Error, closeSocket: boolean) => {
      if (settled) return
      settled = true
      if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer)
      socket.removeEventListener('message', handleHandshake)

      if (closeSocket && socket.readyState < WebSocket.CLOSING) {
        try {
          socket.close(1008, 'Sidecar authentication failed')
        } catch (closeError) {
          diagnostic('websocket', 'failed to close rejected connection', closeError, 'warn')
        }
      }

      reject(error)
    }

    const handleHandshake = (event: MessageEvent) => {
      if (identityAccepted) {
        const authenticated = getSidecarAuthenticated(event.data)
        if (!authenticated) {
          diagnostic(
            'websocket',
            'sidecar sent data before client authentication completed',
            {
              attempt,
              dataType: event.data?.constructor?.name ?? typeof event.data,
            },
            'error',
          )
          rejectConnection(
            new SidecarIdentityError('Sidecar client authentication was not acknowledged'),
            true,
          )
          return
        }

        accepted = true
        settled = true
        if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer)
        socket.removeEventListener('message', handleHandshake)
        socket.addEventListener('message', handleSocketMessage)
        diagnostic('websocket', 'mutual sidecar authentication completed', {
          attempt,
          elapsedMs: performance.now() - attemptStartedAt,
        })
        resolve(socket)
        return
      }

      const hello = getSidecarHello(event.data)
      if (!hello) {
        diagnostic(
          'websocket',
          'sidecar sent data before identity handshake',
          {
            attempt,
            dataType: event.data?.constructor?.name ?? typeof event.data,
          },
          'error',
        )
        rejectConnection(new SidecarIdentityError('Sidecar identity handshake was missing'), true)
        return
      }

      const matches =
        hello.protocol === SIDECAR_PROTOCOL.name &&
        hello.version === SIDECAR_PROTOCOL.version &&
        hello.instanceId === runtime.instanceId &&
        hello.port === runtime.sidecarPort

      if (!matches) {
        diagnostic(
          'websocket',
          'sidecar identity rejected',
          {
            attempt,
            expectedProtocol: SIDECAR_PROTOCOL,
            receivedProtocol: {
              name: hello.protocol,
              version: hello.version,
            },
            expectedPort: runtime.sidecarPort,
            receivedPort: hello.port,
            instanceMatches: hello.instanceId === runtime.instanceId,
          },
          'error',
        )
        rejectConnection(
          new SidecarIdentityError('Sidecar identity did not match this app instance'),
          true,
        )
        return
      }

      identityAccepted = true
      const authentication: SidecarAuthenticate = {
        type: 'authenticate',
        token: runtime.sidecarToken,
      }
      socket.send(JSON.stringify(authentication))
      diagnostic('websocket', 'sidecar identity accepted; client authentication sent', {
        attempt,
        protocol: hello.protocol,
        version: hello.version,
        port: hello.port,
        elapsedMs: performance.now() - attemptStartedAt,
      })
    }

    socket.addEventListener('message', handleHandshake)
    socket.onopen = () => {
      diagnostic('websocket', 'transport opened; awaiting identity', {
        attempt,
        elapsedMs: performance.now() - attemptStartedAt,
        protocol: socket.protocol,
        extensions: socket.extensions,
      })
    }
    socket.onerror = () => {
      diagnostic(
        'websocket',
        'connection error',
        {
          attempt,
          elapsedMs: performance.now() - attemptStartedAt,
          readyState: socket.readyState,
        },
        'error',
      )
      if (!accepted) rejectConnection(new Error(`WebSocket attempt ${attempt} failed`), true)
    }
    socket.onclose = (event) => {
      diagnostic(
        'websocket',
        'connection closed',
        {
          attempt,
          elapsedMs: performance.now() - attemptStartedAt,
          code: event.code,
          reason: event.reason,
          clean: event.wasClean,
        },
        event.wasClean ? 'info' : 'warn',
      )
      if (!accepted) {
        rejectConnection(
          new Error(`WebSocket attempt ${attempt} closed before authentication completed`),
          false,
        )
      }
    }

    handshakeTimer = window.setTimeout(() => {
      diagnostic(
        'websocket',
        'sidecar authentication handshake timed out',
        {
          attempt,
          timeoutMs: HANDSHAKE_TIMEOUT_MS,
        },
        'error',
      )
      rejectConnection(new SidecarIdentityError('Sidecar authentication handshake timed out'), true)
    }, HANDSHAKE_TIMEOUT_MS)
  })
}

async function connectWithRetry(runtime: BackendDiagnostics, maxAttempts: number, purpose: string) {
  const url = sidecarSocketUrl(runtime)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    socketAttempt += 1
    try {
      return await openSocket(url, socketAttempt, runtime)
    } catch (error) {
      if (error instanceof SidecarIdentityError) {
        diagnostic(
          'websocket',
          'connection rejected without retry',
          {
            attempt: socketAttempt,
            purpose,
            error,
          },
          'error',
        )
        throw error
      }

      diagnostic(
        'websocket',
        'attempt will retry',
        {
          attempt: socketAttempt,
          purpose,
          remaining: maxAttempts - attempt,
          error,
        },
        'warn',
      )
      if (attempt < maxAttempts) await delay(CONNECTION_RETRY_DELAY_MS)
    }
  }

  throw new Error(`OpenTUI sidecar connection failed during ${purpose}`)
}

const terminal = new Terminal({
  cols: COLS,
  rows: ROWS,
  scrollback: 0,
  cursorBlink: false,
  convertEol: false,
  fontFamily: FONT_FAMILY,
  fontSize: 10,
  lineHeight: 1,
  theme: {
    background: THEME_COLOR,
    foreground: FOREGROUND_COLOR,
    cursor: FOREGROUND_COLOR,
  },
})

diagnostic('xterm', 'Terminal instance created', {
  cols: terminal.cols,
  rows: terminal.rows,
})

let socketMessageCount = 0
let socketBytesReceived = 0
let xtermRenderCount = 0
let xtermParseCount = 0
let lastFitSignature = ''
const loadingFrames = ['|', '/', '-', '\\'] as const
const loadingLabel = 'Loading...'
const loadingTextWidth = `${loadingFrames[0]} ${loadingLabel}`.length
const loadingRow = Math.floor(ROWS / 2) + 1
const loadingColumn = Math.max(1, Math.floor((COLS - loadingTextWidth) / 2) + 1)
let loadingFrame = 0
let loadingTimer: number | undefined

function renderLoadingIndicator(onParsed?: () => void) {
  const frame = loadingFrames[loadingFrame % loadingFrames.length]
  loadingFrame += 1
  terminal.write(
    `\x1b[?25l\x1b[${loadingRow};${loadingColumn}H${frame} ${loadingLabel}\x1b[H`,
    onParsed,
  )
}

function startLoadingIndicator() {
  if (loadingTimer !== undefined) return Promise.resolve()

  loadingTimer = window.setInterval(renderLoadingIndicator, 120)
  diagnostic('xterm', 'loading indicator started', {
    row: loadingRow,
    column: loadingColumn,
  })

  return new Promise<void>((resolve) => renderLoadingIndicator(resolve))
}

function stopLoadingIndicator() {
  if (loadingTimer === undefined) return

  window.clearInterval(loadingTimer)
  loadingTimer = undefined
  terminal.write(`\x1b[${loadingRow};${loadingColumn}H${' '.repeat(loadingTextWidth)}\x1b[H`)
  diagnostic('xterm', 'loading indicator stopped')
}

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

function terminalSnapshot() {
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

function getSidecarDiagnostic(data: string): SidecarDiagnosticMessage | undefined {
  try {
    const message = JSON.parse(data) as Partial<SidecarDiagnosticMessage>
    if (message.type === 'diagnostic' && typeof message.line === 'string') {
      return message as SidecarDiagnosticMessage
    }
  } catch {
    // Non-JSON text remains valid terminal output.
  }

  return undefined
}

function handleSocketMessage(event: MessageEvent) {
  if (typeof event.data === 'string') {
    const sidecarDiagnostic = getSidecarDiagnostic(event.data)
    if (sidecarDiagnostic) {
      diagnostic('sidecar.ws', sidecarDiagnostic.line)
      return
    }
  }

  const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : String(event.data)
  const byteLength =
    typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength

  socketMessageCount += 1
  socketBytesReceived += byteLength
  diagnostic('websocket', 'message received', {
    message: socketMessageCount,
    bytes: byteLength,
    totalBytes: socketBytesReceived,
    dataType: event.data?.constructor?.name ?? typeof event.data,
  })

  stopLoadingIndicator()
  terminal.write(data, () => {
    diagnostic('xterm', 'write callback completed', {
      message: socketMessageCount,
      bytes: byteLength,
      snapshot: terminalSnapshot(),
    })
  })
}

let socket: WebSocket | undefined
let child: Child | undefined
let recoveryPromise: Promise<void> | undefined
let recoveryTimer: number | undefined
let inputSubscription: { dispose(): void } | undefined
let resizeObserver: ResizeObserver | undefined
let resizeFrame: number | undefined
let focusFrame: number | undefined
let unlistenWindowFocus: (() => void) | undefined
let terminalOpened = false
let disposed = false

function measureFont() {
  metricsContext.font = `${FONT_MEASUREMENT_SIZE}px ${FONT_FAMILY}`
  const metrics = metricsContext.measureText('W')

  return {
    widthRatio: metrics.width / FONT_MEASUREMENT_SIZE,
    heightRatio:
      (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / FONT_MEASUREMENT_SIZE,
  }
}

function fitTerminalToApp() {
  const pixelRatio = window.devicePixelRatio || 1
  const deviceCellSize = Math.max(
    1,
    Math.floor(
      Math.min(
        (appHost.clientWidth * pixelRatio) / COLS,
        (appHost.clientHeight * pixelRatio) / ROWS,
      ),
    ),
  )
  const cellSize = deviceCellSize / pixelRatio
  const fontMetrics = measureFont()
  const fontSize =
    Math.floor(
      Math.min(cellSize / fontMetrics.widthRatio, cellSize / fontMetrics.heightRatio) *
        FONT_FIT_SAFETY *
        1000,
    ) / 1000

  terminalHost.style.width = `${cellSize * COLS}px`
  terminalHost.style.height = `${cellSize * ROWS}px`
  terminal.options.fontSize = fontSize
  if (terminalOpened) terminal.resize(COLS, ROWS)

  const fitSignature = [
    appHost.clientWidth,
    appHost.clientHeight,
    pixelRatio,
    cellSize,
    fontSize,
  ].join(':')

  if (fitSignature !== lastFitSignature) {
    lastFitSignature = fitSignature
    diagnostic('layout', 'terminal fitted', {
      app: `${appHost.clientWidth}x${appHost.clientHeight}`,
      terminal: `${cellSize * COLS}x${cellSize * ROWS}`,
      pixelRatio,
      deviceCellSize,
      cellSize,
      fontSize,
      fontMetrics,
      terminalOpened,
    })
  }
}

function scheduleTerminalFit() {
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)

  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    if (!disposed) {
      fitTerminalToApp()
      scheduleTerminalFocus()
    }
  })
}

function scheduleTerminalFocus() {
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)

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

function handleVisibilityChange() {
  diagnostic('window', 'visibility changed', { state: document.visibilityState })
  if (document.visibilityState === 'visible') scheduleTerminalFocus()
}

function isMouseMotionInput(data: string) {
  const match = /^\u001b\[<(\d+);\d+;\d+[Mm]$/.exec(data)
  return match ? (Number(match[1]) & 32) !== 0 : false
}

function sendTerminalInput(data: string) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'input', data }))
    if (!isMouseMotionInput(data)) {
      diagnostic('input', 'sent to sidecar', {
        length: data.length,
        escaped: JSON.stringify(data.slice(0, 120)),
      })
    }
    return true
  }

  diagnostic(
    'input',
    'discarded because socket is not open',
    {
      readyState: socket?.readyState,
    },
    'warn',
  )
  return false
}

function handleGlobalKeyDown(event: KeyboardEvent) {
  if (document.activeElement === terminal.textarea) return

  scheduleTerminalFocus()

  if (event.metaKey || event.ctrlKey || event.altKey) return

  const data = {
    ArrowLeft: '\u001b[D',
    ArrowRight: '\u001b[C',
    ArrowUp: '\u001b[A',
    ArrowDown: '\u001b[B',
  }[event.key]

  if (!data || !sendTerminalInput(data)) return

  event.preventDefault()
  event.stopImmediatePropagation()
}

async function spawnSidecar(runtime: BackendDiagnostics, reason: string) {
  diagnostic('sidecar', 'configuring command', {
    reason,
    port: runtime.sidecarPort,
  })

  const command = Command.sidecar('binaries/opentui-sidecar', [], {
    env: {
      TUI_SIDECAR_INSTANCE_ID: runtime.instanceId,
      TUI_SIDECAR_PORT: String(runtime.sidecarPort),
      TUI_SIDECAR_TOKEN: runtime.sidecarToken,
      TUI_SIDECAR_DIAGNOSTICS: import.meta.env.DEV || SHOW_DIAGNOSTICS ? '1' : '0',
    },
  })
  command.stdout.on('data', (data) => {
    diagnostic('sidecar.stdout', 'data', data)
  })
  command.stderr.on('data', (data) => {
    for (const line of data.split(/\r?\n/)) {
      if (line) diagnostic('sidecar.stderr', line)
    }
  })
  command.on('error', (error) => {
    diagnostic('sidecar', 'process error', error, 'error')
  })
  command.on('close', ({ code, signal }) => {
    diagnostic(
      'sidecar',
      'process closed',
      { code, signal },
      code === 0 || disposed ? 'info' : 'error',
    )
  })

  diagnostic('sidecar', 'spawning process', {
    program: 'binaries/opentui-sidecar',
    reason,
    port: runtime.sidecarPort,
  })
  child = await command.spawn()
  diagnostic('sidecar', 'process spawned', { pid: child.pid, reason })
}

async function stopSidecar(reason: string) {
  const processToStop = child
  child = undefined
  if (!processToStop) return

  diagnostic('sidecar', 'stopping process', { pid: processToStop.pid, reason }, 'warn')
  try {
    await processToStop.kill()
    diagnostic('sidecar', 'process stopped', { pid: processToStop.pid, reason })
  } catch (error) {
    diagnostic(
      'sidecar',
      'failed to stop process',
      { pid: processToStop.pid, reason, error },
      'warn',
    )
  }
}

function sendTerminalResize(reason: string) {
  if (socket?.readyState !== WebSocket.OPEN) return

  socket.send(JSON.stringify({ type: 'resize', cols: COLS, rows: ROWS }))
  diagnostic('websocket', 'terminal resize sent', { cols: COLS, rows: ROWS, reason })
}

function activateSocket(nextSocket: WebSocket, runtime: BackendDiagnostics, reason: string) {
  if (disposed) {
    diagnostic('frontend', 'disposed before socket activation; closing socket', { reason }, 'warn')
    nextSocket.close()
    return false
  }

  if (nextSocket.readyState !== WebSocket.OPEN) {
    throw new Error(`Sidecar socket closed before activation during ${reason}`)
  }

  const previousSocket = socket
  socket = nextSocket

  nextSocket.addEventListener(
    'close',
    () => {
      if (disposed || socket !== nextSocket) return

      socket = undefined
      diagnostic(
        'recovery',
        'active sidecar connection was lost',
        {
          reason,
          port: runtime.sidecarPort,
        },
        'warn',
      )
      requestSidecarRecovery(runtime)
    },
    { once: true },
  )

  if (previousSocket && previousSocket !== nextSocket) previousSocket.close()

  diagnostic('frontend', 'sidecar WebSocket activated', {
    attempt: socketAttempt,
    readyState: nextSocket.readyState,
    reason,
    port: runtime.sidecarPort,
  })
  return true
}

async function recoverSidecar(runtime: BackendDiagnostics) {
  if (disposed) return

  diagnostic(
    'recovery',
    'automatic sidecar recovery started',
    {
      port: runtime.sidecarPort,
    },
    'warn',
  )

  try {
    const reconnectedSocket = await connectWithRetry(
      runtime,
      RECOVERY_RECONNECT_ATTEMPTS,
      'recovery reconnect',
    )

    if (!activateSocket(reconnectedSocket, runtime, 'recovery reconnect')) return
    sendTerminalResize('recovery reconnect')
    scheduleTerminalFocus()
    diagnostic('recovery', 'reconnected to the existing sidecar process')
    return
  } catch (error) {
    if (error instanceof SidecarIdentityError) throw error
    if (disposed) return
    diagnostic('recovery', 'existing sidecar did not recover; restarting it', error, 'warn')
  }

  await stopSidecar('recovery reconnect grace period expired')
  await spawnSidecar(runtime, 'automatic crash recovery')
  const restartedSocket = await connectWithRetry(
    runtime,
    STARTUP_CONNECTION_ATTEMPTS,
    'sidecar restart',
  )

  if (!activateSocket(restartedSocket, runtime, 'sidecar restart')) return
  sendTerminalResize('sidecar restart')
  scheduleTerminalFocus()
  diagnostic('recovery', 'sidecar restarted and reconnected')
}

function requestSidecarRecovery(runtime: BackendDiagnostics) {
  if (disposed || recoveryPromise || recoveryTimer !== undefined) return

  recoveryPromise = recoverSidecar(runtime)
    .catch((error: unknown) => {
      diagnostic('recovery', 'automatic sidecar recovery failed', error, 'error')
      if (!disposed) {
        terminal.write(`\r\nSidecar recovery failed: ${String(error)}\r\n`)
      }
    })
    .finally(() => {
      recoveryPromise = undefined

      if (!disposed && !socket) {
        diagnostic(
          'recovery',
          'scheduling another recovery cycle',
          {
            delayMs: RECOVERY_CYCLE_RETRY_DELAY_MS,
          },
          'warn',
        )
        recoveryTimer = window.setTimeout(() => {
          recoveryTimer = undefined
          requestSidecarRecovery(runtime)
        }, RECOVERY_CYCLE_RETRY_DELAY_MS)
      }
    })
}

async function start(runtime: BackendDiagnostics) {
  const url = sidecarSocketUrl(runtime)
  diagnostic('sidecar', 'probing for this app instance sidecar', {
    port: runtime.sidecarPort,
    protocol: SIDECAR_PROTOCOL,
  })
  socketAttempt = 0

  let connectedSocket: WebSocket
  try {
    connectedSocket = await openSocket(url, socketAttempt, runtime)
    diagnostic('sidecar', 'reusing verified existing process')
  } catch (error) {
    if (error instanceof SidecarIdentityError) throw error
    diagnostic('sidecar', 'no verified existing process found', error, 'warn')
    await spawnSidecar(runtime, 'initial startup')
    connectedSocket = await connectWithRetry(
      runtime,
      STARTUP_CONNECTION_ATTEMPTS,
      'initial startup',
    )
  }

  if (!activateSocket(connectedSocket, runtime, 'initial startup')) return

  inputSubscription = terminal.onData((data) => {
    sendTerminalInput(data)
  })
  diagnostic('xterm', 'input subscription installed')

  sendTerminalResize('initial startup')
}

function cleanup() {
  if (disposed) return
  diagnostic('frontend', 'cleanup started')
  disposed = true
  resizeObserver?.disconnect()
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
  if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer)
  if (loadingTimer !== undefined) window.clearInterval(loadingTimer)
  unlistenWindowFocus?.()
  window.removeEventListener('focus', scheduleTerminalFocus)
  window.removeEventListener('keydown', handleGlobalKeyDown, true)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  terminalHost.removeEventListener('pointerdown', scheduleTerminalFocus)
  inputSubscription?.dispose()
  socket?.close()
  void stopSidecar('frontend cleanup')
  if (terminalOpened) terminal.dispose()
}

window.addEventListener('focus', scheduleTerminalFocus)
window.addEventListener('keydown', handleGlobalKeyDown, true)
document.addEventListener('visibilitychange', handleVisibilityChange)
terminalHost.addEventListener('pointerdown', scheduleTerminalFocus)
window.addEventListener('beforeunload', cleanup, { once: true })
import.meta.hot?.dispose(cleanup)

void (async () => {
  diagnostic('bootstrap', 'started')

  let backend: BackendDiagnostics
  try {
    backend = await invoke<BackendDiagnostics>('backend_diagnostics')
    const { sidecarToken: _sidecarToken, ...safeBackendDiagnostics } = backend
    diagnostic('tauri', 'native backend responded', {
      ...safeBackendDiagnostics,
      sidecarTokenPresent: _sidecarToken.length > 0,
    })
  } catch (error) {
    diagnostic('tauri', 'native backend diagnostics failed', error, 'error')
    throw error
  }

  diagnostic('font', 'loading', { query: `16px ${FONT_FAMILY}` })
  const loadedFonts = await document.fonts.load(`16px ${FONT_FAMILY}`)
  diagnostic('font', 'load completed', {
    matches: loadedFonts.length,
    status: document.fonts.status,
    check: document.fonts.check(`16px ${FONT_FAMILY}`),
    registeredFaces: Array.from(document.fonts).map((face) => ({
      family: face.family,
      status: face.status,
      style: face.style,
      weight: face.weight,
    })),
  })

  fitTerminalToApp()
  diagnostic('xterm', 'opening terminal', {
    hostInlineSize: `${terminalHost.style.width}x${terminalHost.style.height}`,
  })
  terminal.open(terminalHost)
  terminalOpened = true
  await startLoadingIndicator()
  await appWindow.show()
  diagnostic('tauri', 'window shown after terminal initialization')
  const terminalRect = terminalHost.getBoundingClientRect()
  diagnostic('xterm', 'terminal opened', {
    cols: terminal.cols,
    rows: terminal.rows,
    hostRect: {
      x: terminalRect.x,
      y: terminalRect.y,
      width: terminalRect.width,
      height: terminalRect.height,
    },
    hasElement: Boolean(terminal.element),
    hasTextarea: Boolean(terminal.textarea),
    rowContainers: terminalHost.querySelectorAll('.xterm-rows').length,
  })

  unlistenWindowFocus = await appWindow.onFocusChanged(({ payload }) => {
    diagnostic('tauri', 'window focus changed', { focused: payload })
    if (payload) scheduleTerminalFocus()
  })
  diagnostic('tauri', 'window focus listener installed')

  resizeObserver = new ResizeObserver(scheduleTerminalFit)
  resizeObserver.observe(appHost)
  diagnostic('layout', 'resize observer installed')

  scheduleTerminalFocus()
  await start(backend)
  scheduleTerminalFocus()
  diagnostic('bootstrap', 'completed')
})().catch((error) => {
  diagnostic('bootstrap', 'fatal startup error', error, 'error')
  stopLoadingIndicator()
  terminal.write(`\r\nFailed to start sidecar: ${String(error)}\r\n`)
})
