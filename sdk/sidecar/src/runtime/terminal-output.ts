import { PassThrough } from 'node:stream'
import { MAX_TERMINAL_FRAME_ID, encodeTerminalFrame } from '../../../shared/terminal-protocol'
import type { Session } from './protocol'

const FRAME_ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000
const MAX_PENDING_OUTPUT_BYTES = 4 * 1024 * 1024

interface QueuedOutputFrame {
  contentBytes: number
  frameId: number
  message: Uint8Array
}

interface InFlightOutputFrame extends QueuedOutputFrame {
  connectionId: number
}

interface TerminalOutputOptions {
  cols: number
  rows: number
}

function terminalInput() {
  const stream = new PassThrough()
  Object.assign(stream, {
    isTTY: true,
    isRaw: true,
    setRawMode: () => stream,
  })
  return stream
}

function terminalOutput(cols: number, rows: number) {
  const stream = new PassThrough()
  Object.assign(stream, {
    isTTY: true,
    columns: cols,
    rows,
  })
  return stream
}

export function createTerminalOutput(options: TerminalOutputOptions) {
  const { cols, rows } = options
  const input = terminalInput()
  const output = terminalOutput(cols, rows)
  const outputChunks: Uint8Array[] = []
  const queuedFrames: QueuedOutputFrame[] = []

  let activeSocket: Bun.ServerWebSocket<Session> | undefined
  let acknowledgementTimer: ReturnType<typeof setTimeout> | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let inFlightFrame: InFlightOutputFrame | undefined
  let nextFrameId = 0
  let outputChunkBytes = 0
  let queuedOutputBytes = 0
  let readyPromise: Promise<void> | undefined
  let releaseReady: (() => void) | undefined
  let frameBoundariesReady = false
  let fullRepaintRequired = false
  let hasConnected = false

  const blockRendering = () => {
    if (readyPromise) return
    readyPromise = new Promise<void>((resolve) => {
      releaseReady = resolve
    })
  }

  const releaseRendering = () => {
    const resolve = releaseReady
    readyPromise = undefined
    releaseReady = undefined
    resolve?.()
  }

  const clearAcknowledgementTimer = () => {
    if (!acknowledgementTimer) return
    clearTimeout(acknowledgementTimer)
    acknowledgementTimer = undefined
  }

  const clearFlushTimer = () => {
    if (!flushTimer) return
    clearTimeout(flushTimer)
    flushTimer = undefined
  }

  const clearBufferedOutput = () => {
    clearFlushTimer()
    clearAcknowledgementTimer()
    outputChunks.splice(0)
    queuedFrames.splice(0)
    outputChunkBytes = 0
    queuedOutputBytes = 0
    inFlightFrame = undefined
  }

  const abandonUntilFullRepaint = () => {
    clearBufferedOutput()
    fullRepaintRequired = true
    blockRendering()
  }

  const resetForFullRepaint = () => {
    clearBufferedOutput()
    fullRepaintRequired = false
    releaseRendering()
  }

  const allocateFrameId = () => {
    nextFrameId = nextFrameId >= MAX_TERMINAL_FRAME_ID ? 1 : nextFrameId + 1
    return nextFrameId
  }

  const sendNextFrame = () => {
    const socket = activeSocket
    const frame = queuedFrames[0]
    if (!socket || inFlightFrame || !frame) return

    queuedFrames.shift()
    queuedOutputBytes -= frame.contentBytes

    try {
      const sendStatus = socket.send(frame.message)
      if (sendStatus === 0) {
        abandonUntilFullRepaint()
        socket.close(1011, 'Terminal frame delivery failed')
        return
      }

      inFlightFrame = { ...frame, connectionId: socket.data.id }
      acknowledgementTimer = setTimeout(() => {
        if (
          activeSocket !== socket ||
          inFlightFrame?.connectionId !== socket.data.id ||
          inFlightFrame.frameId !== frame.frameId
        ) {
          return
        }

        abandonUntilFullRepaint()
        socket.close(1011, 'Terminal frame acknowledgement timed out')
      }, FRAME_ACKNOWLEDGEMENT_TIMEOUT_MS)
    } catch {
      abandonUntilFullRepaint()
      socket.close(1011, 'Terminal frame send failed')
    }
  }

  const queueFrame = (frame: QueuedOutputFrame) => {
    blockRendering()
    queuedFrames.push(frame)
    queuedOutputBytes += frame.contentBytes

    if (!activeSocket && queuedOutputBytes > MAX_PENDING_OUTPUT_BYTES) {
      abandonUntilFullRepaint()
      return
    }

    sendNextFrame()
  }

  const flushFrame = () => {
    clearFlushTimer()
    if (outputChunkBytes === 0) return

    const chunks = outputChunks.splice(0)
    const contentBytes = outputChunkBytes
    outputChunkBytes = 0

    if (fullRepaintRequired && !activeSocket) {
      return
    }

    const frameId = allocateFrameId()
    const message = encodeTerminalFrame(frameId, chunks, contentBytes)
    queueFrame({ contentBytes, frameId, message })
  }

  const scheduleFlush = () => {
    if (!frameBoundariesReady) return
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(flushFrame, 0)
  }

  output.on('data', (chunk: Buffer) => {
    const data = Uint8Array.from(chunk)
    outputChunks.push(data)
    outputChunkBytes += data.byteLength

    scheduleFlush()
  })

  return {
    input,
    output,

    acknowledgeFrame(socket: Bun.ServerWebSocket<Session>, frameId: number) {
      const frame = inFlightFrame
      if (!frame || frame.connectionId !== socket.data.id || frame.frameId !== frameId) return

      clearAcknowledgementTimer()
      inFlightFrame = undefined

      sendNextFrame()
      if (!inFlightFrame && queuedFrames.length === 0 && !fullRepaintRequired) {
        releaseRendering()
      }
    },

    activateSocket(socket: Bun.ServerWebSocket<Session>) {
      const previousSocket = activeSocket
      const needsFullRepaint = hasConnected || fullRepaintRequired

      if (needsFullRepaint) resetForFullRepaint()
      activeSocket = socket
      previousSocket?.close(1000, 'Replaced by authenticated client')
      hasConnected = true

      return {
        needsFullRepaint,
      }
    },

    deactivateSocket(socket: Bun.ServerWebSocket<Session>) {
      if (activeSocket !== socket) return false
      activeSocket = undefined
      abandonUntilFullRepaint()
      return true
    },

    enableFrameBoundaries() {
      frameBoundariesReady = true
    },

    flushFrame,

    getActiveSocket() {
      return activeSocket
    },

    isActiveSocket(socket: Bun.ServerWebSocket<Session>) {
      return activeSocket === socket
    },

    sendNextFrame,

    shutdown() {
      clearFlushTimer()
      clearAcknowledgementTimer()
      const socket = activeSocket
      activeSocket = undefined
      return socket
    },

    waitForReady() {
      return readyPromise ?? Promise.resolve()
    },
  }
}

export type TerminalOutput = ReturnType<typeof createTerminalOutput>
