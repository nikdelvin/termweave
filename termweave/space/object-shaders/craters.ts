import { add2, distance2, rotate, spherify } from '../glsl'
import { createCraterCircleNoise, createPlanetHash } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createCraters(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 1 })
  const circleNoise = createCraterCircleNoise(hash)
  const scroll = time * timeSpeed
  const crater = (uv: readonly [number, number]) => {
    let c = 1
    for (let i = 0; i < 2; i += 1) {
      c *= circleNoise([
        uv[0] * p.size + (i + 1) + 10 + scroll,
        uv[1] * p.size + (i + 1) + 10,
      ])
    }
    return 1 - c
  }
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dCircle = distance2(uv, [0.5, 0.5])
    const dLight = distance2(uv, p.lightOrigin)
    let a = dCircle <= 0.49999 ? 1 : 0
    const mapped = spherify(rotate(uv, p.rotation))
    const c1 = crater(mapped)
    const c2 = crater(add2(mapped, [(p.lightOrigin[0] - 0.5) * 0.03, (p.lightOrigin[1] - 0.5) * 0.03]))
    let col = p.colors[0]!
    a *= c1 >= 0.5 ? 1 : 0
    if (c2 < c1 - (0.5 - dLight) * 2) {
      col = p.colors[1]!
    }
    if (dLight > (p.lightBorder ?? 0.4)) {
      col = p.colors[1]!
    }
    a *= dCircle <= 0.5 ? 1 : 0
    return [col[0], col[1], col[2], a * col[3]]
  }
}
