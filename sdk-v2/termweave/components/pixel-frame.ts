import { applyCrtPalette, type Rgb } from '../host/crt-effects/crt-palette'
import { throwIfImageAborted } from './image-source'

const SOURCE_PIXELS_PER_CELL = 2
const BYTES_PER_PIXEL = 4
const MAX_TYPED_ARRAY_LENGTH = 0xffff_ffff

export interface Dimensions {
  width: number
  height: number
}

export interface RgbaFrame extends Dimensions {
  data: Uint8Array
}

export interface AnimationFrame extends RgbaFrame {
  delayMs: number
}

export interface CenteredViewport extends Dimensions {
  x: number
  y: number
}

function requireInteger(value: number, name: string, minimum: number) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`)
  }
  return value
}

export function rgbaByteLength(dimensions: Dimensions) {
  const width = requireInteger(dimensions.width, 'Image width', 1)
  const height = requireInteger(dimensions.height, 'Image height', 1)
  const pixels = width * height
  const length = pixels * BYTES_PER_PIXEL
  if (!Number.isSafeInteger(pixels) || length > MAX_TYPED_ARRAY_LENGTH) {
    throw new Error('Image dimensions are too large to decode safely.')
  }
  return length
}

export function validateRgbaFrame(frame: RgbaFrame) {
  const expectedLength = rgbaByteLength(frame)
  if (frame.data.byteLength !== expectedLength) {
    throw new Error('The image decoder returned invalid RGBA pixel data.')
  }
}

export function fitImageDimensions(source: Dimensions, maximum: Dimensions): Dimensions {
  requireInteger(source.width, 'Source width', 1)
  requireInteger(source.height, 'Source height', 1)
  requireInteger(maximum.width, 'Maximum width', SOURCE_PIXELS_PER_CELL)
  requireInteger(maximum.height, 'Maximum height', SOURCE_PIXELS_PER_CELL)
  if (
    maximum.width % SOURCE_PIXELS_PER_CELL !== 0 ||
    maximum.height % SOURCE_PIXELS_PER_CELL !== 0
  ) {
    throw new Error('Maximum image dimensions must be even.')
  }

  const scale = Math.min(maximum.width / source.width, maximum.height / source.height)
  const evenFloor = (value: number, limit: number) =>
    Math.min(
      limit,
      Math.max(SOURCE_PIXELS_PER_CELL, Math.floor(value / SOURCE_PIXELS_PER_CELL) * 2),
    )

  return {
    width: evenFloor(source.width * scale, maximum.width),
    height: evenFloor(source.height * scale, maximum.height),
  }
}

export function calculateCenteredViewport(containerCells: Dimensions, imagePixels: Dimensions) {
  requireInteger(containerCells.width, 'Container width', 0)
  requireInteger(containerCells.height, 'Container height', 0)
  if (imagePixels.width % 2 !== 0 || imagePixels.height % 2 !== 0) {
    throw new Error('Rendered image dimensions must be even.')
  }
  const width = imagePixels.width / SOURCE_PIXELS_PER_CELL
  const height = imagePixels.height / SOURCE_PIXELS_PER_CELL
  if (width > containerCells.width || height > containerCells.height) {
    throw new Error('The fitted image exceeds its component bounds.')
  }
  return {
    width,
    height,
    x: Math.floor((containerCells.width - width) / 2),
    y: Math.floor((containerCells.height - height) / 2),
  } satisfies CenteredViewport
}

export function resizeRgbaFrame(
  source: RgbaFrame,
  target: Dimensions,
  signal?: AbortSignal,
): RgbaFrame {
  validateRgbaFrame(source)
  const targetLength = rgbaByteLength(target)
  throwIfImageAborted(signal)
  if (source.width === target.width && source.height === target.height) {
    return { ...target, data: source.data.slice() }
  }

  const data = new Uint8Array(targetLength)
  const scaleX = source.width / target.width
  const scaleY = source.height / target.height

  for (let y = 0; y < target.height; y += 1) {
    throwIfImageAborted(signal)
    const sourceY = Math.max(0, Math.min(source.height - 1, (y + 0.5) * scaleY - 0.5))
    const top = Math.floor(sourceY)
    const bottom = Math.min(source.height - 1, top + 1)
    const verticalWeight = sourceY - top

    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.max(0, Math.min(source.width - 1, (x + 0.5) * scaleX - 0.5))
      const left = Math.floor(sourceX)
      const right = Math.min(source.width - 1, left + 1)
      const horizontalWeight = sourceX - left
      const weights = [
        (1 - horizontalWeight) * (1 - verticalWeight),
        horizontalWeight * (1 - verticalWeight),
        (1 - horizontalWeight) * verticalWeight,
        horizontalWeight * verticalWeight,
      ]
      const offsets = [
        (top * source.width + left) * BYTES_PER_PIXEL,
        (top * source.width + right) * BYTES_PER_PIXEL,
        (bottom * source.width + left) * BYTES_PER_PIXEL,
        (bottom * source.width + right) * BYTES_PER_PIXEL,
      ]
      let alpha = 0
      let premultipliedRed = 0
      let premultipliedGreen = 0
      let premultipliedBlue = 0

      for (let sample = 0; sample < offsets.length; sample += 1) {
        const offset = offsets[sample]!
        const weight = weights[sample]!
        const sampleAlpha = source.data[offset + 3]! / 255
        alpha += sampleAlpha * weight
        premultipliedRed += source.data[offset]! * sampleAlpha * weight
        premultipliedGreen += source.data[offset + 1]! * sampleAlpha * weight
        premultipliedBlue += source.data[offset + 2]! * sampleAlpha * weight
      }

      const destinationOffset = (y * target.width + x) * BYTES_PER_PIXEL
      if (alpha > 0) {
        data[destinationOffset] = Math.round(premultipliedRed / alpha)
        data[destinationOffset + 1] = Math.round(premultipliedGreen / alpha)
        data[destinationOffset + 2] = Math.round(premultipliedBlue / alpha)
        data[destinationOffset + 3] = Math.round(alpha * 255)
      }
    }
  }

  return { ...target, data }
}

export function compositeFrameOverBackground(frame: RgbaFrame, background: Rgb): RgbaFrame {
  validateRgbaFrame(frame)
  const data = frame.data.slice()
  for (let offset = 0; offset < data.length; offset += BYTES_PER_PIXEL) {
    const alpha = data[offset + 3]! / 255
    data[offset] = Math.round(data[offset]! * alpha + background[0] * (1 - alpha))
    data[offset + 1] = Math.round(data[offset + 1]! * alpha + background[1] * (1 - alpha))
    data[offset + 2] = Math.round(data[offset + 2]! * alpha + background[2] * (1 - alpha))
    data[offset + 3] = 255
  }
  applyCrtPalette(data, background)
  return { ...frame, data }
}

export function parseHexColor(color: string): Rgb {
  const match = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(color)
  if (!match) throw new Error('PixelRenderer background must be a six-digit hexadecimal color.')
  return [
    Number.parseInt(match[1]!, 16),
    Number.parseInt(match[2]!, 16),
    Number.parseInt(match[3]!, 16),
  ]
}

export type { Rgb } from '../host/crt-effects/crt-palette'
