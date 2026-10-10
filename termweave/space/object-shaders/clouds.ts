import { add2, distance2, rotate, scale2, smoothstep, spherify, type Vec2 } from '../glsl'
import { createCircleNoise, createFbm, createPlanetHash, createValueNoise } from '../noise'
import { pixelize, type LayerParams, type LayerPixelFn } from './layer'

export function createClouds(p: LayerParams, time: number, timeSpeed: number): LayerPixelFn {
  const hash = createPlanetHash(p.seed, p.size, { tileX: 1 })
  const fbm = createFbm(createValueNoise(hash), p.octaves)
  const circleNoise = createCircleNoise(hash)
  const scroll = time * timeSpeed
  const cloudAlpha = (uv: Vec2) => {
    let cNoise = 0
    for (let i = 0; i < 9; i += 1) {
      const scaled = scale2(uv, p.size * 0.3)
      cNoise += circleNoise([
        scaled[0] + (i + 1) + 10 + scroll,
        scaled[1] + (i + 1) + 10,
      ])
    }
    const scrolled = add2(add2(scale2(uv, p.size), [cNoise, cNoise]), [scroll, 0])
    return fbm(scrolled)
  }
  return (uvReal) => {
    const uv = pixelize(uvReal, p.pixels)
    const dLight = distance2(uv, p.lightOrigin)
    const a = distance2(uv, [0.5, 0.5]) <= 0.49999 ? 1 : 0
    const dToCenter = distance2(uv, [0.5, 0.5])
    const mapped = spherify(rotate(uv, p.rotation))
    const curved: Vec2 = [mapped[0], mapped[1] + smoothstep(0, p.cloudCurve ?? 1.3, Math.abs(mapped[0] - 0.4))]
    const stretch = p.stretch ?? 2
    const c = cloudAlpha([curved[0], curved[1] * stretch])
    const cloudCover = p.cloudCover ?? 0
    let col = p.colors[0]!
    if (c < cloudCover + 0.03) {
      col = p.colors[1]!
    }
    if (dLight + c * 0.2 > (p.lightBorder1 ?? 0.52)) {
      col = p.colors[2]!
    }
    if (dLight + c * 0.2 > (p.lightBorder2 ?? 0.62)) {
      col = p.colors[3]!
    }
    const maskedC = c * (dToCenter <= 0.5 ? 1 : 0)
    return [col[0], col[1], col[2], (maskedC >= cloudCover ? 1 : 0) * a * col[3]]
  }
}
