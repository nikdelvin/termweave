import { distance2 } from '../glsl'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createBlackHole(p: LayerParams, _time: number, _timeSpeed: number): LayerPixelFn {
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dToCenter = distance2(uv, [0.5, 0.5])
    const radius = p.radius ?? 0.5
    const lightWidth = p.lightWidth ?? 0.05
    let col = p.colors[0]!
    if (dToCenter > radius - lightWidth) {
      col = p.colors[1]!
    }
    if (dToCenter > radius - lightWidth * 0.5) {
      col = p.colors[2]!
    }
    const a = dToCenter <= radius ? 1 : 0
    return [col[0], col[1], col[2], a * col[3]]
  }
}
