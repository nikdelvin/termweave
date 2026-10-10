import { add2, distance2, rotate, scale2, spherify } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createLavaRivers(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    let dLight = distance2(uv, p.lightOrigin)
    const dCircle = distance2(uv, [0.5, 0.5])
    let a = dCircle <= 0.49999 ? 1 : 0
    const mapped = spherify(rotate(uv, p.rotation))
    const scrolled = add2(scale2(mapped, p.size), [scroll, 0])
    const fbm1 = fbm(scrolled)
    let river = fbm([mapped[0] + fbm1 * 2.5, mapped[1] + fbm1 * 2.5])
    dLight = dLight ** 2 * 0.4
    dLight -= dLight * river
    river = river >= (p.riverCutoff ?? 0) ? 1 : 0
    let col = p.colors[0]!
    if (dLight > (p.lightBorder1 ?? 0.4)) {
      col = p.colors[1]!
    }
    if (dLight > (p.lightBorder2 ?? 0.5)) {
      col = p.colors[2]!
    }
    a *= river
    return [col[0], col[1], col[2], a * col[3]]
  }
}
