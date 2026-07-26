import { OptimizedBuffer, type BoxRenderable, type RenderableOptions } from '@opentui/core'
import { createEffect, createSignal, onCleanup, onMount, Show, type ParentProps } from 'solid-js'
import { isMp4Uri } from '../helpers/media-uri'
import {
  configuredBackgroundColor,
  createImageCells,
  getPixelImageEntry,
  type Dimensions,
  type ImageCells,
  type PixelImageFrame,
} from '../helpers/pixel-image'
import { startVideoAudio, type VideoAudioSession } from '../helpers/video-audio'
import { MediaPlaybackClock, VideoFrameScheduler } from '../helpers/video-scheduler'
import { streamVideoFrames, type VideoFrame } from '../helpers/video-stream'

const ERROR_LENGTH = 220
const VIDEO_FRAMES_PER_SECOND = 24
const VIDEO_QUEUE_SIZE = 3

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

export interface ImageBufferViews {
  attributes: Uint32Array
  bg: Uint16Array
  char: Uint32Array
  fg: Uint16Array
}

export function writeImageCellsToBuffer(image: ImageCells, buffers: ImageBufferViews) {
  const cellCount = image.width * image.height
  if (
    buffers.char.length < cellCount ||
    buffers.attributes.length < cellCount ||
    buffers.fg.length < cellCount * 4 ||
    buffers.bg.length < cellCount * 4
  ) {
    throw new RangeError('The native image buffer is smaller than the pixel image.')
  }

  buffers.char.set(image.glyphs)
  buffers.attributes.fill(0, 0, cellCount)

  for (let cellOffset = 0; cellOffset < cellCount; cellOffset += 1) {
    const sourceOffset = cellOffset * 3
    const targetOffset = cellOffset * 4
    buffers.fg[targetOffset] = image.foregrounds[sourceOffset] ?? 0
    buffers.fg[targetOffset + 1] = image.foregrounds[sourceOffset + 1] ?? 0
    buffers.fg[targetOffset + 2] = image.foregrounds[sourceOffset + 2] ?? 0
    buffers.fg[targetOffset + 3] = 255
    buffers.bg[targetOffset] = image.backgrounds[sourceOffset] ?? 0
    buffers.bg[targetOffset + 1] = image.backgrounds[sourceOffset + 1] ?? 0
    buffers.bg[targetOffset + 2] = image.backgrounds[sourceOffset + 2] ?? 0
    buffers.bg[targetOffset + 3] = 255
  }
}

export function PixelRenderer(props: ParentProps<PixelRendererProps>) {
  let surface: BoxRenderable | undefined
  let currentImage: ImageCells | undefined
  let imageBuffer: OptimizedBuffer | undefined
  let imageVersion = 0
  let paintedImageVersion = -1
  const background = configuredBackgroundColor()
  const [container, setContainer] = createSignal<Dimensions>({ width: 0, height: 0 })
  const [error, setError] = createSignal('')

  const requestRender = () => surface?.requestRender()
  const showImage = (image: ImageCells | undefined) => {
    currentImage = image
    imageVersion += 1
    requestRender()
  }
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
    let disposeMedia = () => {}
    let unsubscribe = () => {}

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
    const startVideoPlayback = () => {
      const abortController = new AbortController()
      const reusableImages: ImageCells[] = []
      const frames = streamVideoFrames({
        uri,
        width: target.width * 2,
        height: target.height * 2,
        background: background.channels,
        framesPerSecond: VIDEO_FRAMES_PER_SECOND,
        signal: abortController.signal,
      })
      let audioFailureLogged = false
      let audioSession: VideoAudioSession | undefined
      let mediaDisposed = false
      let scheduler: VideoFrameScheduler<VideoFrame> | undefined
      const logAudioFailure = (audioError: unknown) => {
        if (audioFailureLogged || disposed || abortController.signal.aborted) return
        audioFailureLogged = true
        console.warn(
          `Termweave video audio is unavailable; continuing silently: ${errorMessage(audioError)}`,
        )
      }
      const stopVideoPlayback = () => {
        if (mediaDisposed) return
        mediaDisposed = true
        abortController.abort()
        scheduler?.dispose()
        audioSession?.dispose()
        void frames.return(undefined).catch(() => {})
      }
      disposeMedia = stopVideoPlayback

      void (async () => {
        const firstFramePromise = frames.next()
        const audioSessionPromise = startVideoAudio({
          onClockFallback: () => scheduler?.flush(),
          onFailure: logAudioFailure,
          signal: abortController.signal,
          uri,
        }).catch((audioError: unknown) => {
          logAudioFailure(audioError)
          return undefined
        })
        const [firstFrame, startedAudio] = await Promise.all([
          firstFramePromise,
          audioSessionPromise,
        ])
        audioSession = startedAudio
        if (disposed || abortController.signal.aborted) {
          if (!firstFrame.done) firstFrame.value.release()
          startedAudio?.dispose()
          return
        }
        if (firstFrame.done) throw new Error('FFmpeg video playback produced no frames.')

        const clock = startedAudio?.clock ?? new MediaPlaybackClock()
        scheduler = new VideoFrameScheduler<VideoFrame>({
          clock,
          framesPerSecond: VIDEO_FRAMES_PER_SECOND,
          maxQueueSize: VIDEO_QUEUE_SIZE,
          onDiscard: (frame) => frame.release(),
          onPresent: (frame) => {
            const image = createImageCells(frame, background.channels, reusableImages.pop())
            frame.release()
            const previousImage = currentImage
            showImage(image)
            if (previousImage) reusableImages.push(previousImage)
          },
          timelineOriginMs: 0,
        })

        if (!(await scheduler.enqueue(firstFrame.value))) return
        while (!abortController.signal.aborted) {
          const result = await frames.next()
          if (result.done || !(await scheduler.enqueue(result.value))) break
        }
      })().catch((loadError: unknown) => {
        if (disposed || abortController.signal.aborted) return
        stopVideoPlayback()
        showImage(undefined)
        setError(errorMessage(loadError))
      })
    }

    showImage(undefined)
    setError('')

    onCleanup(() => {
      disposed = true
      if (frameTimer) clearTimeout(frameTimer)
      disposeMedia()
      unsubscribe()
    })
    if (!uri || target.width === 0 || target.height === 0) return
    if (isMp4Uri(uri)) {
      startVideoPlayback()
      return
    }

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
  onCleanup(() => imageBuffer?.destroy())

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
          if (!surface || !currentImage) return

          if (!imageBuffer) {
            imageBuffer = OptimizedBuffer.create(
              currentImage.width,
              currentImage.height,
              'unicode',
              {
                id: 'pixel-renderer',
              },
            )
          } else {
            imageBuffer.resize(currentImage.width, currentImage.height)
          }
          if (paintedImageVersion !== imageVersion) {
            writeImageCellsToBuffer(currentImage, imageBuffer.buffers)
            paintedImageVersion = imageVersion
          }

          const viewport = centeredViewport(container(), currentImage)
          buffer.drawFrameBuffer(
            surface.screenX + viewport.x,
            surface.screenY + viewport.y,
            imageBuffer,
            0,
            0,
            viewport.width,
            viewport.height,
          )
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
