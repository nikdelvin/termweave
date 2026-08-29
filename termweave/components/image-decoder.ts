import { createJimp } from '@jimp/core'
import jpeg from '@jimp/js-jpeg'
import png from '@jimp/js-png'
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeGifDelay } from './image-playback'
import {
  detectImageFormat,
  readLocalImageBytes,
  resolveLocalImagePath,
  throwIfImageAborted,
} from './image-source'
import {
  compositeFrameOverBackground,
  fitImageDimensions,
  resizeRgbaFrame,
  rgbaByteLength,
  validateRgbaFrame,
  type AnimationFrame,
  type Dimensions,
  type Rgb,
  type RgbaFrame,
} from './pixel-frame'

const BYTES_PER_PIXEL = 4
const MAX_FRAME_CACHE_BYTES = 64 * 1024 * 1024
const StillImage = createJimp({ formats: [jpeg, png] })

interface FrameCacheEntry {
  byteLength: number
  frames: readonly AnimationFrame[]
}

const frameCache = new Map<string, FrameCacheEntry>()
let frameCacheByteLength = 0

function frameCacheKey(uri: string, maximum: Dimensions, background: Rgb) {
  const path = resolve(resolveLocalImagePath(uri))
  const stats = statSync(path, { bigint: true })
  if (!stats.isFile()) throw new Error('The image source is not a file.')
  const version = [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':')
  return `${path}\0${version}\0${maximum.width}x${maximum.height}\0${background.join(',')}`
}

function cachedFrames(key: string) {
  const entry = frameCache.get(key)
  if (!entry) return undefined
  frameCache.delete(key)
  frameCache.set(key, entry)
  return entry.frames
}

function rememberFrames(key: string, frames: readonly AnimationFrame[]) {
  let byteLength = 0
  for (const frame of frames) {
    byteLength += frame.data.byteLength
    if (!Number.isSafeInteger(byteLength) || byteLength > MAX_FRAME_CACHE_BYTES) return
  }

  const existing = frameCache.get(key)
  if (existing) {
    frameCacheByteLength -= existing.byteLength
    frameCache.delete(key)
  }
  while (frameCacheByteLength + byteLength > MAX_FRAME_CACHE_BYTES) {
    const oldestKey = frameCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = frameCache.get(oldestKey)!
    frameCache.delete(oldestKey)
    frameCacheByteLength -= oldest.byteLength
  }
  frameCache.set(key, { byteLength, frames })
  frameCacheByteLength += byteLength
}

export function getCachedLocalImageFrames(uri: string, maximum: Dimensions, background: Rgb) {
  try {
    return cachedFrames(frameCacheKey(uri, maximum, background))
  } catch {
    return undefined
  }
}

export interface GifPatchFrame {
  dims: {
    left: number
    top: number
    width: number
    height: number
  }
  patch: Uint8Array | Uint8ClampedArray
  delay?: unknown
  disposalType?: number
}

function requireInteger(value: number, name: string, minimum: number) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`)
  }
  return value
}

function validateGifPatch(frame: GifPatchFrame, canvas: Dimensions) {
  const { left, top, width, height } = frame.dims
  requireInteger(left, 'GIF frame left offset', 0)
  requireInteger(top, 'GIF frame top offset', 0)
  requireInteger(width, 'GIF frame width', 1)
  requireInteger(height, 'GIF frame height', 1)
  if (frame.patch.byteLength !== rgbaByteLength({ width, height })) {
    throw new Error('The GIF decoder returned an invalid frame patch.')
  }
  if (left + width > canvas.width || top + height > canvas.height) {
    throw new Error('The GIF decoder returned a frame patch outside the logical canvas.')
  }
}

function clearGifArea(canvas: Uint8Array, canvasSize: Dimensions, frame: GifPatchFrame) {
  const left = Math.min(canvasSize.width, frame.dims.left)
  const top = Math.min(canvasSize.height, frame.dims.top)
  const right = Math.min(canvasSize.width, frame.dims.left + frame.dims.width)
  const bottom = Math.min(canvasSize.height, frame.dims.top + frame.dims.height)
  for (let y = top; y < bottom; y += 1) {
    canvas.fill(0, (y * canvasSize.width + left) * 4, (y * canvasSize.width + right) * 4)
  }
}

function drawGifPatch(canvas: Uint8Array, canvasSize: Dimensions, frame: GifPatchFrame) {
  const { dims, patch } = frame
  for (let y = 0; y < dims.height; y += 1) {
    const destinationY = dims.top + y
    if (destinationY >= canvasSize.height) continue

    for (let x = 0; x < dims.width; x += 1) {
      const destinationX = dims.left + x
      if (destinationX >= canvasSize.width) continue

      const sourceOffset = (y * dims.width + x) * BYTES_PER_PIXEL
      const sourceAlpha = patch[sourceOffset + 3]! / 255
      if (sourceAlpha === 0) continue
      const destinationOffset = (destinationY * canvasSize.width + destinationX) * BYTES_PER_PIXEL
      if (sourceAlpha === 1) {
        canvas.set(patch.subarray(sourceOffset, sourceOffset + 4), destinationOffset)
        continue
      }

      const destinationAlpha = canvas[destinationOffset + 3]! / 255
      const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
      for (let channel = 0; channel < 3; channel += 1) {
        const sourceChannel = patch[sourceOffset + channel]!
        const destinationChannel = canvas[destinationOffset + channel]!
        canvas[destinationOffset + channel] = Math.round(
          (sourceChannel * sourceAlpha +
            destinationChannel * destinationAlpha * (1 - sourceAlpha)) /
            outputAlpha,
        )
      }
      canvas[destinationOffset + 3] = Math.round(outputAlpha * 255)
    }
  }
}

export function compositeGifFrames(
  frames: readonly GifPatchFrame[],
  source: Dimensions,
  target: Dimensions,
  background: Rgb,
  signal?: AbortSignal,
) {
  const canvas = new Uint8Array(rgbaByteLength(source))
  const output: AnimationFrame[] = []
  let currentCanvas = canvas

  for (const frame of frames) {
    throwIfImageAborted(signal)
    validateGifPatch(frame, source)
    const restore = frame.disposalType === 3 ? currentCanvas.slice() : undefined
    drawGifPatch(currentCanvas, source, frame)
    const resized = resizeRgbaFrame({ ...source, data: currentCanvas }, target, signal)
    output.push({
      ...compositeFrameOverBackground(resized, background),
      delayMs: normalizeGifDelay(frame.delay),
    })

    if (frame.disposalType === 2) {
      clearGifArea(currentCanvas, source, frame)
    } else if (restore) {
      currentCanvas = restore
    }
  }

  if (output.length === 0) throw new Error('The GIF does not contain any image frames.')
  return output
}

function copiedArrayBuffer(bytes: Uint8Array) {
  return Uint8Array.from(bytes).buffer
}

async function decodeStillImage(
  bytes: Uint8Array,
  maximum: Dimensions,
  background: Rgb,
  signal?: AbortSignal,
) {
  throwIfImageAborted(signal)
  const image = await StillImage.fromBuffer(copiedArrayBuffer(bytes))
  throwIfImageAborted(signal)
  const source: RgbaFrame = {
    width: image.bitmap.width,
    height: image.bitmap.height,
    data: Uint8Array.from(image.bitmap.data),
  }
  validateRgbaFrame(source)
  const target = fitImageDimensions(source, maximum)
  return [
    {
      ...compositeFrameOverBackground(resizeRgbaFrame(source, target, signal), background),
      delayMs: 0,
    },
  ] satisfies AnimationFrame[]
}

function decodeGifImage(
  bytes: Uint8Array,
  maximum: Dimensions,
  background: Rgb,
  signal?: AbortSignal,
) {
  throwIfImageAborted(signal)
  const gif = parseGIF(copiedArrayBuffer(bytes))
  const source = { width: gif.lsd.width, height: gif.lsd.height }
  rgbaByteLength(source)
  const target = fitImageDimensions(source, maximum)
  const frames = decompressFrames(gif, true) as ParsedFrame[]
  throwIfImageAborted(signal)
  return compositeGifFrames(frames, source, target, background, signal)
}

export async function loadLocalImageFrames(
  uri: string,
  maximum: Dimensions,
  background: Rgb,
  signal?: AbortSignal,
) {
  throwIfImageAborted(signal)
  let key: string | undefined
  try {
    key = frameCacheKey(uri, maximum, background)
  } catch {
    // Preserve the existing async read/decode error path for invalid or missing sources.
  }
  if (key) {
    const frames = cachedFrames(key)
    if (frames) return frames
  }

  const bytes = await readLocalImageBytes(uri, signal)
  const format = detectImageFormat(bytes)
  throwIfImageAborted(signal)
  const frames =
    format === 'gif'
      ? decodeGifImage(bytes, maximum, background, signal)
      : await decodeStillImage(bytes, maximum, background, signal)
  throwIfImageAborted(signal)

  if (key) {
    try {
      if (frameCacheKey(uri, maximum, background) === key) rememberFrames(key, frames)
    } catch {
      // A changed or removed source remains renderable for this request but is not cached.
    }
  }
  return frames
}
