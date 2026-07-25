import { expect, test } from 'bun:test'
import { decodeTerminalFrame } from '../../../shared/terminal-protocol'
import type { Session } from '../../src/runtime/protocol'
import { createTerminalOutput } from '../../src/runtime/terminal-output'

interface FakeSocket {
  closeCalls: Array<[code: number, reason: string]>
  data: Session
  sendCalls: Array<string | Uint8Array>
}

function fakeSocket(id: number) {
  const socket: FakeSocket = {
    closeCalls: [],
    data: { authenticated: true, id },
    sendCalls: [],
  }

  return Object.assign(socket, {
    close(code: number, reason: string) {
      socket.closeCalls.push([code, reason])
    },
    send(message: string | Uint8Array) {
      socket.sendCalls.push(message)
      return 1
    },
  }) as FakeSocket & Bun.ServerWebSocket<Session>
}

test('queues terminal output until it is acknowledged', async () => {
  const terminal = createTerminalOutput({
    cols: 80,
    diagnosticsEnabled: false,
    log: () => {},
    rows: 24,
  })
  const socket = fakeSocket(1)

  terminal.output.write('hello')
  terminal.enableFrameBoundaries()
  terminal.flushFrame('test')
  const renderingReady = terminal.waitForReady()
  terminal.activateSocket(socket)
  terminal.sendNextFrame()

  expect(socket.sendCalls).toHaveLength(1)
  const message = socket.sendCalls[0]
  expect(message).toBeInstanceOf(Uint8Array)
  const frame = decodeTerminalFrame(message as Uint8Array)
  expect(new TextDecoder().decode(frame?.data)).toBe('hello')

  terminal.acknowledgeFrame(socket, frame!.frameId)
  await renderingReady
  terminal.shutdown()
})

test('requires a full repaint when replacing an authenticated connection', () => {
  const terminal = createTerminalOutput({
    cols: 80,
    diagnosticsEnabled: false,
    log: () => {},
    rows: 24,
  })
  const firstSocket = fakeSocket(1)
  const secondSocket = fakeSocket(2)

  expect(terminal.activateSocket(firstSocket).needsFullRepaint).toBeFalse()
  expect(terminal.activateSocket(secondSocket).needsFullRepaint).toBeTrue()
  expect(firstSocket.closeCalls).toEqual([[1000, 'Replaced by authenticated client']])
  terminal.shutdown()
})
