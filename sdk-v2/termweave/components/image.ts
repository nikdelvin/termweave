import { createJimp } from '@jimp/core'
import jpeg from '@jimp/js-jpeg'
import png from '@jimp/js-png'
import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js'
import { fileURLToPath } from 'node:url'
import { applyCrtPalette } from './crt-palette'

const SOURCE_PIXELS_PER_CELL = 2
const BYTES_PER_PIXEL = 4
const DEFAULT_GIF_DELAY_MS = 100
const MINIMUM_GIF_DELAY_MS = 10
const MAX_TYPED_ARRAY_LENGTH = 0xffff_ffff
const windowsDrivePattern = /^[A-Za-z]:[\\/]/
const uriSchemePattern = /^([A-Za-z][A-Za-z0-9+.-]*):/
const StillImage = createJimp({ formats: [jpeg, png] })

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

export type ImageFormat = 'gif' | 'jpeg' | 'png'
export type Rgb = readonly [red: number, green: number, blue: number]

export interface CenteredViewport extends Dimensions {
  x: number
  y: number
}

export interface TimerClock<Timer = ReturnType<typeof setTimeout>> {
  now(): number
  setTimer(callback: () => void, delayMs: number): Timer
  clearTimer(timer: Timer): void
}

export interface AnimationPlaybackOptions<Timer = ReturnType<typeof setTimeout>> {
  clock?: TimerClock<Timer>
  onError?: (error: unknown) => void
}

export interface ImageRequest {
  uri: string
  maximum: Dimensions
  background: Rgb
}

export interface ImageControllerOptions {
  onError(error: unknown | undefined): void
  onFrame(frame: AnimationFrame | undefined): void
  load?: typeof loadLocalImage
  play?: typeof startAnimationPlayback
}

function abortError() {
  return new DOMException('The image operation was cancelled.', 'AbortError')
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? abortError()
}

function requireInteger(value: number, name: string, minimum: number) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`)
  }
  return value
}

function rgbaLength(dimensions: Dimensions) {
  const width = requireInteger(dimensions.width, 'Image width', 1)
  const height = requireInteger(dimensions.height, 'Image height', 1)
  const pixels = width * height
  const length = pixels * BYTES_PER_PIXEL
  if (!Number.isSafeInteger(pixels) || length > MAX_TYPED_ARRAY_LENGTH) {
    throw new Error('Image dimensions are too large to decode safely.')
  }
  return length
}

function validateFrame(frame: RgbaFrame) {
  const expectedLength = rgbaLength(frame)
  if (frame.data.byteLength !== expectedLength) {
    throw new Error('The image decoder returned invalid RGBA pixel data.')
  }
}

export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length === 0) throw new Error('The image file is empty.')

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png'
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'gif'
  }

  throw new Error('Unsupported image format; expected PNG, JPEG, or GIF content.')
}

export function resolveLocalImagePath(uri: string) {
  const value = uri.trim()
  if (!value) throw new Error('Image URI is required.')

  const scheme = windowsDrivePattern.test(value) ? undefined : uriSchemePattern.exec(value)?.[1]
  if (scheme && /^https?$/i.test(scheme)) {
    throw new Error(
      'HTTP and HTTPS images are not supported; PixelRenderer accepts local files only.',
    )
  }
  if (scheme && !/^file$/i.test(scheme)) {
    throw new Error('PixelRenderer accepts only local file paths and file: URLs.')
  }

  if (scheme) {
    try {
      return fileURLToPath(new URL(value))
    } catch {
      throw new Error('The image file: URL is invalid or is not local.')
    }
  }
  return value
}

export async function readLocalImageBytes(uri: string, signal?: AbortSignal) {
  const path = resolveLocalImagePath(uri)
  throwIfAborted(signal)

  const reader = Bun.file(path).stream().getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0
  const cancel = () => {
    void reader.cancel(signal?.reason ?? abortError()).catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })

  try {
    while (true) {
      throwIfAborted(signal)
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      totalLength += chunk.byteLength
      if (!Number.isSafeInteger(totalLength) || totalLength > MAX_TYPED_ARRAY_LENGTH) {
        throw new Error('The image file is too large to read safely.')
      }
      chunks.push(chunk)
    }
    throwIfAborted(signal)

    const bytes = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

export function fittedDimensions(source: Dimensions, maximum: Dimensions): Dimensions {
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

export function centeredViewport(containerCells: Dimensions, imagePixels: Dimensions) {
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
  validateFrame(source)
  const targetLength = rgbaLength(target)
  throwIfAborted(signal)
  if (source.width === target.width && source.height === target.height) {
    return { ...target, data: source.data.slice() }
  }

  const data = new Uint8Array(targetLength)
  const scaleX = source.width / target.width
  const scaleY = source.height / target.height

  for (let y = 0; y < target.height; y += 1) {
    throwIfAborted(signal)
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

export function compositeAgainstBackground(frame: RgbaFrame, background: Rgb): RgbaFrame {
  validateFrame(frame)
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

export function normalizeGifDelay(delay: unknown) {
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) {
    return DEFAULT_GIF_DELAY_MS
  }
  return Math.max(MINIMUM_GIF_DELAY_MS, Math.round(delay))
}

function validateGifPatch(frame: GifPatchFrame, canvas: Dimensions) {
  const { left, top, width, height } = frame.dims
  requireInteger(left, 'GIF frame left offset', 0)
  requireInteger(top, 'GIF frame top offset', 0)
  requireInteger(width, 'GIF frame width', 1)
  requireInteger(height, 'GIF frame height', 1)
  if (frame.patch.byteLength !== rgbaLength({ width, height })) {
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
  const canvas = new Uint8Array(rgbaLength(source))
  const output: AnimationFrame[] = []
  let currentCanvas = canvas

  for (const frame of frames) {
    throwIfAborted(signal)
    validateGifPatch(frame, source)
    const restore = frame.disposalType === 3 ? currentCanvas.slice() : undefined
    drawGifPatch(currentCanvas, source, frame)
    const resized = resizeRgbaFrame({ ...source, data: currentCanvas }, target, signal)
    output.push({
      ...compositeAgainstBackground(resized, background),
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
  throwIfAborted(signal)
  const image = await StillImage.fromBuffer(copiedArrayBuffer(bytes))
  throwIfAborted(signal)
  const source: RgbaFrame = {
    width: image.bitmap.width,
    height: image.bitmap.height,
    data: Uint8Array.from(image.bitmap.data),
  }
  validateFrame(source)
  const target = fittedDimensions(source, maximum)
  return [
    {
      ...compositeAgainstBackground(resizeRgbaFrame(source, target, signal), background),
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
  throwIfAborted(signal)
  const gif = parseGIF(copiedArrayBuffer(bytes))
  const source = { width: gif.lsd.width, height: gif.lsd.height }
  rgbaLength(source)
  const target = fittedDimensions(source, maximum)
  const frames = decompressFrames(gif, true) as ParsedFrame[]
  throwIfAborted(signal)
  return compositeGifFrames(frames, source, target, background, signal)
}

export async function loadLocalImage(
  uri: string,
  maximum: Dimensions,
  background: Rgb,
  signal?: AbortSignal,
) {
  const bytes = await readLocalImageBytes(uri, signal)
  const format = detectImageFormat(bytes)
  throwIfAborted(signal)
  if (format === 'gif') return decodeGifImage(bytes, maximum, background, signal)
  return decodeStillImage(bytes, maximum, background, signal)
}

const systemClock: TimerClock = {
  now: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
}

export function startAnimationPlayback<Timer = ReturnType<typeof setTimeout>>(
  frames: readonly AnimationFrame[],
  onFrame: (frame: AnimationFrame) => void,
  options: AnimationPlaybackOptions<Timer> = {},
) {
  if (frames.length === 0) throw new Error('Animation playback requires at least one frame.')
  const clock = options.clock ?? (systemClock as TimerClock<Timer>)
  const durations = frames.map((frame) => normalizeGifDelay(frame.delayMs))
  const cumulativeEnds: number[] = []
  let cycleDuration = 0
  for (const duration of durations) {
    cycleDuration += duration
    if (!Number.isSafeInteger(cycleDuration)) {
      throw new Error('The GIF animation duration is too large to schedule safely.')
    }
    cumulativeEnds.push(cycleDuration)
  }

  let disposed = false
  let timer: Timer | undefined
  let currentIndex = 0
  const origin = clock.now()
  if (!Number.isFinite(origin)) throw new Error('The animation clock returned an invalid time.')
  onFrame(frames[0]!)

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (timer !== undefined) clock.clearTimer(timer)
    timer = undefined
  }
  if (frames.length === 1) return dispose

  const schedule = (nextFrameAt: number) => {
    if (disposed) return
    timer = clock.setTimer(advance, Math.max(0, nextFrameAt - clock.now()))
  }
  const locateFrame = (now: number) => {
    const elapsed = Math.max(0, now - origin)
    const cycle = Math.floor(elapsed / cycleDuration)
    const withinCycle = elapsed - cycle * cycleDuration
    let index = cumulativeEnds.findIndex((end) => end > withinCycle)
    if (index < 0) index = 0
    return {
      index,
      nextFrameAt: origin + cycle * cycleDuration + cumulativeEnds[index]!,
    }
  }
  function advance() {
    timer = undefined
    if (disposed) return
    try {
      const now = clock.now()
      if (!Number.isFinite(now)) throw new Error('The animation clock returned an invalid time.')
      const next = locateFrame(now)
      if (next.index !== currentIndex) {
        currentIndex = next.index
        onFrame(frames[currentIndex]!)
      }
      schedule(next.nextFrameAt)
    } catch (error) {
      dispose()
      options.onError?.(error)
    }
  }

  schedule(origin + cumulativeEnds[0]!)
  return dispose
}

export function createImageController({
  onError,
  onFrame,
  load = loadLocalImage,
  play = startAnimationPlayback,
}: ImageControllerOptions) {
  let abortController: AbortController | undefined
  let stopPlayback: (() => void) | undefined
  let generation = 0
  let disposed = false

  const cancel = () => {
    generation += 1
    abortController?.abort(abortError())
    abortController = undefined
    stopPlayback?.()
    stopPlayback = undefined
  }

  const replace = (request: ImageRequest) => {
    if (disposed) return
    cancel()
    onFrame(undefined)
    onError(undefined)

    const uri = request.uri.trim()
    if (!uri) {
      onError(new Error('Image URI is required.'))
      return
    }
    if (request.maximum.width < 2 || request.maximum.height < 2) return

    const requestGeneration = generation
    const controller = new AbortController()
    abortController = controller
    void load(uri, request.maximum, request.background, controller.signal)
      .then((frames) => {
        if (disposed || controller.signal.aborted || requestGeneration !== generation) return
        abortController = undefined
        const publishFrame = (frame: AnimationFrame) => {
          if (!disposed && !controller.signal.aborted && requestGeneration === generation) {
            onFrame(frame)
          }
        }
        stopPlayback = play(frames, publishFrame, {
          onError: (error) => {
            if (!disposed && requestGeneration === generation) onError(error)
          },
        })
      })
      .catch((error: unknown) => {
        if (
          disposed ||
          controller.signal.aborted ||
          requestGeneration !== generation ||
          isAbortError(error)
        ) {
          return
        }
        abortController = undefined
        onError(error)
      })
  }

  return {
    replace,
    dispose() {
      if (disposed) return
      disposed = true
      cancel()
      onFrame(undefined)
    },
  }
}
