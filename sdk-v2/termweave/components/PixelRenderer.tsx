import { type BoxRenderable, type OptimizedBuffer, type RenderableOptions } from '@opentui/core'
import { ptr } from 'bun:ffi'
import { createEffect, createSignal, onCleanup, onMount, Show, type ParentProps } from 'solid-js'
import { getTermweaveConfig } from '../config'
import {
  PIXEL_RENDERER_ERROR_BACKGROUND_COLOR,
  PIXEL_RENDERER_ERROR_FOREGROUND_COLOR,
} from '../constants'
import { createImagePlaybackController } from './image-controller'
import {
  calculateCenteredViewport,
  parseHexColor,
  type AnimationFrame,
  type Dimensions,
} from './pixel-frame'

const ERROR_LENGTH = 220

type PixelRendererDimension = NonNullable<RenderableOptions['width']>

export interface PixelRendererProps {
  uri: string
  width?: PixelRendererDimension
  height?: PixelRendererDimension
}

export function formatPixelRendererError(error: unknown) {
  const normalized = (error instanceof Error ? error.message : String(error))
    .trim()
    .replaceAll(/\s+/g, ' ')
  const message = normalized || 'Unknown image error.'
  return message.length <= ERROR_LENGTH ? message : `${message.slice(0, ERROR_LENGTH - 1)}…`
}

export function drawPixelFrameToBuffer(
  buffer: Pick<OptimizedBuffer, 'drawSuperSampleBuffer' | 'popScissorRect' | 'pushScissorRect'>,
  surface: Pick<BoxRenderable, 'screenX' | 'screenY'>,
  container: Dimensions,
  frame: AnimationFrame,
) {
  const viewport = calculateCenteredViewport(container, frame)
  const x = surface.screenX + viewport.x
  const y = surface.screenY + viewport.y
  if (x < 0 || y < 0) throw new Error('The fitted image is outside the active terminal buffer.')

  buffer.pushScissorRect(x, y, viewport.width, viewport.height)
  try {
    buffer.drawSuperSampleBuffer(
      x,
      y,
      ptr(frame.data),
      frame.data.byteLength,
      'rgba8unorm',
      frame.width * 4,
    )
  } finally {
    buffer.popScissorRect()
  }
}

export function PixelRenderer(props: ParentProps<PixelRendererProps>) {
  let surface: BoxRenderable | undefined
  let currentFrame: AnimationFrame | undefined
  let disposed = false
  const config = getTermweaveConfig()
  const background = parseHexColor(config.themeColor)
  const [container, setContainer] = createSignal<Dimensions>({ width: 0, height: 0 })
  const [error, setError] = createSignal('')

  const requestRender = () => {
    if (!surface?.isDestroyed) surface?.requestRender()
  }
  const showFrame = (frame: AnimationFrame | undefined) => {
    currentFrame = frame
    requestRender()
  }
  const showError = (nextError: unknown | undefined) => {
    setError(nextError === undefined ? '' : formatPixelRendererError(nextError))
    requestRender()
  }
  const controller = createImagePlaybackController({ onError: showError, onFrame: showFrame })
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
    const size = container()
    controller.replace({
      uri: props.uri,
      maximum: { width: size.width * 2, height: size.height * 2 },
      background,
    })
  })

  onMount(updateDimensions)
  onCleanup(() => {
    disposed = true
    controller.dispose()
  })

  const width = () => props.width ?? 'auto'
  const height = () => props.height ?? 'auto'
  return (
    <box
      ref={surface}
      width={width()}
      height={height()}
      flexGrow={width() === 'auto' && height() === 'auto' ? 1 : 0}
      backgroundColor={config.themeColor}
      overflow="hidden"
      onSizeChange={updateDimensions}
      renderAfter={(buffer) => {
        if (!surface || !currentFrame) return
        const frame = currentFrame
        try {
          drawPixelFrameToBuffer(buffer, surface, container(), frame)
        } catch (drawError) {
          currentFrame = undefined
          queueMicrotask(() => {
            if (!disposed) showError(drawError)
          })
        }
      }}
    >
      <Show when={Boolean(error())}>
        <box
          position="absolute"
          top={0}
          left={0}
          width="100%"
          minHeight={3}
          padding={1}
          backgroundColor={PIXEL_RENDERER_ERROR_BACKGROUND_COLOR}
          zIndex={2}
        >
          <text fg={PIXEL_RENDERER_ERROR_FOREGROUND_COLOR}>PixelRenderer: {error()}</text>
        </box>
      </Show>

      {props.children}
    </box>
  )
}
