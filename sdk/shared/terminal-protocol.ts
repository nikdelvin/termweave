export const TERMINAL_FRAME_HEADER_BYTES = Uint32Array.BYTES_PER_ELEMENT
export const MAX_TERMINAL_FRAME_ID = 0xffffffff

export type SidecarFrameAcknowledgement = {
  type: 'frame-ack'
  frameId: number
}

export type TerminalFrame = {
  frameId: number
  data: Uint8Array
}

export function isTerminalFrameId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_TERMINAL_FRAME_ID
  )
}

export function encodeTerminalFrame(
  frameId: number,
  chunks: readonly Uint8Array[],
  contentBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
) {
  if (!isTerminalFrameId(frameId)) throw new RangeError(`Invalid terminal frame ID: ${frameId}`)

  const message = new Uint8Array(TERMINAL_FRAME_HEADER_BYTES + contentBytes)
  const view = new DataView(message.buffer, message.byteOffset, TERMINAL_FRAME_HEADER_BYTES)
  view.setUint32(0, frameId)

  let offset = TERMINAL_FRAME_HEADER_BYTES
  for (const chunk of chunks) {
    message.set(chunk, offset)
    offset += chunk.byteLength
  }

  if (offset !== message.byteLength) {
    throw new RangeError(`Terminal frame content length mismatch: expected ${contentBytes}`)
  }

  return message
}

export function decodeTerminalFrame(message: ArrayBuffer | Uint8Array): TerminalFrame | undefined {
  const bytes = message instanceof Uint8Array ? message : new Uint8Array(message)
  if (bytes.byteLength <= TERMINAL_FRAME_HEADER_BYTES) return undefined

  const view = new DataView(bytes.buffer, bytes.byteOffset, TERMINAL_FRAME_HEADER_BYTES)
  const frameId = view.getUint32(0)
  if (!isTerminalFrameId(frameId)) return undefined

  return {
    frameId,
    data: bytes.subarray(TERMINAL_FRAME_HEADER_BYTES),
  }
}
