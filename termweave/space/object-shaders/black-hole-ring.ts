import { distance2, dither, mul2, rotate, scale2, smoothstep } from '../glsl'
import { createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createBlackHoleRing(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 2 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const scroll = time * timeSpeed
  const wobble = Math.sin(scroll * 2) * 0.01
  const spin = scroll * 3
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dith = dither(uvReal, uv, p.pixels)
    let mapped = rotate(uv, p.rotation)
    const uv2 = mapped
    mapped = [(mapped[0] - 0.5) * 1.3 + 0.5, mapped[1]]
    mapped = rotate(mapped, wobble)
    let lOriginY = 0.5
    let dWidth = p.diskWidth ?? 0.1
    const centerDistance = () => distance2(mapped, [0.5, 0.5])
    if (mapped[1] < 0.5) {
      mapped = [mapped[0], mapped[1] + smoothstep(centerDistance(), 0.5, 0.2)]
      dWidth += smoothstep(centerDistance(), 0.5, 0.3)
      lOriginY -= smoothstep(centerDistance(), 0.5, 0.2)
    } else if (mapped[1] > 0.53) {
      mapped = [mapped[0], mapped[1] - smoothstep(centerDistance(), 0.4, 0.17)]
      dWidth += smoothstep(centerDistance(), 0.5, 0.2)
      lOriginY += smoothstep(centerDistance(), 0.5, 0.2)
    }
    const perspective = p.ringPerspective ?? 4
    const lightD = distance2(mul2(uv2, [1, perspective]), mul2([0.5, lOriginY], [1, perspective])) * 0.3
    let uvCenter = [mapped[0], mapped[1] - 0.5] as const
    uvCenter = [uvCenter[0], uvCenter[1] * perspective]
    const centerD = distance2(uvCenter, [0.5, 0])
    let disk = smoothstep(0.1 - dWidth * 2, 0.5 - dWidth, centerD)
    disk *= smoothstep(centerD - dWidth, centerD, 0.4)
    const spun = rotate([uvCenter[0], uvCenter[1] + 0.5], spin)
    disk *= fbm(scale2(spun, p.size)) ** 0.5
    if (dith || !(p.shouldDither ?? true)) {
      disk *= 1.2
    }
    const nPosterized = (p.nColors ?? p.colors.length) - 1
    let posterized = Math.floor((disk + lightD) * nPosterized)
    posterized = Math.min(posterized, nPosterized)
    const col = p.colors[Math.max(0, posterized)]!
    const diskA = disk >= 0.15 ? 1 : 0
    return [col[0], col[1], col[2], diskA * col[3]]
  }
}
