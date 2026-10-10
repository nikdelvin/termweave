import { add2, distance2, dither, rotate, scale2, spherify } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createPlanetUnder(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dith = dither(uv, uvReal, p.pixels)
    const dLight = distance2(uv, p.lightOrigin)
    const a = distance2(uv, [0.5, 0.5]) <= 0.49999 ? 1 : 0
    const mapped = rotate(spherify(uv), p.rotation)
    const shifted = add2(scale2(mapped, p.size), [scroll, 0])
    const light = dLight + fbm(shifted) * 0.3
    const ditherBorder = (1 / p.pixels) * (p.ditherSize ?? 2)
    const shouldDither = p.shouldDither ?? true
    let col = p.colors[0]!
    if (light > (p.lightBorder1 ?? 0.4)) {
      col = p.colors[1]!
      if (light < (p.lightBorder1 ?? 0.4) + ditherBorder && (dith || !shouldDither)) {
        col = p.colors[0]!
      }
    }
    if (light > (p.lightBorder2 ?? 0.6)) {
      col = p.colors[2]!
      if (light < (p.lightBorder2 ?? 0.6) + ditherBorder && (dith || !shouldDither)) {
        col = p.colors[1]!
      }
    }
    return [col[0], col[1], col[2], a * col[3]]
  }
}
