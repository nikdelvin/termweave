import { add2, distance2, mul2, rotate, scale2, spherify, sub2 } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createPlanetLandmass(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dLight = distance2(uv, p.lightOrigin)
    const a = distance2(uv, [0.5, 0.5]) <= 0.49999 ? 1 : 0
    const mapped = spherify(rotate(uv, p.rotation))
    const baseFbmUv = add2(scale2(mapped, p.size), [scroll, 0])
    const fbm1 = fbm(baseFbmUv)
    const fbm2 = fbm(sub2(baseFbmUv, mul2(p.lightOrigin, [fbm1, fbm1])))
    const fbm3 = fbm(sub2(baseFbmUv, mul2(p.lightOrigin, [fbm1 * 1.5, fbm1 * 1.5])))
    const fbm4 = fbm(sub2(baseFbmUv, mul2(p.lightOrigin, [fbm1 * 2, fbm1 * 2])))
    let f2 = fbm2
    let f3 = fbm3
    let f4 = fbm4
    if (dLight < (p.lightBorder1 ?? 0.4)) {
      f4 *= 0.9
    }
    if (dLight > (p.lightBorder1 ?? 0.4)) {
      f2 *= 1.05
      f3 *= 1.05
      f4 *= 1.05
    }
    if (dLight > (p.lightBorder2 ?? 0.5)) {
      f2 *= 1.3
      f3 *= 1.4
      f4 *= 1.8
    }
    const light = dLight ** 2 * 0.1
    let col = p.colors[3]!
    if (f4 + light < fbm1) {
      col = p.colors[2]!
    }
    if (f3 + light < fbm1) {
      col = p.colors[1]!
    }
    if (f2 + light < fbm1) {
      col = p.colors[0]!
    }
    const landCutoff = p.landCutoff ?? 0
    return [col[0], col[1], col[2], (fbm1 >= landCutoff ? 1 : 0) * a * col[3]]
  }
}
