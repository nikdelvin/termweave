/** @jsxImportSource @opentui/react */
import { RGBA, type BoxRenderable, type OptimizedBuffer, type RenderableOptions } from '@opentui/core'
import { extend } from '@opentui/react'
import { ThreeRenderable, type SuperSampleType, type ThreeCliRenderer, type ThreeRenderableOptions } from '@opentui/three'
import { OrthographicCamera, PerspectiveCamera, type Scene } from 'three'
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { parseHexRgb } from '../color'
import { getTermweaveConfig } from '../config'
import { TERMINAL_GRID, TERMINAL_SURFACE } from '../constants'
import { errorMessage } from '../error-message'
import { quantizeBufferRegion } from './buffer-palette'

const ERROR_LENGTH = 220
const DEFAULT_FOCAL_LENGTH = 60

type ThreeRendererDimension = NonNullable<RenderableOptions['width']>
export type ThreePalette = 'rgb332' | 'full'
export type ThreeSuperSample = 'none' | 'gpu' | 'cpu'

export interface ThreeRendererProps {
  scene: Scene
  camera?: PerspectiveCamera | OrthographicCamera
  width?: ThreeRendererDimension
  height?: ThreeRendererDimension
  focalLength?: number
  superSample?: ThreeSuperSample
  alpha?: boolean
  palette?: ThreePalette
  live?: boolean
  onReady?: (renderable: ThreeRenderableAdapter) => void
  onError?: (message: string) => void
  children?: ReactNode
}

interface Dimensions {
  width: number
  height: number
}

export class ThreeRenderableAdapter extends ThreeRenderable {
  override get renderer(): ThreeCliRenderer {
    return super.renderer
  }
  override set renderer(_value: ThreeCliRenderer) {}
}

let catalogueExtended = false
function ensureCatalogue() {
  if (catalogueExtended) return
  extend({ three: ThreeRenderableAdapter })
  catalogueExtended = true
}

type ThreeElementProps = ThreeRenderableOptions & {
  ref?: React.Ref<ThreeRenderableAdapter>
}
type FrameBufferCarrier = { frameBuffer?: OptimizedBuffer | null }

export function formatThreeRendererError(error: unknown) {
  const normalized = errorMessage(error).trim().replaceAll(/\s+/g, ' ')
  const message = normalized || 'Unknown three.js error.'
  return message.length <= ERROR_LENGTH ? message : `${message.slice(0, ERROR_LENGTH - 1)}…`
}

function cellPixelAspect() {
  const cellWidth = TERMINAL_SURFACE.width / TERMINAL_GRID.cols
  const cellHeight = TERMINAL_SURFACE.height / TERMINAL_GRID.rows
  return cellWidth / cellHeight
}

function applyCameraAspect(camera: PerspectiveCamera | OrthographicCamera, container: Dimensions) {
  if (!(camera instanceof PerspectiveCamera)) return
  if (container.width <= 0 || container.height <= 0) return
  const aspect = (container.width * cellPixelAspect()) / container.height
  if (camera.aspect === aspect) return
  camera.aspect = aspect
  camera.updateProjectionMatrix()
}

export function ThreeRenderer({
  scene,
  camera,
  width = 'auto',
  height = 'auto',
  focalLength,
  superSample = 'gpu',
  alpha = true,
  palette = 'rgb332',
  live = true,
  onReady,
  onError,
  children,
}: ThreeRendererProps) {
  ensureCatalogue()
  const surfaceRef = useRef<BoxRenderable | null>(null)
  const threeRef = useRef<ThreeRenderableAdapter | null>(null)
  const [container, setContainer] = useState<Dimensions>({ width: 0, height: 0 })
  const themeColor = getTermweaveConfig().themeColor
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const measure = useCallback(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const next = {
      width: Math.max(0, Math.floor(surface.width)),
      height: Math.max(0, Math.floor(surface.height)),
    }
    setContainer((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    )
  }, [])

  const requestRender = () => {
    const renderable = threeRef.current
    if (renderable && !renderable.isDestroyed) renderable.requestRender()
  }

  const handleRenderAfter = useCallback(
    (buffer: OptimizedBuffer) => {
      const renderable = threeRef.current
      if (!renderable || renderable.isDestroyed) return
      const carrier = renderable as unknown as FrameBufferCarrier
      if (carrier.frameBuffer !== buffer) return
      if (palette !== 'rgb332') return
      try {
        quantizeBufferRegion(buffer, 0, 0, buffer.width, buffer.height)
      } catch (quantizeError) {
        const message = formatThreeRendererError(quantizeError)
        queueMicrotask(() => onErrorRef.current?.(message))
      }
    },
    [palette],
  )

  const engineOptions = useMemo(() => {
    const [red, green, blue] = parseHexRgb(themeColor)
    const resolvedFocalLength = focalLength ?? (camera ? undefined : DEFAULT_FOCAL_LENGTH)
    return {
      superSample: superSample as SuperSampleType,
      alpha,
      backgroundColor: RGBA.fromInts(red, green, blue, 255),
      ...(resolvedFocalLength !== undefined ? { focalLength: resolvedFocalLength } : {}),
    }
  }, [themeColor, superSample, alpha, focalLength, camera])

  useEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const renderable = threeRef.current
    if (!renderable) return
    onReady?.(renderable)
  }, [onReady])

  useEffect(() => {
    const renderable = threeRef.current
    if (!renderable || renderable.isDestroyed) return
    renderable.setScene(scene)
  }, [scene])

  useEffect(() => {
    const renderable = threeRef.current
    if (!renderable || renderable.isDestroyed) return
    if (camera) renderable.setActiveCamera(camera)
    applyCameraAspect(camera ?? renderable.getActiveCamera(), container)
    requestRender()
  }, [camera, container.width, container.height])

  return (
    <box
      ref={surfaceRef}
      width={width}
      height={height}
      flexGrow={width === 'auto' && height === 'auto' ? 1 : 0}
      backgroundColor={themeColor}
      overflow="hidden"
      onSizeChange={measure}
    >
      {createElement<ThreeElementProps>('three', {
        ref: threeRef,
        scene,
        camera,
        width: '100%',
        height: '100%',
        autoAspect: false,
        renderer: engineOptions,
        live,
        renderAfter: handleRenderAfter,
      })}
      {children}
    </box>
  )
}
