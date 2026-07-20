import { timingSafeEqual } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { createCliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import {
  FOREGROUND_COLOR,
  SIDECAR_PROTOCOL,
  TERMINAL_GRID,
  THEME_COLOR,
  type SidecarAuthenticate,
  type SidecarAuthenticated,
  type SidecarExitRequested,
  type SidecarHello,
} from '../../shared/terminal-config'
import {
  MAX_TERMINAL_FRAME_ID,
  encodeTerminalFrame,
  isTerminalFrameId,
  type SidecarFrameAcknowledgement,
} from '../../shared/terminal-protocol'
import { App } from './App'

const startedAt = performance.now()
const HOST = '127.0.0.1'
const CLIENT_AUTHENTICATION_TIMEOUT_MS = 5_000
const FRAME_ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000
const MAX_PENDING_OUTPUT_BYTES = 4 * 1024 * 1024
const INSTANCE_ID = process.env.TUI_SIDECAR_INSTANCE_ID?.trim()
const configuredClientToken = process.env.TUI_SIDECAR_TOKEN?.trim()
const configuredPort = Number(process.env.TUI_SIDECAR_PORT)
const DIAGNOSTICS_ENABLED = process.env.TUI_SIDECAR_DIAGNOSTICS === '1'

if (!INSTANCE_ID) {
  throw new Error('TUI_SIDECAR_INSTANCE_ID is required')
}

if (!configuredClientToken) {
  throw new Error('TUI_SIDECAR_TOKEN is required')
}

if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error('TUI_SIDECAR_PORT must be a valid TCP port')
}

const PORT = configuredPort
const CLIENT_TOKEN = configuredClientToken
const { cols: COLS, rows: ROWS } = TERMINAL_GRID

type ClientMessage =
  | SidecarAuthenticate
  | SidecarFrameAcknowledgement
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

type Session = {
  authenticationTimer?: ReturnType<typeof setTimeout>
  authenticated: boolean
  id: number
}

let sendSidecarDiagnostic: ((line: string) => boolean) | undefined

function isMouseMotionInput(data: string) {
  const match = /^\u001b\[<(\d+);\d+;\d+[Mm]$/.exec(data)
  return match ? (Number(match[1]) & 32) !== 0 : false
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return String(error)
}

function sidecarLog(message: string, details?: unknown) {
  if (!DIAGNOSTICS_ENABLED) return

  const elapsed = (performance.now() - startedAt).toFixed(1).padStart(8)
  let suffix = ''

  if (details !== undefined) {
    try {
      suffix = ` ${JSON.stringify(details)}`
    } catch {
      suffix = ` ${String(details)}`
    }
  }

  const line = `[${elapsed}ms] [sidecar] ${message}${suffix}`
  if (sendSidecarDiagnostic?.(line)) return
  process.stderr.write(`${line}\n`)
}

function parseClientMessage(rawMessage: string): ClientMessage | undefined {
  try {
    const message = JSON.parse(rawMessage) as Record<string, unknown>

    if (message.type === 'authenticate' && typeof message.token === 'string') {
      return { type: 'authenticate', token: message.token }
    }

    if (message.type === 'input' && typeof message.data === 'string') {
      return { type: 'input', data: message.data }
    }

    if (message.type === 'frame-ack' && isTerminalFrameId(message.frameId)) {
      return { type: 'frame-ack', frameId: message.frameId }
    }

    if (
      message.type === 'resize' &&
      typeof message.cols === 'number' &&
      Number.isFinite(message.cols) &&
      typeof message.rows === 'number' &&
      Number.isFinite(message.rows)
    ) {
      return { type: 'resize', cols: message.cols, rows: message.rows }
    }
  } catch {
    // Invalid messages are ignored below.
  }

  return undefined
}

function tokenMatches(candidate: string) {
  const expected = Buffer.from(CLIENT_TOKEN)
  const received = Buffer.from(candidate)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

sidecarLog('process started', {
  pid: process.pid,
  platform: process.platform,
  arch: process.arch,
  execPath: process.execPath,
  cwd: process.cwd(),
  argv: process.argv,
  grid: `${COLS}x${ROWS}`,
  instanceId: INSTANCE_ID,
  port: PORT,
})

process.on('exit', (code) => {
  sidecarLog('process exiting', { code })
})

process.on('warning', (warning) => {
  sidecarLog('process warning', serializeError(warning))
})

function terminalInput() {
  const stream = new PassThrough()
  Object.assign(stream, {
    isTTY: true,
    isRaw: true,
    setRawMode: () => stream,
  })
  return stream
}

function terminalOutput() {
  const stream = new PassThrough()
  Object.assign(stream, {
    isTTY: true,
    columns: COLS,
    rows: ROWS,
  })
  return stream
}

const input = terminalInput()
const output = terminalOutput()

type QueuedOutputFrame = {
  contentBytes: number
  frameId: number
  message: Uint8Array
}

type InFlightOutputFrame = QueuedOutputFrame & {
  connectionId: number
}

const outputChunks: Uint8Array[] = []
const queuedOutputFrames: QueuedOutputFrame[] = []
let outputChunkBytes = 0
let queuedOutputBytes = 0
let outputFlushTimer: ReturnType<typeof setTimeout> | undefined
let outputFrameBoundariesReady = false
let outputRequiresFullRepaint = false
let nextOutputFrameId = 0
let inFlightOutputFrame: InFlightOutputFrame | undefined
let frameAcknowledgementTimer: ReturnType<typeof setTimeout> | undefined
let terminalReadyPromise: Promise<void> | undefined
let resolveTerminalReady: (() => void) | undefined
let activeSocket: Bun.ServerWebSocket<Session> | undefined
let nextConnectionId = 0
let outputChunkCount = 0
let outputByteCount = 0
let hasConnected = false
let exitRequested = false
let exitRequestConnectionId: number | undefined

if (DIAGNOSTICS_ENABLED) {
  sendSidecarDiagnostic = (line) => {
    if (!activeSocket) return false

    try {
      activeSocket.send(JSON.stringify({ type: 'diagnostic', line }))
      return true
    } catch {
      return false
    }
  }
}

function blockTerminalRendering() {
  if (terminalReadyPromise) return

  terminalReadyPromise = new Promise<void>((resolve) => {
    resolveTerminalReady = resolve
  })
}

function releaseTerminalRendering() {
  const resolve = resolveTerminalReady
  terminalReadyPromise = undefined
  resolveTerminalReady = undefined
  resolve?.()
}

function waitForTerminalReady() {
  return terminalReadyPromise ?? Promise.resolve()
}

function clearFrameAcknowledgementTimer() {
  if (!frameAcknowledgementTimer) return
  clearTimeout(frameAcknowledgementTimer)
  frameAcknowledgementTimer = undefined
}

function clearOutputFlushTimer() {
  if (!outputFlushTimer) return
  clearTimeout(outputFlushTimer)
  outputFlushTimer = undefined
}

function clearBufferedOutput() {
  clearOutputFlushTimer()
  clearFrameAcknowledgementTimer()
  outputChunks.splice(0)
  queuedOutputFrames.splice(0)
  outputChunkBytes = 0
  queuedOutputBytes = 0
  inFlightOutputFrame = undefined
}

function abandonOutputUntilFullRepaint() {
  clearBufferedOutput()
  outputRequiresFullRepaint = true
  blockTerminalRendering()
}

function resetOutputForFullRepaint() {
  clearBufferedOutput()
  outputRequiresFullRepaint = false
  releaseTerminalRendering()
}

function allocateOutputFrameId() {
  nextOutputFrameId = nextOutputFrameId >= MAX_TERMINAL_FRAME_ID ? 1 : nextOutputFrameId + 1
  return nextOutputFrameId
}

function sendNextOutputFrame() {
  const socket = activeSocket
  const frame = queuedOutputFrames[0]
  if (!socket || inFlightOutputFrame || !frame) return

  queuedOutputFrames.shift()
  queuedOutputBytes -= frame.contentBytes

  try {
    const sendStatus = socket.send(frame.message)
    if (sendStatus === 0) {
      sidecarLog('terminal frame dropped by WebSocket transport', {
        connectionId: socket.data.id,
        frameId: frame.frameId,
        bytes: frame.contentBytes,
      })
      abandonOutputUntilFullRepaint()
      socket.close(1011, 'Terminal frame delivery failed')
      return
    }

    inFlightOutputFrame = {
      ...frame,
      connectionId: socket.data.id,
    }
    frameAcknowledgementTimer = setTimeout(() => {
      if (
        activeSocket !== socket ||
        inFlightOutputFrame?.connectionId !== socket.data.id ||
        inFlightOutputFrame.frameId !== frame.frameId
      ) {
        return
      }

      sidecarLog('terminal frame acknowledgement timed out', {
        connectionId: socket.data.id,
        frameId: frame.frameId,
        timeoutMs: FRAME_ACKNOWLEDGEMENT_TIMEOUT_MS,
      })
      abandonOutputUntilFullRepaint()
      socket.close(1011, 'Terminal frame acknowledgement timed out')
    }, FRAME_ACKNOWLEDGEMENT_TIMEOUT_MS)

    sidecarLog('terminal frame sent', {
      connectionId: socket.data.id,
      frameId: frame.frameId,
      bytes: frame.contentBytes,
      messageBytes: frame.message.byteLength,
      sendStatus,
    })
  } catch (error) {
    sidecarLog('terminal frame send failed', serializeError(error))
    abandonOutputUntilFullRepaint()
    socket.close(1011, 'Terminal frame send failed')
  }
}

function queueOutputFrame(frame: QueuedOutputFrame) {
  blockTerminalRendering()
  queuedOutputFrames.push(frame)
  queuedOutputBytes += frame.contentBytes

  if (!activeSocket && queuedOutputBytes > MAX_PENDING_OUTPUT_BYTES) {
    sidecarLog('pending terminal output exceeded buffer limit', {
      pendingFrames: queuedOutputFrames.length,
      pendingBytes: queuedOutputBytes,
      limitBytes: MAX_PENDING_OUTPUT_BYTES,
    })
    abandonOutputUntilFullRepaint()
    return
  }

  sendNextOutputFrame()
}

function flushOutputFrame(reason: string, openTuiFrameId?: number) {
  clearOutputFlushTimer()
  if (outputChunkBytes === 0) return

  const chunks = outputChunks.splice(0)
  const contentBytes = outputChunkBytes
  outputChunkBytes = 0

  if (outputRequiresFullRepaint && !activeSocket) {
    sidecarLog('terminal output discarded while awaiting full repaint', {
      reason,
      bytes: contentBytes,
    })
    return
  }

  const frameId = allocateOutputFrameId()
  const message = encodeTerminalFrame(frameId, chunks, contentBytes)
  sidecarLog('terminal output coalesced', {
    reason,
    openTuiFrameId,
    frameId,
    chunks: chunks.length,
    bytes: contentBytes,
  })
  queueOutputFrame({ contentBytes, frameId, message })
}

function scheduleOutputFrameFlush() {
  if (!outputFrameBoundariesReady) return
  if (outputFlushTimer) clearTimeout(outputFlushTimer)
  outputFlushTimer = setTimeout(() => flushOutputFrame('non-render output'), 0)
}

function acknowledgeOutputFrame(socket: Bun.ServerWebSocket<Session>, frameId: number) {
  const frame = inFlightOutputFrame
  if (!frame || frame.connectionId !== socket.data.id || frame.frameId !== frameId) {
    sidecarLog('stale terminal frame acknowledgement ignored', {
      connectionId: socket.data.id,
      frameId,
      expectedConnectionId: frame?.connectionId,
      expectedFrameId: frame?.frameId,
    })
    return
  }

  clearFrameAcknowledgementTimer()
  inFlightOutputFrame = undefined
  sidecarLog('terminal frame acknowledged', {
    connectionId: socket.data.id,
    frameId,
    bytes: frame.contentBytes,
  })

  sendNextOutputFrame()
  if (!inFlightOutputFrame && queuedOutputFrames.length === 0 && !outputRequiresFullRepaint) {
    releaseTerminalRendering()
  }
}

function sendExitRequest(socket = activeSocket) {
  if (
    !exitRequested ||
    !socket ||
    !socket.data.authenticated ||
    exitRequestConnectionId === socket.data.id
  ) {
    return
  }

  const message: SidecarExitRequested = { type: 'exit-requested' }

  try {
    const sendStatus = socket.send(JSON.stringify(message))
    if (sendStatus !== 0) exitRequestConnectionId = socket.data.id
    sidecarLog('host exit requested', {
      connectionId: socket.data.id,
      sendStatus,
    })
  } catch (error) {
    sidecarLog('host exit request failed', serializeError(error))
  }
}

sidecarLog('terminal streams created', {
  inputIsTTY: (input as PassThrough & { isTTY?: boolean }).isTTY,
  outputIsTTY: (output as PassThrough & { isTTY?: boolean }).isTTY,
  columns: (output as PassThrough & { columns?: number }).columns,
  rows: (output as PassThrough & { rows?: number }).rows,
})

output.on('data', (chunk: Buffer) => {
  const data = Uint8Array.from(chunk)
  outputChunks.push(data)
  outputChunkBytes += data.byteLength

  if (DIAGNOSTICS_ENABLED) {
    outputChunkCount += 1
    outputByteCount += data.byteLength
    sidecarLog('terminal output produced', {
      chunk: outputChunkCount,
      bytes: data.byteLength,
      totalBytes: outputByteCount,
      destination: 'OpenTUI frame buffer',
      pendingChunks: outputChunks.length,
      pendingBytes: outputChunkBytes,
      preview: chunk.toString('utf8').slice(0, 240),
    })
  }

  scheduleOutputFrameFlush()
})

sidecarLog('creating OpenTUI renderer')
const rendererStartedAt = performance.now()
const renderer = await createCliRenderer({
  stdin: input as unknown as NodeJS.ReadStream,
  stdout: output as unknown as NodeJS.WriteStream,
  width: COLS,
  height: ROWS,
  backgroundColor: THEME_COLOR,
  screenMode: 'alternate-screen',
  consoleMode: 'disabled',
  exitOnCtrlC: false,
  exitSignals: [],
  useKittyKeyboard: null,
  onDestroy: () => {
    exitRequested = true
    sendExitRequest()
  },
}).catch((error: unknown) => {
  sidecarLog('OpenTUI renderer creation failed', serializeError(error))
  throw error
})

sidecarLog('OpenTUI renderer created', {
  elapsedMs: performance.now() - rendererStartedAt,
  width: renderer.width,
  height: renderer.height,
  screenMode: renderer.screenMode,
})

outputFrameBoundariesReady = true
renderer.setFrameCallback(waitForTerminalReady)
renderer.on('frame', ({ frameId }: { frameId: number }) => {
  flushOutputFrame('OpenTUI refresh', frameId)
})

sidecarLog('mounting Solid application')
process.env.TERMWEAVE_THEME_COLOR = THEME_COLOR
process.env.TERMWEAVE_FOREGROUND_COLOR = FOREGROUND_COLOR
process.env.TERMWEAVE_TERMINAL_COLS = String(TERMINAL_GRID.cols)
process.env.TERMWEAVE_TERMINAL_ROWS = String(TERMINAL_GRID.rows)
render(() => <App />, renderer)
sidecarLog('Solid application mounted; waiting for renderer idle')
void renderer.idle().then(() => {
  sidecarLog('renderer idle after initial frame', {
    pendingChunks: outputChunks.length,
    pendingBytes: outputChunkBytes + queuedOutputBytes,
    pendingFrames: queuedOutputFrames.length,
    inFlightFrameId: inFlightOutputFrame?.frameId,
  })
})

function activateAuthenticatedSocket(socket: Bun.ServerWebSocket<Session>) {
  if (socket.data.authenticationTimer) clearTimeout(socket.data.authenticationTimer)
  socket.data.authenticationTimer = undefined

  const isReconnect = hasConnected
  const replacingConnectionId = activeSocket?.data.id
  const pendingBytes =
    outputChunkBytes + queuedOutputBytes + (inFlightOutputFrame?.contentBytes ?? 0)
  const needsFullRepaint = isReconnect || outputRequiresFullRepaint
  const authenticated: SidecarAuthenticated = { type: 'authenticated' }
  const authenticationStatus = socket.send(JSON.stringify(authenticated))

  if (authenticationStatus === 0) {
    process.stderr.write('[sidecar] client authentication response failed\n')
    socket.close(1011, 'Authentication response failed')
    return
  }

  const previousSocket = activeSocket
  if (needsFullRepaint) resetOutputForFullRepaint()
  activeSocket = socket
  previousSocket?.close(1000, 'Replaced by authenticated client')
  sendExitRequest(socket)

  sidecarLog('WebSocket client authenticated', {
    connectionId: socket.data.id,
    replacingConnectionId,
    isReconnect,
    pendingFrames: queuedOutputFrames.length,
    pendingBytes,
    authenticationStatus,
  })

  if (needsFullRepaint) {
    sidecarLog('reconnecting terminal; forcing full OpenTUI repaint', {
      connectionId: socket.data.id,
      isReconnect,
    })
    renderer.suspend()
    renderer.resume()
  } else {
    sendNextOutputFrame()
  }

  hasConnected = true
}

sidecarLog('starting WebSocket server', { host: HOST, port: PORT })
const server = Bun.serve<Session>({
  hostname: HOST,
  port: PORT,

  fetch(request, server) {
    const url = new URL(request.url)
    sidecarLog('HTTP request received', {
      method: request.method,
      path: url.pathname,
      upgrade: request.headers.get('upgrade'),
    })

    if (url.pathname !== '/terminal') {
      sidecarLog('HTTP request rejected', { status: 404, path: url.pathname })
      return new Response('Not found', { status: 404 })
    }

    const connectionId = ++nextConnectionId
    const upgraded = server.upgrade(request, {
      data: { authenticated: false, id: connectionId },
    })
    sidecarLog('WebSocket upgrade attempted', { connectionId, upgraded })

    return upgraded ? undefined : new Response('Upgrade failed', { status: 500 })
  },

  websocket: {
    open(socket) {
      const hello: SidecarHello = {
        type: 'hello',
        protocol: SIDECAR_PROTOCOL.name,
        version: SIDECAR_PROTOCOL.version,
        instanceId: INSTANCE_ID,
        port: PORT,
      }
      const helloStatus = socket.send(JSON.stringify(hello))

      if (helloStatus === 0) {
        process.stderr.write('[sidecar] identity handshake send failed\n')
        socket.close(1011, 'Identity handshake failed')
        return
      }

      sidecarLog('WebSocket opened; awaiting client authentication', {
        connectionId: socket.data.id,
        helloStatus,
      })
      socket.data.authenticationTimer = setTimeout(() => {
        sidecarLog('WebSocket client authentication timed out', {
          connectionId: socket.data.id,
        })
        socket.close(1008, 'Authentication timed out')
      }, CLIENT_AUTHENTICATION_TIMEOUT_MS)
    },

    message(socket, rawMessage) {
      if (typeof rawMessage !== 'string') {
        sidecarLog('WebSocket message received', {
          connectionId: socket.data.id,
          kind: typeof rawMessage,
          bytes: rawMessage.byteLength,
        })
        sidecarLog('non-text WebSocket message ignored', {
          connectionId: socket.data.id,
        })
        return
      }

      const message = parseClientMessage(rawMessage)
      if (!message) {
        sidecarLog('invalid WebSocket message ignored', { connectionId: socket.data.id })
        if (!socket.data.authenticated) socket.close(1008, 'Authentication required')
        return
      }

      if (!socket.data.authenticated) {
        if (message.type !== 'authenticate' || !tokenMatches(message.token)) {
          sidecarLog('WebSocket client authentication rejected', {
            connectionId: socket.data.id,
          })
          socket.close(1008, 'Authentication failed')
          return
        }

        socket.data.authenticated = true
        activateAuthenticatedSocket(socket)
        return
      }

      if (socket !== activeSocket || message.type === 'authenticate') return

      if (message.type === 'frame-ack') {
        acknowledgeOutputFrame(socket, message.frameId)
        return
      }

      const isMouseMotion =
        DIAGNOSTICS_ENABLED && message.type === 'input' && isMouseMotionInput(message.data)

      if (DIAGNOSTICS_ENABLED && !isMouseMotion) {
        sidecarLog('WebSocket message received', {
          connectionId: socket.data.id,
          kind: typeof rawMessage,
          bytes: rawMessage.length,
          preview: rawMessage.slice(0, 240),
        })
      }

      if (message.type === 'input') {
        if (DIAGNOSTICS_ENABLED && !isMouseMotion) {
          sidecarLog('terminal input forwarded', {
            connectionId: socket.data.id,
            length: message.data.length,
            escaped: JSON.stringify(message.data.slice(0, 120)),
          })
        }
        input.write(message.data)
      }

      if (message.type === 'resize') {
        const cols = Math.max(40, Math.floor(message.cols))
        const rows = Math.max(20, Math.floor(message.rows))
        sidecarLog('renderer resize requested', {
          connectionId: socket.data.id,
          requested: `${message.cols}x${message.rows}`,
          applied: `${cols}x${rows}`,
        })
        Object.assign(output, { columns: cols, rows })
        renderer.resize(cols, rows)
      }
    },

    close(socket, code, reason) {
      if (socket.data.authenticationTimer) clearTimeout(socket.data.authenticationTimer)
      sidecarLog('WebSocket closed', {
        connectionId: socket.data.id,
        code,
        reason,
        wasActive: activeSocket === socket,
      })
      if (activeSocket === socket) {
        activeSocket = undefined
        abandonOutputUntilFullRepaint()
      }
    },

    drain(socket) {
      sidecarLog('WebSocket backpressure drained', {
        connectionId: socket.data.id,
      })
    },
  },
})

sidecarLog('WebSocket server listening', {
  hostname: server.hostname,
  port: server.port,
  url: server.url.toString(),
})
