import { distance2, dither, rotate, atan2, type Vec2 } from '../glsl'
import { createFbm, createPlanetHash, createStarCircle, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createStarFlares(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 1 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const circle = createStarCircle(hash, p.circleAmount ?? 5, p.circleScale ?? 1)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const pixelized = pixelize(uvReal, p.pixels)
    const dith = dither(uvReal, pixelized, p.pixels)
    const uv = rotate(pixelized, p.rotation)
    const angle = atan2(uv[0] - 0.5, uv[1] - 0.5) * 0.4
    const d = distance2(pixelized, [0.5, 0.5])
    const circleUv: Vec2 = [d, angle]
    const n = fbm([circleUv[0] * p.size - scroll, circleUv[1] * p.size - scroll])
    const scale = p.scale ?? 1
    const circleOffset = scroll - n
    let nc = circle([circleUv[0] * scale - circleOffset, circleUv[1] * scale - circleOffset])
    nc *= 1.5
    const n2 = fbm([circleUv[0] * p.size - time + 100, circleUv[1] * p.size - time + 100])
    nc -= n2 * 0.1
    let a = 0
    const stormWidth = p.stormWidth ?? 0.3
    const stormDitherWidth = p.stormDitherWidth ?? 0.07
    if (1 - d > nc) {
      if (nc > stormWidth - stormDitherWidth + d && (dith || !(p.shouldDither ?? true))) {
        a = 1
      } else if (nc > stormWidth + d) {
        a = 1
      }
    }
    const interpolate = Math.floor(n2 + nc)
    const col = p.colors[Math.min(p.colors.length - 1, Math.max(0, interpolate))]!
    a *= d >= n2 * 0.25 ? 1 : 0
    return [col[0], col[1], col[2], a * col[3]]
  }
}
