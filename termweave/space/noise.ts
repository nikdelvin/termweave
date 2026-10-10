import { fract, glslMod, smoothstep, type Vec2 } from './glsl'

export type HashFn = (coord: Vec2) => number

interface PlanetHashOptions {
  tileX?: 0 | 1 | 2
  multiplier?: number
}

export function createPlanetHash(seed: number, size: number, options: PlanetHashOptions = {}): HashFn {
  const tileX = options.tileX ?? 1
  const multiplier = options.multiplier ?? 15.5453
  const tileWidth = tileX * Math.round(size)
  const tileHeight = Math.round(size)
  return (coord) => {
    const x = tileX === 0 ? coord[0] : glslMod(coord[0], tileWidth)
    const y = tileX === 0 ? coord[1] : glslMod(coord[1], tileHeight)
    return fract(Math.sin(x * 12.9898 + y * 78.233) * multiplier * seed)
  }
}

export function createBackgroundHash(
  seed: number,
  shouldTile: boolean,
  uvCorrect: Vec2,
): (coord: Vec2, tilesize: number) => number {
  return (coord, tilesize) => {
    let x = coord[0]
    let y = coord[1]
    if (shouldTile) {
      x = glslMod(x / uvCorrect[0], tilesize)
      y = glslMod(y / uvCorrect[1], tilesize)
    }
    return fract(Math.sin(x * 12.9898 + y * 78.233) * (15.5453 + seed))
  }
}

type NoiseFn = (coord: Vec2) => number

export function createValueNoise(hash: HashFn): NoiseFn {
  return (coord) => {
    const ix = Math.floor(coord[0])
    const iy = Math.floor(coord[1])
    const fx = coord[0] - ix
    const fy = coord[1] - iy
    const a = hash([ix, iy])
    const b = hash([ix + 1, iy])
    const c = hash([ix, iy + 1])
    const d = hash([ix + 1, iy + 1])
    const cubicX = fx * fx * (3 - 2 * fx)
    const cubicY = fy * fy * (3 - 2 * fy)
    return (
      a * (1 - cubicX) +
      b * cubicX +
      (c - a) * cubicY * (1 - cubicX) +
      (d - b) * cubicX * cubicY
    )
  }
}

export function createFbm(noise: NoiseFn, octaves: number): NoiseFn {
  return (coord) => {
    let value = 0
    let scale = 0.5
    let x = coord[0]
    let y = coord[1]
    for (let i = 0; i < octaves; i += 1) {
      value += noise([x, y]) * scale
      x *= 2
      y *= 2
      scale *= 0.5
    }
    return value
  }
}

export function createCircleNoise(hash: HashFn): (uv: Vec2) => number {
  return (uv) => {
    const uvY = Math.floor(uv[1])
    const x = uv[0] + uvY * 0.31
    const f: Vec2 = [fract(x), fract(uv[1])]
    const h = hash([Math.floor(x), uvY])
    const s = 0.25 + h * 0.5
    const m = Math.hypot(f[0] - s, f[1] - s)
    const r = h * 0.25
    return smoothstep(0, r, m * 0.75)
  }
}

export function createCraterCircleNoise(hash: HashFn): (uv: Vec2) => number {
  return (uv) => {
    const uvY = Math.floor(uv[1])
    const x = uv[0] + uvY * 0.31
    const f: Vec2 = [fract(x), fract(uv[1])]
    const h = hash([Math.floor(x), uvY])
    const s = 0.25 + h * 0.5
    const m = Math.hypot(f[0] - s, f[1] - s)
    const r = h * 0.25
    return smoothstep(r - 0.1 * r, r, m)
  }
}

export function cellsNoise(p: Vec2, numCells: number, tiles: number, hash2: (p: Vec2) => Vec2): number {
  const px = p[0] * numCells
  const py = p[1] * numCells
  let d = 1.0e10
  for (let xo = -1; xo <= 1; xo += 1) {
    for (let yo = -1; yo <= 1; yo += 1) {
      const tx = Math.floor(px) + xo
      const ty = Math.floor(py) + yo
      const wrapped: Vec2 = [glslMod(tx, numCells / tiles), glslMod(ty, numCells / tiles)]
      const h = hash2(wrapped)
      const vx = px - tx - h[0]
      const vy = py - ty - h[1]
      d = Math.min(d, vx * vx + vy * vy)
    }
  }
  return Math.sqrt(d)
}

export function starHash2(p: Vec2): Vec2 {
  const r = 523.0 * Math.sin(p[0] * 53.3158 + p[1] * 43.6143)
  return [fract(15.32354 * r), fract(17.25865 * r)]
}

export function createStarCircle(hash: HashFn, circleAmount: number, sizeScale: number) {
  return (uv: Vec2): number => {
    const invert = 1 / circleAmount
    const x = glslMod(uv[1], invert * 2) < invert ? uv[0] + invert * 0.5 : uv[0]
    const randCoord: Vec2 = [
      Math.floor(x * circleAmount) / circleAmount,
      Math.floor(uv[1] * circleAmount) / circleAmount,
    ]
    const local: Vec2 = [glslMod(x, invert) * circleAmount, glslMod(uv[1], invert) * circleAmount]
    let r = hash(randCoord)
    r = Math.min(1 - invert, Math.max(invert, r))
    const d = Math.hypot(local[0] - r, local[1] - r)
    return smoothstep(d, d + 0.5, invert * sizeScale * hash([randCoord[0] * 1.5, randCoord[1] * 1.5]))
  }
}
