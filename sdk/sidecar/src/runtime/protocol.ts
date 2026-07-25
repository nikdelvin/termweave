import { timingSafeEqual } from 'node:crypto'
import { type SidecarAuthenticate, type SidecarShutdown } from '../../../shared/terminal-config'
import {
  isTerminalFrameId,
  type SidecarFrameAcknowledgement,
} from '../../../shared/terminal-protocol'

export type ClientMessage =
  | SidecarAuthenticate
  | SidecarFrameAcknowledgement
  | SidecarShutdown
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

export interface Session {
  authenticationTimer?: ReturnType<typeof setTimeout>
  authenticated: boolean
  id: number
}

export function parseClientMessage(rawMessage: string): ClientMessage | undefined {
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
    if (message.type === 'shutdown') return { type: 'shutdown' }
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
    // Invalid client messages are ignored.
  }

  return undefined
}

export function tokenMatches(expected: string, candidate: string) {
  const expectedBytes = Buffer.from(expected)
  const candidateBytes = Buffer.from(candidate)
  return (
    expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes)
  )
}
