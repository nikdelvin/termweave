import { add2, distance2, dither, rotate, scale2 } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createNoAtmosphere(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 1 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dCircle = distance2(uv, [0.5, 0.5])
    let dLight = distance2(uv, p.lightOrigin)
    const a = dCircle <= 0.49999 ? 1 : 0
    const dith = dither(uv, uvReal, p.pixels)
    const rotated = rotate(uv, p.rotation)
    const fbm1 = fbm(rotated)
    const scrolled = add2(
      add2(scale2(rotated, p.size), [fbm1, fbm1]),
      [scroll, 0],
    )
    dLight += fbm(scrolled) * 0.3
    const ditherBorder = (1 / p.pixels) * (p.ditherSize ?? 2)
    const shouldDither = p.shouldDither ?? true
    let col = p.colors[0]!
    if (dLight > (p.lightBorder1 ?? 0.4)) {
      col = p.colors[1]!
      if (dLight < (p.lightBorder1 ?? 0.4) + ditherBorder && (dith || !shouldDither)) {
        col = p.colors[0]!
      }
    }
    if (dLight > (p.lightBorder2 ?? 0.6)) {
      col = p.colors[2]!
      if (dLight < (p.lightBorder2 ?? 0.6) + ditherBorder && (dith || !shouldDither)) {
        col = p.colors[1]!
      }
    }
    return [col[0], col[1], col[2], a * col[3]]
  }
}
