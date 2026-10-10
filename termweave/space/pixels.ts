import { DataTexture, RGBAFormat, ClampToEdgeWrapping, NearestFilter, UnsignedByteType } from 'three'
import type { Rgba } from './color'

export interface FrameBuffer {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

export function createFrameBuffer(width: number, height: number): FrameBuffer {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

export function fillFrameBuffer(buffer: FrameBuffer, color: Rgba) {
  const [r, g, b, a] = [
    Math.round(color[0] * 255),
    Math.round(color[1] * 255),
    Math.round(color[2] * 255),
    Math.round(color[3] * 255),
  ]
  for (let offset = 0; offset < buffer.data.length; offset += 4) {
    buffer.data[offset] = r!
    buffer.data[offset + 1] = g!
    buffer.data[offset + 2] = b!
    buffer.data[offset + 3] = a!
  }
}

export function blendPixel(buffer: FrameBuffer, x: number, y: number, color: Rgba) {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return
  const offset = (y * buffer.width + x) * 4
  const srcA = Math.min(1, Math.max(0, color[3]))
  if (srcA >= 1) {
    buffer.data[offset] = Math.round(color[0] * 255)
    buffer.data[offset + 1] = Math.round(color[1] * 255)
    buffer.data[offset + 2] = Math.round(color[2] * 255)
    buffer.data[offset + 3] = 255
    return
  }
  if (srcA <= 0) return
  const dstA = buffer.data[offset + 3]! / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return
  for (let channel = 0; channel < 3; channel += 1) {
    const src = color[channel] * 255
    const dst = buffer.data[offset + channel]!
    const mixed = (src * srcA + dst * dstA * (1 - srcA)) / outA
    buffer.data[offset + channel] = Math.round(mixed)
  }
  buffer.data[offset + 3] = Math.round(outA * 255)
}

export function toDataTexture(buffer: FrameBuffer): DataTexture {
  const flipped = new Uint8Array(buffer.data.length)
  const rowBytes = buffer.width * 4
  for (let row = 0; row < buffer.height; row += 1) {
    flipped.set(
      buffer.data.subarray(row * rowBytes, (row + 1) * rowBytes),
      (buffer.height - 1 - row) * rowBytes,
    )
  }
  const texture = new DataTexture(flipped, buffer.width, buffer.height, RGBAFormat, UnsignedByteType)
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

export function updateDataTexture(texture: DataTexture, buffer: FrameBuffer) {
  const rowBytes = buffer.width * 4
  const data = texture.image.data as Uint8Array
  for (let row = 0; row < buffer.height; row += 1) {
    data.set(
      buffer.data.subarray(row * rowBytes, (row + 1) * rowBytes),
      (buffer.height - 1 - row) * rowBytes,
    )
  }
  texture.needsUpdate = true
}
