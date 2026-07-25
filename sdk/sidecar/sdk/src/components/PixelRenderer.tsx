import {
  RGBA,
  type BoxRenderable,
  type OptimizedBuffer,
  type RenderableOptions,
} from '@opentui/core'
import { createEffect, createSignal, onCleanup, onMount, Show, type ParentProps } from 'solid-js'
import {
  configuredBackgroundColor,
  FULL_BLOCK,
  getPixelImageEntry,
  type Dimensions,
  type ImageCells,
  type PixelImageFrame,
} from '../helpers/pixel-image'

const ERROR_LENGTH = 220

export {
  preloadPixelImage,
  preloadPixelImages,
  type PixelImagePreloadOptions,
} from '../helpers/pixel-image'

export type PixelRendererDimension = NonNullable<RenderableOptions['width']>

export interface PixelRendererProps {
  uri: string
  width?: PixelRendererDimension
  height?: PixelRendererDimension
}

interface Viewport extends Dimensions {
  x: number
  y: number
}

function errorMessage(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error))
    .trim()
    .replaceAll(/\s+/g, ' ')
  return message.length <= ERROR_LENGTH ? message : `${message.slice(0, ERROR_LENGTH - 1)}…`
}

export function centeredViewport(container: Dimensions, image: Dimensions): Viewport {
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

export function paintImage(
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

  const requestRender = () => surface?.requestRender()
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

    const showImage = (image: ImageCells) => {
      currentImage = image
      requestRender()
    }
    const startPlayback = (images: readonly PixelImageFrame[]) => {
      if (disposed || images.length === 0) return

      let frameIndex = 0
      const cycleDurationMs = images.reduce((duration, image) => duration + image.delayMs, 0)
      let nextFrameAt = performance.now() + images[frameIndex]!.delayMs
      showImage(images[frameIndex]!)
      const scheduleNextFrame = () => {
        frameTimer = setTimeout(advanceFrame, Math.max(0, nextFrameAt - performance.now()))
      }
      const advanceFrame = () => {
        if (disposed || images.length < 2) return

        const now = performance.now()
        if (now < nextFrameAt) {
          scheduleNextFrame()
          return
        }
        if (now - nextFrameAt >= cycleDurationMs) {
          nextFrameAt += Math.floor((now - nextFrameAt) / cycleDurationMs) * cycleDurationMs
        }
        do {
          frameIndex = (frameIndex + 1) % images.length
          nextFrameAt += images[frameIndex]!.delayMs
        } while (nextFrameAt <= now)

        showImage(images[frameIndex]!)
        scheduleNextFrame()
      }
      if (images.length > 1) scheduleNextFrame()
    }

    currentImage = undefined
    setError('')
    requestRender()

    onCleanup(() => {
      disposed = true
      if (frameTimer) clearTimeout(frameTimer)
      unsubscribe()
    })
    if (!uri || target.width === 0 || target.height === 0) return

    const { entry } = getPixelImageEntry(
      { uri, width: target.width, height: target.height },
      background.channels,
    )
    if (entry.complete) {
      startPlayback(entry.images)
      return
    }

    const showFirstImage = (image: ImageCells) => {
      if (!disposed && !currentImage) showImage(image)
    }
    if (entry.images[0]) showFirstImage(entry.images[0])
    entry.listeners.add(showFirstImage)
    unsubscribe = () => entry.listeners.delete(showFirstImage)

    void entry.promise
      .then((images) => {
        unsubscribe()
        startPlayback(images)
      })
      .catch((loadError) => {
        if (!disposed) setError(errorMessage(loadError))
      })
  })

  onMount(updateDimensions)

  const width = () => props.width ?? 'auto'
  const height = () => props.height ?? 'auto'
  return (
    <box
      width={width()}
      height={height()}
      flexGrow={width() === 'auto' && height() === 'auto' ? 1 : 0}
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
