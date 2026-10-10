/** @jsxImportSource @opentui/react */
import {
  NativeImage,
  type BoxRenderable,
  type OptimizedBuffer,
  type RenderableOptions,
} from '@opentui/core'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { applyCrtPalette, parseHexRgb, type Rgb } from '../color'
import { getTermweaveConfig } from '../config'
import {
  PIXEL_RENDERER_ERROR_BACKGROUND_COLOR,
  PIXEL_RENDERER_ERROR_FOREGROUND_COLOR,
} from '../constants'
import { errorMessage } from '../error-message'

const SOURCE_PIXELS_PER_CELL = 2
const ERROR_LENGTH = 220

type PixelRendererDimension = NonNullable<RenderableOptions['width']>

export interface PixelRendererProps {
  uri: string
  width?: PixelRendererDimension
  height?: PixelRendererDimension
  children?: ReactNode
}

export interface Dimensions {
  width: number
  height: number
}

export interface RgbaFrame extends Dimensions {
  data: Uint8Array
}

export function formatPixelRendererError(error: unknown) {
  const normalized = errorMessage(error).trim().replaceAll(/\s+/g, ' ')
  const message = normalized || 'Unknown image error.'
  return message.length <= ERROR_LENGTH ? message : `${message.slice(0, ERROR_LENGTH - 1)}…`
}

function requirePositiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer greater than or equal to 1.`)
  }
}

export function fitImageDimensions(source: Dimensions, maximum: Dimensions): Dimensions {
  requirePositiveInteger(source.width, 'Image width')
  requirePositiveInteger(source.height, 'Image height')
  requirePositiveInteger(maximum.width, 'Maximum width')
  requirePositiveInteger(maximum.height, 'Maximum height')
  const scale = Math.min(maximum.width / source.width, maximum.height / source.height)
  const fittedWidth = Math.max(2, Math.floor(source.width * scale))
  const fittedHeight = Math.max(2, Math.floor(source.height * scale))
  return {
    width: fittedWidth - (fittedWidth % 2),
    height: fittedHeight - (fittedHeight % 2),
  }
}

interface CenteredViewport extends Dimensions {
  x: number
  y: number
}

export function calculateCenteredViewport(
  containerCells: Dimensions,
  imagePixels: Dimensions,
): CenteredViewport {
  requirePositiveInteger(containerCells.width, 'Container width')
  requirePositiveInteger(containerCells.height, 'Container height')
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
  }
}

export function compositeRgbaInto(source: Uint8Array, destination: Uint8Array, background: Rgb) {
  if (source.byteLength !== destination.byteLength || source.byteLength % 4 !== 0) {
    throw new Error('RGBA composition requires equally sized complete pixel buffers.')
  }
  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3]! / 255
    destination[offset] = Math.round(source[offset]! * alpha + background[0] * (1 - alpha))
    destination[offset + 1] = Math.round(source[offset + 1]! * alpha + background[1] * (1 - alpha))
    destination[offset + 2] = Math.round(source[offset + 2]! * alpha + background[2] * (1 - alpha))
    destination[offset + 3] = 255
  }
  applyCrtPalette(destination)
}

export function drawPixelFrameToBuffer(
  buffer: Pick<OptimizedBuffer, 'drawSuperSampleBuffer' | 'popScissorRect' | 'pushScissorRect'>,
  surface: Pick<BoxRenderable, 'screenX' | 'screenY'>,
  container: Dimensions,
  frame: RgbaFrame,
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
      frame.data,
      frame.data.byteLength,
      'rgba8unorm',
      frame.width * 4,
    )
  } finally {
    buffer.popScissorRect()
  }
}

async function loadQuantizedFrame(uri: string, container: Dimensions, background: Rgb) {
  const bytes = new Uint8Array(await Bun.file(uri).arrayBuffer())
  const image = NativeImage.decode(bytes)
  try {
    const maximum = {
      width: container.width * SOURCE_PIXELS_PER_CELL,
      height: container.height * SOURCE_PIXELS_PER_CELL,
    }
    const fitted = fitImageDimensions({ width: image.width, height: image.height }, maximum)
    const resized = image.resize({ width: fitted.width, height: fitted.height, kernel: 'triangle' })
    try {
      const raw = resized.raw('rgba8')
      if (raw.width !== fitted.width || raw.height !== fitted.height) {
        throw new Error('The decoded image does not match the requested dimensions.')
      }
      const padded = new Uint8Array(maximum.width * maximum.height * 4)
      const offsetX = Math.floor((maximum.width - fitted.width) / 2)
      const offsetY = Math.floor((maximum.height - fitted.height) / 2)
      for (let row = 0; row < fitted.height; row += 1) {
        padded.set(
          raw.data.subarray(row * raw.stride, row * raw.stride + fitted.width * 4),
          ((offsetY + row) * maximum.width + offsetX) * 4,
        )
      }
      const data = new Uint8Array(padded.byteLength)
      compositeRgbaInto(padded, data, background)
      return { width: maximum.width, height: maximum.height, data } satisfies RgbaFrame
    } finally {
      resized.dispose()
    }
  } finally {
    image.dispose()
  }
}

export function PixelRenderer({ uri, width = 'auto', height = 'auto', children }: PixelRendererProps) {
  const surfaceRef = useRef<BoxRenderable | null>(null)
  const frameRef = useRef<RgbaFrame | undefined>(undefined)
  const [container, setContainer] = useState<Dimensions>({ width: 0, height: 0 })
  const [error, setError] = useState('')
  const themeColor = getTermweaveConfig().themeColor

  const requestRender = () => {
    const surface = surfaceRef.current
    if (surface && !surface.isDestroyed) surface.requestRender()
  }

  const measure = () => {
    const surface = surfaceRef.current
    if (!surface) return
    const next = {
      width: Math.max(0, Math.floor(surface.width)),
      height: Math.max(0, Math.floor(surface.height)),
    }
    setContainer((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    )
  }

  useEffect(() => {
    measure()
  }, [])

  useEffect(() => {
    if (container.width === 0 || container.height === 0) return
    let cancelled = false
    const background = parseHexRgb(themeColor)

    loadQuantizedFrame(uri, container, background)
      .then((frame) => {
        if (cancelled) return
        frameRef.current = frame
        setError('')
        requestRender()
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        frameRef.current = undefined
        setError(formatPixelRendererError(loadError))
        requestRender()
      })

    return () => {
      cancelled = true
    }
  }, [uri, container.width, container.height, themeColor])

  return (
    <box
      ref={surfaceRef}
      width={width}
      height={height}
      flexGrow={width === 'auto' && height === 'auto' ? 1 : 0}
      backgroundColor={themeColor}
      overflow="hidden"
      onSizeChange={measure}
      renderAfter={(buffer) => {
        const surface = surfaceRef.current
        const frame = frameRef.current
        if (!surface || !frame) return
        try {
          drawPixelFrameToBuffer(buffer, surface, container, frame)
        } catch (drawError) {
          frameRef.current = undefined
          queueMicrotask(() => setError(formatPixelRendererError(drawError)))
        }
      }}
    >
      {error !== '' && (
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
          <text fg={PIXEL_RENDERER_ERROR_FOREGROUND_COLOR}>PixelRenderer: {error}</text>
        </box>
      )}

      {children}
    </box>
  )
}
