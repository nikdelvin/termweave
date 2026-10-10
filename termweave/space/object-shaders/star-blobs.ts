import { distance2, rotate, atan2, type Vec2 } from '../glsl'
import { createPlanetHash, createStarCircle } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createStarBlobs(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 1 })
  const circle = createStarCircle(hash, p.circleAmount ?? 5, p.circleSize ?? 1)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const pixelized = pixelize(uvReal, p.pixels)
    const uv = rotate(pixelized, p.rotation)
    const angle = atan2(uv[0] - 0.5, uv[1] - 0.5)
    const d = distance2(pixelized, [0.5, 0.5])
    let c = 0
    for (let i = 0; i < 15; i += 1) {
      const r = hash([i, i])
      const circleUv: Vec2 = [d, angle]
      const offset = scroll + (1 / d) * 0.1
      c += circle([circleUv[0] * p.size - offset + r, circleUv[1] * p.size - offset + r])
    }
    c *= 0.37 - d
    const alpha = c - d >= 0.07 ? 1 : 0
    const col = p.colors[0]!
    return [col[0], col[1], col[2], alpha * col[3]]
  }
}
