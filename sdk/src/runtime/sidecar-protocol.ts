import {
  SIDECAR_PROTOCOL,
  type SidecarAuthenticated,
  type SidecarExitRequested,
} from '../../shared/terminal-config'

export interface FrontendRuntime {
  instanceId: string
  sidecarToken: string
  sidecarPort: number
}

export interface ReceivedSidecarHello {
  type: 'hello'
  protocol: string
  version: number
  instanceId: string
  port: number
}

export type SidecarTextMessage = SidecarExitRequested

export class SidecarIdentityError extends Error {
  override name = 'SidecarIdentityError'
}

export function sidecarSocketUrl(runtime: FrontendRuntime) {
  return `ws://127.0.0.1:${runtime.sidecarPort}/terminal`
}

export function parseSidecarHello(data: unknown): ReceivedSidecarHello | undefined {
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

export function sidecarIdentityMatches(hello: ReceivedSidecarHello, runtime: FrontendRuntime) {
  return (
    hello.protocol === SIDECAR_PROTOCOL.name &&
    hello.version === SIDECAR_PROTOCOL.version &&
    hello.instanceId === runtime.instanceId &&
    hello.port === runtime.sidecarPort
  )
}

export function parseSidecarAuthenticated(data: unknown): SidecarAuthenticated | undefined {
  if (typeof data !== 'string') return undefined

  try {
    const message = JSON.parse(data) as Record<string, unknown>
    if (message.type === 'authenticated') return { type: 'authenticated' }
  } catch {
    // Authentication acknowledgements must be valid JSON.
  }

  return undefined
}

export function parseSidecarTextMessage(data: string): SidecarTextMessage | undefined {
  try {
    const message = JSON.parse(data) as Record<string, unknown>
    if (message.type === 'exit-requested') return { type: 'exit-requested' }
  } catch {
    // Non-JSON text remains valid terminal output.
  }

  return undefined
}
