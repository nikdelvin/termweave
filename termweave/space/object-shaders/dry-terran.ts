import { add2, distance2, dither, rotate, scale2, smoothstep, spherify } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createDryTerran(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2, multiplier: 43758.5453 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dith = dither(uv, uvReal, p.pixels)
    const a = distance2(uv, [0.5, 0.5]) <= 0.49999 ? 1 : 0
    const mapped = spherify(uv)
    let dLight = distance2(mapped, p.lightOrigin)
    const rotated = rotate(mapped, p.rotation)
    const f = fbm(add2(scale2(rotated, p.size), [scroll, 0]))
    dLight = smoothstep(-0.3, 1.2, dLight)
    if (dLight < (p.lightDistance1 ?? 0.5)) {
      dLight *= 0.9
    }
    if (dLight < (p.lightDistance2 ?? 0.75)) {
      dLight *= 0.9
    }
    let c = dLight * f ** 0.8 * 3.5
    if (dith || !(p.shouldDither ?? true)) {
      c += 0.02
      c *= 1.05
    }
    const nColors = p.nColors ?? p.colors.length
    let posterize = Math.floor(c * 4) / 4
    posterize = Math.min(posterize, 1)
    const index = Math.min(nColors - 1, Math.max(0, Math.floor(posterize * (nColors - 1))))
    const col = p.colors[index]!
    return [col[0], col[1], col[2], a * col[3]]
  }
}
