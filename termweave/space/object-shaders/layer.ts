import type { Rgba } from '../color'
import type { Vec2 } from '../glsl'
import { blendPixel, type FrameBuffer } from '../pixels'

export interface LayerParams {
  pixels: number
  rotation: number
  lightOrigin: Vec2
  size: number
  seed: number
  octaves: number
  shouldDither?: boolean
  ditherSize?: number
  lightBorder1?: number
  lightBorder2?: number
  lightBorder?: number
  colors: Rgba[]
  darkColors?: Rgba[]
  nColors?: number
  cloudCover?: number
  stretch?: number
  cloudCurve?: number
  bands?: number
  landCutoff?: number
  riverCutoff?: number
  lakeCutoff?: number
  lightDistance1?: number
  lightDistance2?: number
  ringWidth?: number
  ringPerspective?: number
  scaleRelToPlanet?: number
  diskWidth?: number
  radius?: number
  lightWidth?: number
  tilt?: number
  nLayers?: number
  layerHeight?: number
  zoom?: number
  swirl?: number
  tiles?: number
  circleAmount?: number
  circleSize?: number
  circleScale?: number
  stormWidth?: number
  stormDitherWidth?: number
  scale?: number
}

export type LayerPixelFn = (uv: Vec2) => Rgba

interface LayerRect {
  x: number
  y: number
  width: number
  height: number
}

export function pixelize(uv: Vec2, pixels: number): Vec2 {
  return [Math.floor(uv[0] * pixels) / pixels, Math.floor(uv[1] * pixels) / pixels]
}

export function renderLayer(buffer: FrameBuffer, rect: LayerRect, pixel: LayerPixelFn) {
  const startX = Math.max(0, Math.floor(rect.x))
  const startY = Math.max(0, Math.floor(rect.y))
  const endX = Math.min(buffer.width, Math.ceil(rect.x + rect.width))
  const endY = Math.min(buffer.height, Math.ceil(rect.y + rect.height))
  for (let y = startY; y < endY; y += 1) {
    const v = (y - rect.y) / rect.height
    for (let x = startX; x < endX; x += 1) {
      const u = (x - rect.x) / rect.width
      blendPixel(buffer, x, y, pixel([u, v]))
    }
  }
}
