import { applyCrtPalette, type Rgb } from '../color'

// Frame contains byte-level operations shared by finite and streaming publication.
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
  release?: () => void
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

export function compositeRgbaInto(source: Uint8Array, destination: Uint8Array, background: Rgb) {
  if (source.byteLength !== destination.byteLength || source.byteLength % BYTES_PER_PIXEL !== 0) {
    throw new Error('RGBA composition requires equally sized complete pixel buffers.')
  }
  for (let offset = 0; offset < source.length; offset += BYTES_PER_PIXEL) {
    const alpha = source[offset + 3]! / 255
    destination[offset] = Math.round(source[offset]! * alpha + background[0] * (1 - alpha))
    destination[offset + 1] = Math.round(source[offset + 1]! * alpha + background[1] * (1 - alpha))
    destination[offset + 2] = Math.round(source[offset + 2]! * alpha + background[2] * (1 - alpha))
    destination[offset + 3] = 255
  }
  applyCrtPalette(destination)
}

export type { Rgb } from '../color'
