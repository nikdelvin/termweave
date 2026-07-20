import {
  RGBA,
  type BoxRenderable,
  type OptimizedBuffer,
  type RenderableOptions,
} from '@opentui/core'
import { createJimp } from '@jimp/core'
import jpeg from '@jimp/js-jpeg'
import png from '@jimp/js-png'
import { decompressFrame, parseGIF, type ParsedFrame } from 'gifuct-js'
import { fileURLToPath } from 'node:url'
import { createEffect, createSignal, onCleanup, onMount, Show, type ParentProps } from 'solid-js'

const FULL_BLOCK = 0x2588
const SOURCE_PIXELS_PER_CELL_X = 2
const SOURCE_PIXELS_PER_CELL_Y = 2
const ERROR_LENGTH = 220
const GIF_FRAME_DELAY_MS = 150
const IMAGE_CACHE_LIMIT = 8
const StillImage = createJimp({ formats: [jpeg, png] })
const QUADRANT_GLYPHS = new Uint32Array([
  0x20, // 0000
  0x2597, // 0001 ▗ lower-right
  0x2596, // 0010 ▖ lower-left
  0x2584, // 0011 ▄ lower half
  0x259d, // 0100 ▝ upper-right
  0x2590, // 0101 ▐ right half
  0x259e, // 0110 ▞ upper-right + lower-left
  0x259f, // 0111 ▟ except upper-left
  0x2598, // 1000 ▘ upper-left
  0x259a, // 1001 ▚ upper-left + lower-right
  0x258c, // 1010 ▌ left half
  0x2599, // 1011 ▙ except upper-right
  0x2580, // 1100 ▀ upper half
  0x259c, // 1101 ▜ except lower-left
  0x259b, // 1110 ▛ except lower-right
  FULL_BLOCK, // 1111
])

export type PixelRendererDimension = NonNullable<RenderableOptions['width']>

export interface PixelRendererProps {
  uri: string
  width?: PixelRendererDimension
  height?: PixelRendererDimension
}

export interface PixelImagePreloadOptions {
  uri: string
  width: number
  height: number
}

interface Dimensions {
  height: number
  width: number
}

interface Frame extends Dimensions {
  data: Uint8Array
}

interface GifFrameDimensions extends Dimensions {
  left: number
  top: number
}

interface ImageCells extends Dimensions {
  backgrounds: Uint8Array
  foregrounds: Uint8Array
  glyphs: Uint32Array
}

interface ImageCacheEntry {
  complete: boolean
  images: ImageCells[]
  listeners: Set<(image: ImageCells) => void>
  promise: Promise<readonly ImageCells[]>
}

const imageCache = new Map<string, ImageCacheEntry>()
let retainedPreloadKeys = new Set<string>()

type Rgb = readonly [red: number, green: number, blue: number]

interface Viewport extends Dimensions {
  x: number
  y: number
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function clippedError(message: string) {
  const normalized = message.trim().replaceAll(/\s+/g, ' ')
  if (normalized.length <= ERROR_LENGTH) return normalized
  return `${normalized.slice(0, ERROR_LENGTH - 1)}…`
}

function configuredBackgroundColor() {
  const color = process.env.TERMWEAVE_THEME_COLOR?.trim()
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color ?? '')
  if (!color || !match) {
    throw new Error('TERMWEAVE_THEME_COLOR must be a six-digit hex color.')
  }

  return {
    color,
    channels: [
      Number.parseInt(match[1]!, 16),
      Number.parseInt(match[2]!, 16),
      Number.parseInt(match[3]!, 16),
    ] as Rgb,
  }
}

function remoteUri(uri: string) {
  return /^https?:\/\//i.test(uri)
}

async function readImageBytes(uri: string, signal: AbortSignal) {
  if (remoteUri(uri)) {
    const response = await fetch(uri, { signal })
    if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}.`)
    return new Uint8Array(await response.arrayBuffer())
  }

  const path = uri.startsWith('file:') ? fileURLToPath(uri) : uri
  const bytes = await Bun.file(path).bytes()
  signal.throwIfAborted()
  return bytes
}

function fittedDimensions(source: Dimensions, maximum: Dimensions): Dimensions {
  const scale = Math.min(maximum.width / source.width, maximum.height / source.height)
  const width = Math.max(
    SOURCE_PIXELS_PER_CELL_X,
    Math.floor((source.width * scale) / SOURCE_PIXELS_PER_CELL_X) * SOURCE_PIXELS_PER_CELL_X,
  )
  const height = Math.max(
    SOURCE_PIXELS_PER_CELL_Y,
    Math.floor((source.height * scale) / SOURCE_PIXELS_PER_CELL_Y) * SOURCE_PIXELS_PER_CELL_Y,
  )

  return {
    width: Math.min(width, maximum.width),
    height: Math.min(height, maximum.height),
  }
}

function copiedArrayBuffer(bytes: Uint8Array) {
  return Uint8Array.from(bytes).buffer
}

function gifSignature(bytes: Uint8Array) {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
}

function clearFrameArea(data: Uint8Array, canvas: Dimensions, area: GifFrameDimensions) {
  const left = Math.max(0, area.left)
  const top = Math.max(0, area.top)
  const right = Math.min(canvas.width, area.left + area.width)
  const bottom = Math.min(canvas.height, area.top + area.height)

  for (let y = top; y < bottom; y += 1) {
    data.fill(0, (y * canvas.width + left) * 4, (y * canvas.width + right) * 4)
  }
}

function drawGifPatch(data: Uint8Array, canvas: Dimensions, frame: ParsedFrame) {
  const { dims, patch } = frame
  if (patch.length !== dims.width * dims.height * 4) {
    throw new Error('The GIF decoder returned an invalid frame patch.')
  }

  for (let y = 0; y < dims.height; y += 1) {
    const destinationY = dims.top + y
    if (destinationY < 0 || destinationY >= canvas.height) continue

    for (let x = 0; x < dims.width; x += 1) {
      const destinationX = dims.left + x
      if (destinationX < 0 || destinationX >= canvas.width) continue

      const sourceOffset = (y * dims.width + x) * 4
      const opacity = patch[sourceOffset + 3] ?? 0
      if (opacity === 0) continue

      const destinationOffset = (destinationY * canvas.width + destinationX) * 4
      data[destinationOffset] = patch[sourceOffset] ?? 0
      data[destinationOffset + 1] = patch[sourceOffset + 1] ?? 0
      data[destinationOffset + 2] = patch[sourceOffset + 2] ?? 0
      data[destinationOffset + 3] = opacity
    }
  }
}

function resizeFrame(source: Frame, target: Dimensions): Frame {
  if (source.width === target.width && source.height === target.height) {
    return { ...target, data: source.data.slice() }
  }

  const data = new Uint8Array(target.width * target.height * 4)
  const scaleX = source.width / target.width
  const scaleY = source.height / target.height

  for (let y = 0; y < target.height; y += 1) {
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
        (top * source.width + left) * 4,
        (top * source.width + right) * 4,
        (bottom * source.width + left) * 4,
        (bottom * source.width + right) * 4,
      ]
      let alpha = 0
      let premultipliedRed = 0
      let premultipliedGreen = 0
      let premultipliedBlue = 0

      for (let sample = 0; sample < offsets.length; sample += 1) {
        const offset = offsets[sample] ?? 0
        const weight = weights[sample] ?? 0
        const sampleAlpha = (source.data[offset + 3] ?? 0) / 255
        alpha += sampleAlpha * weight
        premultipliedRed += (source.data[offset] ?? 0) * sampleAlpha * weight
        premultipliedGreen += (source.data[offset + 1] ?? 0) * sampleAlpha * weight
        premultipliedBlue += (source.data[offset + 2] ?? 0) * sampleAlpha * weight
      }

      const destinationOffset = (y * target.width + x) * 4
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

function gifFrameIterator(
  bytes: Uint8Array,
  maximum: Dimensions,
  signal: AbortSignal,
): IterableIterator<Frame> | undefined {
  if (!gifSignature(bytes)) return undefined

  const gif = parseGIF(copiedArrayBuffer(bytes))
  const source = { width: gif.lsd.width, height: gif.lsd.height }
  if (
    !Number.isInteger(source.width) ||
    source.width < 1 ||
    !Number.isInteger(source.height) ||
    source.height < 1
  ) {
    throw new Error('The GIF decoder did not return valid dimensions.')
  }

  const target = fittedDimensions(source, maximum)
  let canvas = new Uint8Array(source.width * source.height * 4)

  return (function* () {
    let frameCount = 0

    for (const rawFrame of gif.frames) {
      signal.throwIfAborted()
      if (!('image' in rawFrame)) continue

      const frame = decompressFrame(rawFrame, gif.gct, true)
      const restoreData = frame.disposalType === 3 ? canvas.slice() : undefined
      drawGifPatch(canvas, source, frame)
      frameCount += 1
      yield resizeFrame({ ...source, data: canvas }, target)

      if (frame.disposalType === 2) {
        clearFrameArea(canvas, source, frame.dims)
      } else if (restoreData) {
        canvas = restoreData
      }
    }

    if (frameCount === 0) throw new Error('The GIF does not contain any image frames.')
  })()
}

async function loadStillFrame(bytes: Uint8Array, maximum: Dimensions, signal: AbortSignal) {
  const image = await StillImage.fromBuffer(copiedArrayBuffer(bytes))
  signal.throwIfAborted()

  const source = { width: image.bitmap.width, height: image.bitmap.height }
  if (
    !Number.isInteger(source.width) ||
    source.width < 1 ||
    !Number.isInteger(source.height) ||
    source.height < 1 ||
    image.bitmap.data.length !== source.width * source.height * 4
  ) {
    throw new Error('The image decoder did not return valid pixel data.')
  }

  return resizeFrame(
    { ...source, data: Uint8Array.from(image.bitmap.data) },
    fittedDimensions(source, maximum),
  )
}

async function* loadImageFrames(uri: string, maximum: Dimensions, signal: AbortSignal) {
  const bytes = await readImageBytes(uri, signal)
  const gifFrames = gifFrameIterator(bytes, maximum, signal)
  if (gifFrames) {
    yield* gifFrames
    return
  }

  yield await loadStillFrame(bytes, maximum, signal)
}

function imageCacheKey(uri: string, maximum: Dimensions, background: Rgb) {
  return `${uri}\0${maximum.width}x${maximum.height}\0${background.join(',')}`
}

function yieldToRenderer() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

function readPixel(
  frame: Frame,
  sourceX: number,
  sourceY: number,
  colors: Uint16Array,
  colorOffset: number,
  background: Rgb,
) {
  const pixelOffset = (sourceY * frame.width + sourceX) * 4
  const opacity = (frame.data[pixelOffset + 3] ?? 255) / 255
  colors[colorOffset] = Math.round(
    (frame.data[pixelOffset] ?? 0) * opacity + background[0] * (1 - opacity),
  )
  colors[colorOffset + 1] = Math.round(
    (frame.data[pixelOffset + 1] ?? 0) * opacity + background[1] * (1 - opacity),
  )
  colors[colorOffset + 2] = Math.round(
    (frame.data[pixelOffset + 2] ?? 0) * opacity + background[2] * (1 - opacity),
  )
}

function allQuadrantsMatch(colors: Uint16Array) {
  for (let offset = 3; offset < colors.length; offset += 3) {
    if (
      colors[offset] !== colors[0] ||
      colors[offset + 1] !== colors[1] ||
      colors[offset + 2] !== colors[2]
    ) {
      return false
    }
  }

  return true
}

function fitQuadrants(
  colors: Uint16Array,
  foregroundChannels: Uint16Array,
  backgroundChannels: Uint16Array,
) {
  if (allQuadrantsMatch(colors)) {
    foregroundChannels.set(colors.subarray(0, 3))
    backgroundChannels.set(colors.subarray(0, 3))
    return 0b1111
  }

  let bestMask = 0b1000
  let bestError = Number.POSITIVE_INFINITY

  // A 2×2 cell has seven unique two-color partitions. Keeping the
  // upper-left sample in the foreground avoids evaluating complements.
  for (let mask = 0b1000; mask < 0b1111; mask += 1) {
    let foregroundCount = 0
    let backgroundCount = 0
    let foregroundRed = 0
    let foregroundGreen = 0
    let foregroundBlue = 0
    let backgroundRed = 0
    let backgroundGreen = 0
    let backgroundBlue = 0

    for (let pixelIndex = 0; pixelIndex < 4; pixelIndex += 1) {
      const offset = pixelIndex * 3
      if ((mask & (1 << (3 - pixelIndex))) !== 0) {
        foregroundCount += 1
        foregroundRed += colors[offset] ?? 0
        foregroundGreen += colors[offset + 1] ?? 0
        foregroundBlue += colors[offset + 2] ?? 0
      } else {
        backgroundCount += 1
        backgroundRed += colors[offset] ?? 0
        backgroundGreen += colors[offset + 1] ?? 0
        backgroundBlue += colors[offset + 2] ?? 0
      }
    }

    const foregroundMeanRed = foregroundRed / foregroundCount
    const foregroundMeanGreen = foregroundGreen / foregroundCount
    const foregroundMeanBlue = foregroundBlue / foregroundCount
    const backgroundMeanRed = backgroundRed / backgroundCount
    const backgroundMeanGreen = backgroundGreen / backgroundCount
    const backgroundMeanBlue = backgroundBlue / backgroundCount
    let error = 0

    for (let pixelIndex = 0; pixelIndex < 4; pixelIndex += 1) {
      const offset = pixelIndex * 3
      const foreground = (mask & (1 << (3 - pixelIndex))) !== 0
      const redDifference =
        (colors[offset] ?? 0) - (foreground ? foregroundMeanRed : backgroundMeanRed)
      const greenDifference =
        (colors[offset + 1] ?? 0) - (foreground ? foregroundMeanGreen : backgroundMeanGreen)
      const blueDifference =
        (colors[offset + 2] ?? 0) - (foreground ? foregroundMeanBlue : backgroundMeanBlue)

      error +=
        redDifference * redDifference * 0.299 +
        greenDifference * greenDifference * 0.587 +
        blueDifference * blueDifference * 0.114
    }

    if (error < bestError) {
      bestError = error
      bestMask = mask
      foregroundChannels[0] = Math.round(foregroundMeanRed)
      foregroundChannels[1] = Math.round(foregroundMeanGreen)
      foregroundChannels[2] = Math.round(foregroundMeanBlue)
      backgroundChannels[0] = Math.round(backgroundMeanRed)
      backgroundChannels[1] = Math.round(backgroundMeanGreen)
      backgroundChannels[2] = Math.round(backgroundMeanBlue)
    }
  }

  return bestMask
}

function createImageCells(frame: Frame, background: Rgb): ImageCells {
  const width = Math.floor(frame.width / SOURCE_PIXELS_PER_CELL_X)
  const height = Math.floor(frame.height / SOURCE_PIXELS_PER_CELL_Y)
  const glyphs = new Uint32Array(width * height)
  const foregrounds = new Uint8Array(width * height * 3)
  const backgrounds = new Uint8Array(width * height * 3)
  const colors = new Uint16Array(12)
  const foregroundChannels = new Uint16Array(3)
  const backgroundChannels = new Uint16Array(3)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x * SOURCE_PIXELS_PER_CELL_X
      const sourceY = y * SOURCE_PIXELS_PER_CELL_Y
      const cellOffset = y * width + x
      const colorOffset = cellOffset * 3

      readPixel(frame, sourceX, sourceY, colors, 0, background)
      readPixel(frame, sourceX + 1, sourceY, colors, 3, background)
      readPixel(frame, sourceX, sourceY + 1, colors, 6, background)
      readPixel(frame, sourceX + 1, sourceY + 1, colors, 9, background)

      const mask = fitQuadrants(colors, foregroundChannels, backgroundChannels)
      glyphs[cellOffset] = QUADRANT_GLYPHS[mask] ?? FULL_BLOCK
      foregrounds[colorOffset] = foregroundChannels[0] ?? 0
      foregrounds[colorOffset + 1] = foregroundChannels[1] ?? 0
      foregrounds[colorOffset + 2] = foregroundChannels[2] ?? 0
      backgrounds[colorOffset] = backgroundChannels[0] ?? 0
      backgrounds[colorOffset + 1] = backgroundChannels[1] ?? 0
      backgrounds[colorOffset + 2] = backgroundChannels[2] ?? 0
    }
  }

  return { backgrounds, foregrounds, glyphs, width, height }
}

function trimImageCache() {
  if (imageCache.size <= IMAGE_CACHE_LIMIT) return

  for (const [key, entry] of imageCache) {
    if (!entry.complete || retainedPreloadKeys.has(key)) continue
    imageCache.delete(key)
    if (imageCache.size <= IMAGE_CACHE_LIMIT) return
  }
}

function getImageEntry(uri: string, maximum: Dimensions, background: Rgb) {
  const key = imageCacheKey(uri, maximum, background)
  const cached = imageCache.get(key)
  if (cached) {
    imageCache.delete(key)
    imageCache.set(key, cached)
    return cached
  }

  const entry: ImageCacheEntry = {
    complete: false,
    images: [],
    listeners: new Set(),
    promise: Promise.resolve([]),
  }
  const signal = new AbortController().signal

  entry.promise = (async () => {
    for await (const frame of loadImageFrames(uri, maximum, signal)) {
      const image = createImageCells(frame, background)
      entry.images.push(image)
      for (const listener of entry.listeners) listener(image)
      await yieldToRenderer()
    }

    entry.complete = true
    entry.listeners.clear()
    trimImageCache()
    return entry.images
  })().catch((error: unknown) => {
    if (imageCache.get(key) === entry) imageCache.delete(key)
    entry.listeners.clear()
    throw error
  })

  imageCache.set(key, entry)
  trimImageCache()
  return entry
}

function preloadDimension(value: number, name: string) {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a positive number.`)
  }
  return Math.floor(value)
}

function getPreloadEntry(options: PixelImagePreloadOptions, background: Rgb) {
  const uri = options.uri.trim()
  if (!uri) throw new Error('Pixel image URI is required.')

  const width = preloadDimension(options.width, 'Pixel image preload width')
  const height = preloadDimension(options.height, 'Pixel image preload height')
  const maximum = {
    width: width * SOURCE_PIXELS_PER_CELL_X,
    height: height * SOURCE_PIXELS_PER_CELL_Y,
  }

  return {
    entry: getImageEntry(uri, maximum, background),
    key: imageCacheKey(uri, maximum, background),
  }
}

export async function preloadPixelImage(options: PixelImagePreloadOptions) {
  const { entry } = getPreloadEntry(options, configuredBackgroundColor().channels)
  await entry.promise
}

export async function preloadPixelImages(options: readonly PixelImagePreloadOptions[]) {
  const background = configuredBackgroundColor().channels
  const preloads = options.map((option) => getPreloadEntry(option, background))

  retainedPreloadKeys = new Set(preloads.map(({ key }) => key))
  trimImageCache()
  await Promise.all(preloads.map(({ entry }) => entry.promise))
}

function centeredViewport(container: Dimensions, image: Dimensions): Viewport {
  const width = Math.min(container.width, image.width)
  const height = Math.min(container.height, image.height)

  return {
    width,
    height,
    x: Math.floor((container.width - width) / 2),
    y: Math.floor((container.height - height) / 2),
  }
}

function setRgb(color: RGBA, channels: Uint8Array, offset: number) {
  color.buffer[0] = (color.buffer[0]! & 0xff00) | (channels[offset] ?? 0)
  color.buffer[1] = (color.buffer[1]! & 0xff00) | (channels[offset + 1] ?? 0)
  color.buffer[2] = (color.buffer[2]! & 0xff00) | (channels[offset + 2] ?? 0)
}

function paintImage(
  buffer: OptimizedBuffer,
  renderable: BoxRenderable,
  image: ImageCells,
  container: Dimensions,
) {
  const viewport = centeredViewport(container, image)
  const foreground = RGBA.fromInts(0, 0, 0)
  const background = RGBA.fromInts(0, 0, 0)

  for (let y = 0; y < viewport.height; y += 1) {
    for (let x = 0; x < viewport.width; x += 1) {
      const cellOffset = y * image.width + x
      const colorOffset = cellOffset * 3
      setRgb(foreground, image.foregrounds, colorOffset)
      setRgb(background, image.backgrounds, colorOffset)
      buffer.drawChar(
        image.glyphs[cellOffset] ?? FULL_BLOCK,
        renderable.screenX + viewport.x + x,
        renderable.screenY + viewport.y + y,
        foreground,
        background,
      )
    }
  }
}

export function PixelRenderer(props: ParentProps<PixelRendererProps>) {
  let surface: BoxRenderable | undefined
  let currentImage: ImageCells | undefined
  const background = configuredBackgroundColor()
  const [container, setContainer] = createSignal<Dimensions>({ width: 0, height: 0 })
  const [error, setError] = createSignal('')

  const updateDimensions = () => {
    if (!surface) return

    const next = {
      width: Math.max(0, Math.floor(surface.width)),
      height: Math.max(0, Math.floor(surface.height)),
    }
    setContainer((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    )
  }

  createEffect(() => {
    const uri = props.uri.trim()
    const target = container()
    let disposed = false
    let frameTimer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe = () => {}

    const startPlayback = (images: readonly ImageCells[]) => {
      if (disposed || images.length === 0) return

      let frameIndex = 0
      currentImage = images[frameIndex]
      surface?.requestRender()

      const advanceFrame = () => {
        if (disposed || images.length < 2) return
        frameIndex = (frameIndex + 1) % images.length
        currentImage = images[frameIndex]
        surface?.requestRender()
        frameTimer = setTimeout(advanceFrame, GIF_FRAME_DELAY_MS)
      }

      if (images.length > 1) frameTimer = setTimeout(advanceFrame, GIF_FRAME_DELAY_MS)
    }

    currentImage = undefined
    setError('')
    surface?.requestRender()

    onCleanup(() => {
      disposed = true
      if (frameTimer) clearTimeout(frameTimer)
      unsubscribe()
    })

    if (!uri || target.width === 0 || target.height === 0) return

    const maximum = {
      width: target.width * SOURCE_PIXELS_PER_CELL_X,
      height: target.height * SOURCE_PIXELS_PER_CELL_Y,
    }
    const entry = getImageEntry(uri, maximum, background.channels)
    if (entry.complete) {
      startPlayback(entry.images)
      return
    }

    const showFirstImage = (image: ImageCells) => {
      if (disposed || currentImage) return
      currentImage = image
      surface?.requestRender()
    }
    const firstImage = entry.images[0]
    if (firstImage) showFirstImage(firstImage)
    entry.listeners.add(showFirstImage)
    unsubscribe = () => entry.listeners.delete(showFirstImage)

    void entry.promise
      .then((images) => {
        unsubscribe()
        if (!disposed) startPlayback(images)
      })
      .catch((loadError) => {
        if (!disposed) {
          setError(clippedError(messageFrom(loadError)))
        }
      })
  })

  onMount(updateDimensions)

  onCleanup(() => {
    currentImage = undefined
  })

  const fillsAvailableSpace =
    (props.width ?? 'auto') === 'auto' && (props.height ?? 'auto') === 'auto'

  return (
    <box
      width={props.width ?? 'auto'}
      height={props.height ?? 'auto'}
      flexGrow={fillsAvailableSpace ? 1 : 0}
      backgroundColor={background.color}
      overflow="hidden"
    >
      <box
        ref={surface}
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        backgroundColor={background.color}
        onSizeChange={updateDimensions}
        renderAfter={(buffer) => {
          if (surface && currentImage) paintImage(buffer, surface, currentImage, container())
        }}
      />

      <Show when={Boolean(error())}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          minHeight={3}
          padding={1}
          backgroundColor="#351B19"
          zIndex={2}
        >
          <text fg="#E9E3D2">PixelRenderer: {error()}</text>
        </box>
      </Show>

      {props.children}
    </box>
  )
}
