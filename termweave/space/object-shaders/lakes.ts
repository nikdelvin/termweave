import { add2, distance2, rotate, scale2, spherify } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createLakes(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2, multiplier: 43758.5453 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    let dLight = distance2(uv, p.lightOrigin)
    const tilted = rotate(uv, p.rotation)
    const dCircle = distance2(tilted, [0.5, 0.5])
    const mapped = spherify(tilted)
    const scrolled = add2(scale2(mapped, p.size), [scroll, 0])
    const lake = fbm(scrolled)
    dLight = dLight ** 2 * 0.4
    dLight -= dLight * lake
    let col = p.colors[0]!
    if (dLight > (p.lightBorder1 ?? 0.4)) {
      col = p.colors[1]!
    }
    if (dLight > (p.lightBorder2 ?? 0.5)) {
      col = p.colors[2]!
    }
    const lakeCutoff = p.lakeCutoff ?? 0
    let a = lake >= lakeCutoff ? 1 : 0
    a *= dCircle <= 0.5 ? 1 : 0
    return [col[0], col[1], col[2], a * col[3]]
  }
}
