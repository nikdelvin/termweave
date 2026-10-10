import { distance2, dither, mul2, rotate, scale2, smoothstep, spherify } from '../glsl'
import type { Rgba } from '../color'
import { createCircleNoise, createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createGasLayers(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const circleNoise = createCircleNoise(hash)
  const scroll = time * timeSpeed
  const turbulence = (uv: readonly [number, number]) => {
    let cNoise = 0
    for (let i = 0; i < 10; i += 1) {
      cNoise += circleNoise([
        uv[0] * p.size * 0.3 + (i + 1) + 10 + scroll,
        uv[1] * p.size * 0.3 + (i + 1) + 10,
      ])
    }
    return cNoise
  }
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const lightD = distance2(uv, p.lightOrigin)
    const dith = dither(uv, uvReal, p.pixels)
    const a = distance2(uv, [0.5, 0.5]) <= 0.49999 ? 1 : 0
    const mapped = spherify(rotate(uv, p.rotation))
    const band = fbm([0, mapped[1] * p.size * (p.bands ?? 1)])
    const turb = turbulence(mapped)
    const fbm1 = fbm(scale2(mapped, p.size))
    const scaled = scale2(mul2(mapped, [1, 2]), p.size)
    const fbm2Base: readonly [number, number] = [
      scaled[0] + fbm1 + turb - scroll,
      scaled[1] + fbm1 + turb,
    ]
    let fbm2 = fbm(fbm2Base)
    fbm2 *= band ** 2 * 7
    const light = fbm2 + lightD * 1.8
    fbm2 += lightD - 0.3
    fbm2 = smoothstep(-0.2, 4 - fbm2, light)
    if (dith && (p.shouldDither ?? true)) {
      fbm2 *= 1.1
    }
    const nColors = p.nColors ?? 3
    const posterized = Math.floor(fbm2 * 4) / 2
    let col: Rgba = [0, 0, 0, 1]
    if (fbm2 < 0.625) {
      const index = Math.min(nColors - 1, Math.max(0, Math.floor(posterized * (nColors - 1))))
      col = p.colors[index]!
    } else {
      const index = Math.min(nColors - 1, Math.max(0, Math.floor((posterized - 1) * (nColors - 1))))
      col = (p.darkColors ?? p.colors)[index]!
    }
    return [col[0], col[1], col[2], a * col[3]]
  }
}
