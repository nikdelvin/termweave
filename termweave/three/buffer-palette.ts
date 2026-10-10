import { quantizeChannel } from '../color'

const CHANNELS_PER_CELL = 4
const CHANNEL_MASK = 0xff
const META_MASK = 0xff00

export interface CellColorBuffer {
  buffers: {
    fg: Uint16Array
    bg: Uint16Array
  }
  width: number
  height: number
}

function quantizeColorArray(colors: Uint16Array, startIndex: number, cellCount: number) {
  for (let index = startIndex; index < startIndex + cellCount * CHANNELS_PER_CELL; index += CHANNELS_PER_CELL) {
    colors[index] = (colors[index]! & META_MASK) | quantizeChannel(colors[index]! & CHANNEL_MASK, 3)
    colors[index + 1] =
      (colors[index + 1]! & META_MASK) | quantizeChannel(colors[index + 1]! & CHANNEL_MASK, 3)
    colors[index + 2] =
      (colors[index + 2]! & META_MASK) | quantizeChannel(colors[index + 2]! & CHANNEL_MASK, 2)
  }
}

export function quantizeBufferRegion(
  buffer: CellColorBuffer,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const startX = Math.max(0, Math.floor(x))
  const startY = Math.max(0, Math.floor(y))
  const endX = Math.min(buffer.width, startX + Math.max(0, Math.floor(width)))
  const endY = Math.min(buffer.height, startY + Math.max(0, Math.floor(height)))
  if (endX <= startX || endY <= startY) return
  for (let row = startY; row < endY; row += 1) {
    const startIndex = (row * buffer.width + startX) * CHANNELS_PER_CELL
    quantizeColorArray(buffer.buffers.fg, startIndex, endX - startX)
    quantizeColorArray(buffer.buffers.bg, startIndex, endX - startX)
  }
}
