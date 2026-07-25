import { type Child, Command } from '@tauri-apps/plugin-shell'
import {
  TERMINAL_GRID,
  type SidecarAuthenticate,
  type SidecarShutdown,
} from '../../shared/terminal-config'
import {
  decodeTerminalFrame,
  type SidecarFrameAcknowledgement,
  type TerminalFrame,
} from '../../shared/terminal-protocol'
import {
  parseSidecarAuthenticated,
  parseSidecarHello,
  parseSidecarTextMessage,
  sidecarIdentityMatches,
  SidecarIdentityError,
  sidecarSocketUrl,
  type FrontendRuntime,
} from './sidecar-protocol'

const HANDSHAKE_TIMEOUT_MS = 2_000
const CONNECTION_RETRY_DELAY_MS = 100
const STARTUP_CONNECTION_ATTEMPTS = 300
const RECOVERY_RECONNECT_ATTEMPTS = import.meta.env.DEV ? 100 : 20
const RECOVERY_CYCLE_RETRY_DELAY_MS = 2_000
const SHUTDOWN_TIMEOUT_MS = 750

interface SidecarClientOptions {
  onExitRequested: () => void
  onFrame: (frame: TerminalFrame, acknowledge: () => void) => void
  onRecovered: () => void
  onRecoveryError: (error: unknown) => void
  subscribeInput: (handler: (data: string) => void) => { dispose(): void }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createSidecarClient(runtime: FrontendRuntime, options: SidecarClientOptions) {
  let child: Child | undefined
  let disposed = false
  let inputSubscription: { dispose(): void } | undefined
  let recoveryPromise: Promise<void> | undefined
  let recoveryTimer: number | undefined
  let socket: WebSocket | undefined
  let socketAttempt = 0

  const handleSocketMessage = (event: MessageEvent) => {
    const sourceSocket = event.currentTarget instanceof WebSocket ? event.currentTarget : undefined

    if (typeof event.data === 'string') {
      const message = parseSidecarTextMessage(event.data)
      if (message?.type === 'exit-requested') options.onExitRequested()
      return
    }

    if (!(event.data instanceof ArrayBuffer)) {
      sourceSocket?.close(1002, 'Unexpected terminal frame payload')
      return
    }

    const frame = decodeTerminalFrame(event.data)
    if (!frame) {
      sourceSocket?.close(1002, 'Invalid terminal frame')
      return
    }

    options.onFrame(frame, () => {
      if (sourceSocket?.readyState !== WebSocket.OPEN) return
      const acknowledgement: SidecarFrameAcknowledgement = {
        type: 'frame-ack',
        frameId: frame.frameId,
      }
      sourceSocket.send(JSON.stringify(acknowledgement))
    })
  }

  const openSocket = (url: string, attempt: number) =>
    new Promise<WebSocket>((resolve, reject) => {
      let settled = false
      let accepted = false
      let identityAccepted = false
      let handshakeTimer: number | undefined
      const nextSocket = new WebSocket(url)
      nextSocket.binaryType = 'arraybuffer'

      const rejectConnection = (error: Error, closeSocket: boolean) => {
        if (settled) return
        settled = true
        if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer)
        nextSocket.removeEventListener('message', handleHandshake)

        if (closeSocket && nextSocket.readyState < WebSocket.CLOSING) {
          try {
            nextSocket.close(1008, 'Sidecar authentication failed')
          } catch {
            // The connection is already unusable.
          }
        }

        reject(error)
      }

      const handleHandshake = (event: MessageEvent) => {
        if (identityAccepted) {
          if (!parseSidecarAuthenticated(event.data)) {
            rejectConnection(
              new SidecarIdentityError('Sidecar client authentication was not acknowledged'),
              true,
            )
            return
          }

          accepted = true
          settled = true
          if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer)
          nextSocket.removeEventListener('message', handleHandshake)
          nextSocket.addEventListener('message', handleSocketMessage)
          resolve(nextSocket)
          return
        }

        const hello = parseSidecarHello(event.data)
        if (!hello) {
          rejectConnection(new SidecarIdentityError('Sidecar identity handshake was missing'), true)
          return
        }

        if (!sidecarIdentityMatches(hello, runtime)) {
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
        nextSocket.send(JSON.stringify(authentication))
      }

      nextSocket.addEventListener('message', handleHandshake)
      nextSocket.onerror = () => {
        if (!accepted) rejectConnection(new Error(`WebSocket attempt ${attempt} failed`), true)
      }
      nextSocket.onclose = () => {
        if (!accepted) {
          rejectConnection(
            new Error(`WebSocket attempt ${attempt} closed before authentication completed`),
            false,
          )
        }
      }

      handshakeTimer = window.setTimeout(() => {
        rejectConnection(
          new SidecarIdentityError('Sidecar authentication handshake timed out'),
          true,
        )
      }, HANDSHAKE_TIMEOUT_MS)
    })

  const connectWithRetry = async (maxAttempts: number, purpose: string) => {
    const url = sidecarSocketUrl(runtime)

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      socketAttempt += 1
      try {
        return await openSocket(url, socketAttempt)
      } catch (error) {
        if (error instanceof SidecarIdentityError) throw error
        if (attempt < maxAttempts) await delay(CONNECTION_RETRY_DELAY_MS)
      }
    }

    throw new Error(`OpenTUI sidecar connection failed during ${purpose}`)
  }

  const spawnSidecar = async () => {
    const command = Command.sidecar('binaries/opentui-sidecar', [], {
      env: {
        TUI_SIDECAR_INSTANCE_ID: runtime.instanceId,
        TUI_SIDECAR_PORT: String(runtime.sidecarPort),
        TUI_SIDECAR_TOKEN: runtime.sidecarToken,
      },
    })
    child = await command.spawn()
  }

  const stopSidecar = async () => {
    const processToStop = child
    child = undefined

    const socketToShutdown = socket
    socket = undefined
    if (socketToShutdown?.readyState === WebSocket.OPEN) {
      const shutdown: SidecarShutdown = { type: 'shutdown' }
      const socketClosed = new Promise<boolean>((resolve) => {
        let settled = false
        let timeout: number | undefined
        const finish = (closed: boolean) => {
          if (settled) return
          settled = true
          if (timeout !== undefined) window.clearTimeout(timeout)
          socketToShutdown.removeEventListener('close', handleClose)
          resolve(closed)
        }
        const handleClose = () => finish(true)

        socketToShutdown.addEventListener('close', handleClose, { once: true })
        timeout = window.setTimeout(() => finish(false), SHUTDOWN_TIMEOUT_MS)
      })

      try {
        socketToShutdown.send(JSON.stringify(shutdown))
        await socketClosed
      } catch {
        // Fall through to force-closing the socket and process.
      }
    }
    socketToShutdown?.close()

    if (!processToStop) return

    try {
      await processToStop.kill()
    } catch {
      // The process may have already exited.
    }
  }

  const sendResize = () => {
    if (socket?.readyState !== WebSocket.OPEN) return

    socket.send(
      JSON.stringify({
        type: 'resize',
        cols: TERMINAL_GRID.cols,
        rows: TERMINAL_GRID.rows,
      }),
    )
  }

  const sendInput = (data: string) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', data }))
      return true
    }

    return false
  }

  const activateSocket = (nextSocket: WebSocket, reason: string) => {
    if (disposed) {
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
        requestRecovery()
      },
      { once: true },
    )
    if (previousSocket && previousSocket !== nextSocket) previousSocket.close()
    return true
  }

  const recover = async () => {
    if (disposed) return

    try {
      const reconnectedSocket = await connectWithRetry(
        RECOVERY_RECONNECT_ATTEMPTS,
        'recovery reconnect',
      )
      if (!activateSocket(reconnectedSocket, 'recovery reconnect')) return
      sendResize()
      options.onRecovered()
      return
    } catch (error) {
      if (error instanceof SidecarIdentityError) throw error
      if (disposed) return
    }

    await stopSidecar()
    await spawnSidecar()
    const restartedSocket = await connectWithRetry(STARTUP_CONNECTION_ATTEMPTS, 'sidecar restart')
    if (!activateSocket(restartedSocket, 'sidecar restart')) return
    sendResize()
    options.onRecovered()
  }

  const requestRecovery = () => {
    if (disposed || recoveryPromise || recoveryTimer !== undefined) return

    recoveryPromise = recover()
      .catch((error: unknown) => {
        if (!disposed) options.onRecoveryError(error)
      })
      .finally(() => {
        recoveryPromise = undefined

        if (!disposed && !socket) {
          recoveryTimer = window.setTimeout(() => {
            recoveryTimer = undefined
            requestRecovery()
          }, RECOVERY_CYCLE_RETRY_DELAY_MS)
        }
      })
  }

  return {
    async start() {
      if (disposed) return

      const url = sidecarSocketUrl(runtime)
      socketAttempt = 0

      let connectedSocket: WebSocket
      try {
        connectedSocket = await openSocket(url, socketAttempt)
      } catch (error) {
        if (error instanceof SidecarIdentityError) throw error
        if (disposed) return
        await spawnSidecar()
        connectedSocket = await connectWithRetry(STARTUP_CONNECTION_ATTEMPTS, 'initial startup')
      }

      if (!activateSocket(connectedSocket, 'initial startup')) return
      inputSubscription = options.subscribeInput(sendInput)
      sendResize()
    },

    sendInput,

    async stop() {
      if (disposed) return
      disposed = true
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer)
      inputSubscription?.dispose()
      await stopSidecar()
    },
  }
}
