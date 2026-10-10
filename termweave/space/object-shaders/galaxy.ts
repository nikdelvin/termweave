import { distance2, dither, rotate } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createGalaxy(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 0 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const spin = time * timeSpeed
  const tilt = p.tilt ?? 4
  const nLayers = p.nLayers ?? 4
  const layerHeight = p.layerHeight ?? 0.4
  const zoom = p.zoom ?? 2
  const swirl = p.swirl ?? -9
  const nColors = p.nColors ?? 6
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dith = dither(uv, uvReal, p.pixels)
    let zoomed = [uv[0] * zoom - (zoom - 1) / 2, uv[1] * zoom - (zoom - 1) / 2] as const
    zoomed = rotate(zoomed, p.rotation)
    let uv2 = zoomed
    let layered = [zoomed[0], zoomed[1] * tilt - (tilt - 1) / 2] as const
    const dToCenter = distance2(layered, [0.5, 0.5])
    const rot = swirl * dToCenter ** 0.4
    const rotatedUv = rotate(layered, rot + spin)
    let f1 = fbm([rotatedUv[0] * p.size, rotatedUv[1] * p.size])
    f1 = Math.floor(f1 * nLayers) / nLayers
    uv2 = [uv2[0], uv2[1] * tilt - (tilt - 1) / 2 + f1 * layerHeight]
    const dToCenter2 = distance2(uv2, [0.5, 0.5])
    const rot2 = swirl * dToCenter2 ** 0.4
    const rotatedUv2 = rotate(uv2, rot2 + spin)
    let f2 = fbm([rotatedUv2[0] * p.size + f1 * 10, rotatedUv2[1] * p.size + f1 * 10])
    const a = f2 + dToCenter2 <= 0.7 ? 1 : 0
    f2 *= 2.3
    if ((p.shouldDither ?? true) && dith) {
      f2 *= 0.94
    }
    f2 = Math.floor(f2 * nColors)
    f2 = Math.min(f2, nColors)
    const col = p.colors[Math.min(p.colors.length - 1, Math.max(0, f2))]!
    return [col[0], col[1], col[2], a * col[3]]
  }
}
