import { distance2, rotate, scale2, smoothstep } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import type { Rgba } from '../color'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createRing(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const spin = time * timeSpeed
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const lightD = distance2(uv, p.lightOrigin)
    const rotated = rotate(uv, p.rotation)
    let uvCenter = [rotated[0], rotated[1] - 0.5] as const
    const perspective = p.ringPerspective ?? 4
    uvCenter = [uvCenter[0] * 1, uvCenter[1] * perspective]
    const centerD = distance2(uvCenter, [0.5, 0])
    const ringWidth = p.ringWidth ?? 0.1
    let ring = smoothstep(0.5 - ringWidth * 2, 0.5 - ringWidth, centerD)
    ring *= smoothstep(centerD - ringWidth, centerD, 0.4)
    if (rotated[1] < 0.5) {
      ring *= distance2(rotated, [0.5, 0.5]) >= 1 / (p.scaleRelToPlanet ?? 6) ? 1 : 0
    }
    const spun = rotate([uvCenter[0], uvCenter[1] + 0.5], spin)
    ring *= fbm(scale2(spun, p.size))
    let posterized = Math.floor((ring + lightD ** 2 * 2) * 4) / 4
    posterized = Math.min(posterized, 2)
    const nColors = p.nColors ?? 3
    let col: Rgba
    if (posterized <= 1) {
      const index = Math.min(nColors - 1, Math.max(0, Math.floor(posterized * (nColors - 1))))
      col = p.colors[index]!
    } else {
      const index = Math.min(nColors - 1, Math.max(0, Math.floor((posterized - 1) * (nColors - 1))))
      col = (p.darkColors ?? p.colors)[index]!
    }
    const ringA = ring >= 0.28 ? 1 : 0
    return [col[0], col[1], col[2], ringA * col[3]]
  }
}
