import { add2, distance2, dither, mul2, rotate, scale2, spherify, sub2 } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createLandRivers(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const scroll = time * timeSpeed
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dith = dither(uv, uvReal, p.pixels)
    const a = distance2(uv, [0.5, 0.5]) <= 0.49999 ? 1 : 0
    const sphereUv = spherify(uv)
    let dLight = distance2(sphereUv, p.lightOrigin)
    const mapped = rotate(sphereUv, p.rotation)
    const baseFbmUv = add2(scale2(mapped, p.size), [scroll, 0])
    const fbm1 = fbm(baseFbmUv)
    const fbm2 = fbm(sub2(baseFbmUv, mul2(p.lightOrigin, [fbm1, fbm1])))
    const fbm3 = fbm(sub2(baseFbmUv, mul2(p.lightOrigin, [fbm1 * 1.5, fbm1 * 1.5])))
    const fbm4 = fbm(sub2(baseFbmUv, mul2(p.lightOrigin, [fbm1 * 2, fbm1 * 2])))
    let river = fbm(add2(baseFbmUv, [fbm1 * 6, fbm1 * 6]))
    river = river >= (p.riverCutoff ?? 0) ? 1 : 0
    const ditherBorder = (1 / p.pixels) * (p.ditherSize ?? 2)
    const border1 = p.lightBorder1 ?? 0.4
    const border2 = p.lightBorder2 ?? 0.5
    const shouldDither = p.shouldDither ?? true
    let f2 = fbm2
    let f3 = fbm3
    let f4 = fbm4
    if (dLight < border1) {
      f4 *= 0.9
    }
    if (dLight > border1) {
      f2 *= 1.05
      f3 *= 1.05
      f4 *= 1.05
    }
    if (dLight > border2) {
      f2 *= 1.3
      f3 *= 1.4
      f4 *= 1.8
      if (dLight < border2 + ditherBorder && (dith || !shouldDither)) {
        f4 *= 0.5
      }
    }
    dLight = dLight ** 2 * 0.4
    let col = p.colors[3]!
    if (f4 + dLight < fbm1 * 1.5) {
      col = p.colors[2]!
    }
    if (f3 + dLight < fbm1) {
      col = p.colors[1]!
    }
    if (f2 + dLight < fbm1) {
      col = p.colors[0]!
    }
    if (river < fbm1 * 0.5) {
      col = p.colors[5]!
      if (f4 + dLight < fbm1 * 1.5) {
        col = p.colors[4]!
      }
    }
    return [col[0], col[1], col[2], a * col[3]]
  }
}
