import type { CliRenderer } from '@opentui/core'
import {
  SIDECAR_PROTOCOL,
  type SidecarAuthenticated,
  type SidecarExitRequested,
  type SidecarHello,
} from '../../../shared/terminal-config'
import { serializeError, type SidecarLog } from './diagnostics'
import { parseClientMessage, tokenMatches, type Session } from './protocol'
import type { TerminalOutput } from './terminal-output'

const HOST = '127.0.0.1'
const AUTHENTICATION_TIMEOUT_MS = 5_000

interface TerminalServerOptions {
  clientToken: string
  diagnosticsEnabled: boolean
  instanceId: string
  log: SidecarLog
  onShutdownRequested: (reason: string) => void
  port: number
  renderer: CliRenderer
  terminal: TerminalOutput
}

export function createTerminalServer(options: TerminalServerOptions) {
  const {
    clientToken,
    diagnosticsEnabled,
    instanceId,
    log,
    onShutdownRequested,
    port,
    renderer,
    terminal,
  } = options
  let exitRequested = false
  let exitRequestConnectionId: number | undefined
  let nextConnectionId = 0

  const sendExitRequest = (socket = terminal.getActiveSocket()) => {
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
      log('host exit requested', {
        connectionId: socket.data.id,
        sendStatus,
      })
    } catch (error) {
      log('host exit request failed', serializeError(error))
    }
  }

  const activateAuthenticatedSocket = (socket: Bun.ServerWebSocket<Session>) => {
    if (socket.data.authenticationTimer) clearTimeout(socket.data.authenticationTimer)
    socket.data.authenticationTimer = undefined

    const authenticated: SidecarAuthenticated = { type: 'authenticated' }
    const authenticationStatus = socket.send(JSON.stringify(authenticated))
    if (authenticationStatus === 0) {
      process.stderr.write('[sidecar] client authentication response failed\n')
      socket.close(1011, 'Authentication response failed')
      return
    }

    const connection = terminal.activateSocket(socket)
    sendExitRequest(socket)
    log('WebSocket client authenticated', {
      connectionId: socket.data.id,
      replacingConnectionId: connection.replacingConnectionId,
      isReconnect: connection.isReconnect,
      pendingFrames: terminal.getStats().pendingFrames,
      pendingBytes: connection.pendingBytes,
      authenticationStatus,
    })

    if (connection.needsFullRepaint) {
      log('reconnecting terminal; forcing full OpenTUI repaint', {
        connectionId: socket.data.id,
        isReconnect: connection.isReconnect,
      })
      renderer.suspend()
      renderer.resume()
    } else {
      terminal.sendNextFrame()
    }
  }

  log('starting WebSocket server', { host: HOST, port })
  const server = Bun.serve<Session>({
    hostname: HOST,
    port,

    fetch(request, bunServer) {
      const url = new URL(request.url)
      log('HTTP request received', {
        method: request.method,
        path: url.pathname,
        upgrade: request.headers.get('upgrade'),
      })

      if (url.pathname !== '/terminal') {
        log('HTTP request rejected', { status: 404, path: url.pathname })
        return new Response('Not found', { status: 404 })
      }

      const connectionId = ++nextConnectionId
      const upgraded = bunServer.upgrade(request, {
        data: { authenticated: false, id: connectionId },
      })
      log('WebSocket upgrade attempted', { connectionId, upgraded })
      return upgraded ? undefined : new Response('Upgrade failed', { status: 500 })
    },

    websocket: {
      open(socket) {
        const hello: SidecarHello = {
          type: 'hello',
          protocol: SIDECAR_PROTOCOL.name,
          version: SIDECAR_PROTOCOL.version,
          instanceId,
          port,
        }
        const helloStatus = socket.send(JSON.stringify(hello))
        if (helloStatus === 0) {
          process.stderr.write('[sidecar] identity handshake send failed\n')
          socket.close(1011, 'Identity handshake failed')
          return
        }

        log('WebSocket opened; awaiting client authentication', {
          connectionId: socket.data.id,
          helloStatus,
        })
        socket.data.authenticationTimer = setTimeout(() => {
          log('WebSocket client authentication timed out', {
            connectionId: socket.data.id,
          })
          socket.close(1008, 'Authentication timed out')
        }, AUTHENTICATION_TIMEOUT_MS)
      },

      message(socket, rawMessage) {
        if (typeof rawMessage !== 'string') {
          log('WebSocket message received', {
            connectionId: socket.data.id,
            kind: typeof rawMessage,
            bytes: rawMessage.byteLength,
          })
          log('non-text WebSocket message ignored', {
            connectionId: socket.data.id,
          })
          return
        }

        const message = parseClientMessage(rawMessage)
        if (!message) {
          log('invalid WebSocket message ignored', { connectionId: socket.data.id })
          if (!socket.data.authenticated) socket.close(1008, 'Authentication required')
          return
        }

        if (!socket.data.authenticated) {
          if (message.type !== 'authenticate' || !tokenMatches(clientToken, message.token)) {
            log('WebSocket client authentication rejected', {
              connectionId: socket.data.id,
            })
            socket.close(1008, 'Authentication failed')
            return
          }

          socket.data.authenticated = true
          activateAuthenticatedSocket(socket)
          return
        }

        if (!terminal.isActiveSocket(socket) || message.type === 'authenticate') return
        if (message.type === 'shutdown') {
          log('authenticated client requested shutdown', { connectionId: socket.data.id })
          onShutdownRequested('authenticated client requested shutdown')
          return
        }
        if (message.type === 'frame-ack') {
          terminal.acknowledgeFrame(socket, message.frameId)
          return
        }

        if (diagnosticsEnabled) {
          log('WebSocket message received', {
            connectionId: socket.data.id,
            kind: typeof rawMessage,
            bytes: rawMessage.length,
            preview: rawMessage.slice(0, 240),
          })
        }

        if (message.type === 'input') {
          if (diagnosticsEnabled) {
            log('terminal input forwarded', {
              connectionId: socket.data.id,
              length: message.data.length,
              escaped: JSON.stringify(message.data.slice(0, 120)),
            })
          }
          terminal.input.write(message.data)
        }

        if (message.type === 'resize') {
          const cols = Math.max(40, Math.floor(message.cols))
          const rows = Math.max(20, Math.floor(message.rows))
          log('renderer resize requested', {
            connectionId: socket.data.id,
            requested: `${message.cols}x${message.rows}`,
            applied: `${cols}x${rows}`,
          })
          Object.assign(terminal.output, { columns: cols, rows })
          renderer.resize(cols, rows)
        }
      },

      close(socket, code, reason) {
        if (socket.data.authenticationTimer) clearTimeout(socket.data.authenticationTimer)
        const wasActive = terminal.isActiveSocket(socket)
        log('WebSocket closed', {
          connectionId: socket.data.id,
          code,
          reason,
          wasActive,
        })
        terminal.deactivateSocket(socket)
      },

      drain(socket) {
        log('WebSocket backpressure drained', {
          connectionId: socket.data.id,
        })
      },
    },
  })

  log('WebSocket server listening', {
    hostname: server.hostname,
    port: server.port,
    url: server.url.toString(),
  })

  return {
    requestHostExit() {
      exitRequested = true
      sendExitRequest()
    },

    stop() {
      const socket = terminal.shutdown()
      try {
        socket?.close(1000, 'Sidecar shutting down')
      } catch (error) {
        log('failed to close WebSocket during shutdown', serializeError(error))
      }

      try {
        server.stop(true)
      } catch (error) {
        log('failed to stop WebSocket server during shutdown', serializeError(error))
      }
    },
  }
}
