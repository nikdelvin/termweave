import type { CliRenderer } from '@opentui/core'
import {
  SIDECAR_PROTOCOL,
  type SidecarAuthenticated,
  type SidecarExitRequested,
  type SidecarHello,
} from '../../../shared/terminal-config'
import { parseClientMessage, tokenMatches, type Session } from './protocol'
import type { TerminalOutput } from './terminal-output'

const HOST = '127.0.0.1'
const AUTHENTICATION_TIMEOUT_MS = 5_000

interface TerminalServerOptions {
  clientToken: string
  instanceId: string
  onShutdownRequested: () => void
  port: number
  renderer: CliRenderer
  terminal: TerminalOutput
}

export function createTerminalServer(options: TerminalServerOptions) {
  const { clientToken, instanceId, onShutdownRequested, port, renderer, terminal } = options
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
    } catch {
      // The frontend connection is already unavailable.
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

    if (connection.needsFullRepaint) {
      renderer.suspend()
      renderer.resume()
    } else {
      terminal.sendNextFrame()
    }
  }

  const server = Bun.serve<Session>({
    hostname: HOST,
    port,

    fetch(request, bunServer) {
      const url = new URL(request.url)

      if (url.pathname !== '/terminal') return new Response('Not found', { status: 404 })

      const connectionId = ++nextConnectionId
      const upgraded = bunServer.upgrade(request, {
        data: { authenticated: false, id: connectionId },
      })
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

        socket.data.authenticationTimer = setTimeout(() => {
          socket.close(1008, 'Authentication timed out')
        }, AUTHENTICATION_TIMEOUT_MS)
      },

      message(socket, rawMessage) {
        if (typeof rawMessage !== 'string') return

        const message = parseClientMessage(rawMessage)
        if (!message) {
          if (!socket.data.authenticated) socket.close(1008, 'Authentication required')
          return
        }

        if (!socket.data.authenticated) {
          if (message.type !== 'authenticate' || !tokenMatches(clientToken, message.token)) {
            socket.close(1008, 'Authentication failed')
            return
          }

          socket.data.authenticated = true
          activateAuthenticatedSocket(socket)
          return
        }

        if (!terminal.isActiveSocket(socket) || message.type === 'authenticate') return
        if (message.type === 'shutdown') {
          onShutdownRequested()
          return
        }
        if (message.type === 'frame-ack') {
          terminal.acknowledgeFrame(socket, message.frameId)
          return
        }

        if (message.type === 'input') {
          terminal.input.write(message.data)
        }

        if (message.type === 'resize') {
          const cols = Math.max(40, Math.floor(message.cols))
          const rows = Math.max(20, Math.floor(message.rows))
          Object.assign(terminal.output, { columns: cols, rows })
          renderer.resize(cols, rows)
        }
      },

      close(socket) {
        if (socket.data.authenticationTimer) clearTimeout(socket.data.authenticationTimer)
        terminal.deactivateSocket(socket)
      },
    },
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
      } catch {
        // Continue shutting down the server.
      }

      try {
        server.stop(true)
      } catch {
        // The server may already be stopped.
      }
    },
  }
}
