import { distance2, dither, rotate, spherify } from '../glsl'
import { cellsNoise, starHash2 } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createStar(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const tiles = p.tiles ?? 1
  const nColors = p.nColors ?? p.colors.length
  const scroll = time * timeSpeed
  const scrollFast = scroll * 2
  return (uvReal) => {
    const pixelized = pixelize(uvReal, p.pixels)
    const a = distance2(pixelized, [0.5, 0.5]) <= 0.49999 ? 1 : 0
    const dith = dither(uvReal, pixelized, p.pixels)
    let mapped = rotate(pixelized, p.rotation)
    mapped = spherify(mapped)
    let n = cellsNoise([mapped[0] - scrollFast, mapped[1]], 10, tiles, starHash2)
    n *= cellsNoise([mapped[0] - scroll, mapped[1]], 20, tiles, starHash2)
    n *= 2
    n = Math.min(1, Math.max(0, n))
    if (dith || !(p.shouldDither ?? true)) {
      n *= 1.3
    }
    const interpolate = Math.floor(n * (nColors - 1)) / (nColors - 1)
    const index = Math.min(nColors - 1, Math.max(0, Math.floor(interpolate * (nColors - 1))))
    const col = p.colors[index]!
    return [col[0], col[1], col[2], a * col[3]]
  }
}
