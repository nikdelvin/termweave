import { type Child, Command } from '@tauri-apps/plugin-shell'
import {
  SHOW_DIAGNOSTICS,
  SIDECAR_PROTOCOL,
  TERMINAL_GRID,
  type SidecarAuthenticate,
  type SidecarShutdown,
} from '../../shared/terminal-config'
import {
  decodeTerminalFrame,
  type SidecarFrameAcknowledgement,
  type TerminalFrame,
} from '../../shared/terminal-protocol'
import { diagnostic } from '../diagnostics'
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
      if (message?.type === 'diagnostic') {
        diagnostic('sidecar.ws', message.line)
      } else if (message?.type === 'exit-requested') {
        options.onExitRequested()
      } else {
        diagnostic('websocket', 'unexpected text message ignored', { data: event.data }, 'warn')
      }
      return
    }

    if (!(event.data instanceof ArrayBuffer)) {
      diagnostic(
        'websocket',
        'unexpected terminal frame payload ignored',
        { dataType: event.data?.constructor?.name ?? typeof event.data },
        'error',
      )
      sourceSocket?.close(1002, 'Unexpected terminal frame payload')
      return
    }

    const frame = decodeTerminalFrame(event.data)
    if (!frame) {
      diagnostic(
        'websocket',
        'invalid terminal frame ignored',
        { bytes: event.data.byteLength },
        'error',
      )
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
      const attemptStartedAt = performance.now()
      let settled = false
      let accepted = false
      let identityAccepted = false
      let handshakeTimer: number | undefined
      diagnostic('websocket', 'connection attempt started', { attempt, url })

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
          } catch (closeError) {
            diagnostic('websocket', 'failed to close rejected connection', closeError, 'warn')
          }
        }

        reject(error)
      }

      const handleHandshake = (event: MessageEvent) => {
        if (identityAccepted) {
          if (!parseSidecarAuthenticated(event.data)) {
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
          nextSocket.removeEventListener('message', handleHandshake)
          nextSocket.addEventListener('message', handleSocketMessage)
          diagnostic('websocket', 'mutual sidecar authentication completed', {
            attempt,
            elapsedMs: performance.now() - attemptStartedAt,
          })
          resolve(nextSocket)
          return
        }

        const hello = parseSidecarHello(event.data)
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

        if (!sidecarIdentityMatches(hello, runtime)) {
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
        nextSocket.send(JSON.stringify(authentication))
        diagnostic('websocket', 'sidecar identity accepted; client authentication sent', {
          attempt,
          protocol: hello.protocol,
          version: hello.version,
          port: hello.port,
          elapsedMs: performance.now() - attemptStartedAt,
        })
      }

      nextSocket.addEventListener('message', handleHandshake)
      nextSocket.onopen = () => {
        diagnostic('websocket', 'transport opened; awaiting identity', {
          attempt,
          elapsedMs: performance.now() - attemptStartedAt,
          protocol: nextSocket.protocol,
          extensions: nextSocket.extensions,
        })
      }
      nextSocket.onerror = () => {
        diagnostic(
          'websocket',
          'connection error',
          {
            attempt,
            elapsedMs: performance.now() - attemptStartedAt,
            readyState: nextSocket.readyState,
          },
          'error',
        )
        if (!accepted) rejectConnection(new Error(`WebSocket attempt ${attempt} failed`), true)
      }
      nextSocket.onclose = (event) => {
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

  const spawnSidecar = async (reason: string) => {
    diagnostic('sidecar', 'configuring command', {
      reason,
      port: runtime.sidecarPort,
    })

    const command = Command.sidecar('binaries/opentui-sidecar', [], {
      env: {
        TUI_SIDECAR_INSTANCE_ID: runtime.instanceId,
        TUI_SIDECAR_PORT: String(runtime.sidecarPort),
        TUI_SIDECAR_TOKEN: runtime.sidecarToken,
        TUI_SIDECAR_DIAGNOSTICS: SHOW_DIAGNOSTICS ? '1' : '0',
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

  const stopSidecar = async (reason: string) => {
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
        diagnostic('sidecar', 'graceful shutdown requested', { reason })
        const closedGracefully = await socketClosed
        diagnostic('sidecar', 'graceful shutdown wait completed', { reason, closedGracefully })
      } catch (error) {
        diagnostic('sidecar', 'failed to request graceful shutdown', { reason, error }, 'warn')
      }
    }
    socketToShutdown?.close()

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

  const sendResize = (reason: string) => {
    if (socket?.readyState !== WebSocket.OPEN) return

    socket.send(
      JSON.stringify({
        type: 'resize',
        cols: TERMINAL_GRID.cols,
        rows: TERMINAL_GRID.rows,
      }),
    )
    diagnostic('websocket', 'terminal resize sent', {
      cols: TERMINAL_GRID.cols,
      rows: TERMINAL_GRID.rows,
      reason,
    })
  }

  const sendInput = (data: string) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', data }))
      diagnostic('input', 'sent to sidecar', {
        length: data.length,
        escaped: JSON.stringify(data.slice(0, 120)),
      })
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

  const activateSocket = (nextSocket: WebSocket, reason: string) => {
    if (disposed) {
      diagnostic(
        'frontend',
        'disposed before socket activation; closing socket',
        { reason },
        'warn',
      )
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
        requestRecovery()
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

  const recover = async () => {
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
        RECOVERY_RECONNECT_ATTEMPTS,
        'recovery reconnect',
      )
      if (!activateSocket(reconnectedSocket, 'recovery reconnect')) return
      sendResize('recovery reconnect')
      options.onRecovered()
      diagnostic('recovery', 'reconnected to the existing sidecar process')
      return
    } catch (error) {
      if (error instanceof SidecarIdentityError) throw error
      if (disposed) return
      diagnostic('recovery', 'existing sidecar did not recover; restarting it', error, 'warn')
    }

    await stopSidecar('recovery reconnect grace period expired')
    await spawnSidecar('automatic crash recovery')
    const restartedSocket = await connectWithRetry(STARTUP_CONNECTION_ATTEMPTS, 'sidecar restart')
    if (!activateSocket(restartedSocket, 'sidecar restart')) return
    sendResize('sidecar restart')
    options.onRecovered()
    diagnostic('recovery', 'sidecar restarted and reconnected')
  }

  const requestRecovery = () => {
    if (disposed || recoveryPromise || recoveryTimer !== undefined) return

    recoveryPromise = recover()
      .catch((error: unknown) => {
        diagnostic('recovery', 'automatic sidecar recovery failed', error, 'error')
        if (!disposed) options.onRecoveryError(error)
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
            requestRecovery()
          }, RECOVERY_CYCLE_RETRY_DELAY_MS)
        }
      })
  }

  return {
    async start() {
      if (disposed) return

      const url = sidecarSocketUrl(runtime)
      diagnostic('sidecar', 'probing for this app instance sidecar', {
        port: runtime.sidecarPort,
        protocol: SIDECAR_PROTOCOL,
      })
      socketAttempt = 0

      let connectedSocket: WebSocket
      try {
        connectedSocket = await openSocket(url, socketAttempt)
        diagnostic('sidecar', 'reusing verified existing process')
      } catch (error) {
        if (error instanceof SidecarIdentityError) throw error
        if (disposed) return
        diagnostic('sidecar', 'no verified existing process found', error, 'warn')
        await spawnSidecar('initial startup')
        connectedSocket = await connectWithRetry(STARTUP_CONNECTION_ATTEMPTS, 'initial startup')
      }

      if (!activateSocket(connectedSocket, 'initial startup')) return
      inputSubscription = options.subscribeInput(sendInput)
      diagnostic('xterm', 'input subscription installed')
      sendResize('initial startup')
    },

    sendInput,

    async stop(reason: string) {
      if (disposed) return
      disposed = true
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer)
      inputSubscription?.dispose()
      await stopSidecar(reason)
    },
  }
}
