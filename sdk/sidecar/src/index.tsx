import { timingSafeEqual } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { createCliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import {
  SIDECAR_PROTOCOL,
  TERMINAL_GRID,
  THEME_COLOR,
  type SidecarAuthenticate,
  type SidecarAuthenticated,
  type SidecarHello,
} from '../../shared/terminal-config'
import { App } from './App'

const startedAt = performance.now()
const HOST = '127.0.0.1'
const CLIENT_AUTHENTICATION_TIMEOUT_MS = 5_000
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
const pendingOutput: Uint8Array[] = []
let pendingOutputBytes = 0
let pendingOutputTruncated = false
let activeSocket: Bun.ServerWebSocket<Session> | undefined
let nextConnectionId = 0
let outputChunkCount = 0
let outputByteCount = 0
let hasConnected = false

sendSidecarDiagnostic = (line) => {
  if (!activeSocket) return false

  try {
    activeSocket.send(JSON.stringify({ type: 'diagnostic', line }))
    return true
  } catch {
    return false
  }
}

function bufferPendingOutput(data: Uint8Array) {
  pendingOutput.push(data)
  pendingOutputBytes += data.byteLength

  while (pendingOutputBytes > MAX_PENDING_OUTPUT_BYTES && pendingOutput.length > 0) {
    const discarded = pendingOutput.shift()
    if (discarded) pendingOutputBytes -= discarded.byteLength
    pendingOutputTruncated = true
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
  outputChunkCount += 1
  outputByteCount += data.byteLength

  sidecarLog('terminal output produced', {
    chunk: outputChunkCount,
    bytes: data.byteLength,
    totalBytes: outputByteCount,
    destination: activeSocket ? `socket ${activeSocket.data.id}` : 'pending buffer',
    pendingChunks: pendingOutput.length,
    preview: chunk.toString('utf8').slice(0, 240),
  })

  if (!activeSocket) {
    bufferPendingOutput(data)
    sidecarLog('terminal output buffered', {
      pendingChunks: pendingOutput.length,
      pendingBytes: pendingOutputBytes,
      truncated: pendingOutputTruncated,
    })
    return
  }

  try {
    const connectionId = activeSocket.data.id
    const sendStatus = activeSocket.send(data)
    sidecarLog('terminal output sent', {
      connectionId,
      bytes: data.byteLength,
      sendStatus,
    })
  } catch (error) {
    sidecarLog('terminal output send failed', serializeError(error))
    activeSocket = undefined
    bufferPendingOutput(data)
  }
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

sidecarLog('mounting Solid application')
render(() => <App />, renderer)
sidecarLog('Solid application mounted; waiting for renderer idle')
await renderer.idle()
sidecarLog('renderer idle after initial frame', {
  pendingChunks: pendingOutput.length,
  pendingBytes: pendingOutputBytes,
})

function activateAuthenticatedSocket(socket: Bun.ServerWebSocket<Session>) {
  if (socket.data.authenticationTimer) clearTimeout(socket.data.authenticationTimer)
  socket.data.authenticationTimer = undefined

  const isReconnect = hasConnected
  const replacingConnectionId = activeSocket?.data.id
  const pendingBytes = pendingOutputBytes
  const bufferedOutputTruncated = pendingOutputTruncated
  const needsFullRepaint = isReconnect || bufferedOutputTruncated
  const authenticated: SidecarAuthenticated = { type: 'authenticated' }
  const authenticationStatus = socket.send(JSON.stringify(authenticated))

  if (authenticationStatus < 0) {
    process.stderr.write('[sidecar] client authentication response failed\n')
    socket.close(1011, 'Authentication response failed')
    return
  }

  activeSocket?.close(1000, 'Replaced by authenticated client')
  activeSocket = socket

  sidecarLog('WebSocket client authenticated', {
    connectionId: socket.data.id,
    replacingConnectionId,
    isReconnect,
    pendingChunks: pendingOutput.length,
    pendingBytes,
    authenticationStatus,
  })

  const bufferedOutput = pendingOutput.splice(0)
  pendingOutputBytes = 0
  pendingOutputTruncated = false

  for (const chunk of bufferedOutput) {
    const sendStatus = socket.send(chunk)
    sidecarLog('buffered terminal output flushed', {
      connectionId: socket.data.id,
      bytes: chunk.byteLength,
      sendStatus,
    })
  }

  if (needsFullRepaint) {
    sidecarLog('reconnecting terminal; forcing full OpenTUI repaint', {
      connectionId: socket.data.id,
      bufferedOutputTruncated,
    })
    renderer.suspend()
    renderer.resume()
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

      if (helloStatus < 0) {
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

      const isMouseMotion = message.type === 'input' && isMouseMotionInput(message.data)

      if (!isMouseMotion) {
        sidecarLog('WebSocket message received', {
          connectionId: socket.data.id,
          kind: typeof rawMessage,
          bytes: rawMessage.length,
          preview: rawMessage.slice(0, 240),
        })
      }

      if (message.type === 'input') {
        if (!isMouseMotion) {
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
      if (activeSocket === socket) activeSocket = undefined
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
