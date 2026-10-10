import { distance2, dither, rotate, scale2 } from '../glsl'
import { createCraterCircleNoise, createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createAsteroids(p: LayerParams, _time: number, _timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 0 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const circleNoise = createCraterCircleNoise(hash)
  const crater = (uv: readonly [number, number]) => {
    let c = 1
    for (let i = 0; i < 2; i += 1) {
      c *= circleNoise([uv[0] * p.size + (i + 1) + 10, uv[1] * p.size + (i + 1) + 10])
    }
    return 1 - c
  }
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dith = dither(uv, uvReal, p.pixels)
    const d = distance2(uv, [0.5, 0.5])
    const rotated = rotate(uv, p.rotation)
    const scaled = scale2(rotated, p.size)
    const rotatedLight = rotate(p.lightOrigin, p.rotation)
    const n = fbm(scaled)
    const n2 = fbm([
      scaled[0] + (rotatedLight[0] - 0.5) * 0.5,
      scaled[1] + (rotatedLight[1] - 0.5) * 0.5,
    ])
    const nStep = n - d >= 0.2 ? 1 : 0
    const n2Step = n2 - d >= 0.2 ? 1 : 0
    const noiseRel = n2Step + n2 - (nStep + n)
    const c1 = crater(rotated)
    const c2 = crater([
      rotated[0] + (p.lightOrigin[0] - 0.5) * 0.03,
      rotated[1] + (p.lightOrigin[1] - 0.5) * 0.03,
    ])
    const shouldDither = p.shouldDither ?? true
    let col = p.colors[1]!
    if (noiseRel < -0.06 || (noiseRel < -0.04 && (dith || !shouldDither))) {
      col = p.colors[0]!
    }
    if (noiseRel > 0.05 || (noiseRel > 0.03 && (dith || !shouldDither))) {
      col = p.colors[2]!
    }
    if (c1 > 0.4) {
      col = p.colors[1]!
    }
    if (c2 < c1) {
      col = p.colors[2]!
    }
    return [col[0], col[1], col[2], nStep * col[3]]
  }
}
