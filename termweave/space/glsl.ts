export type Vec2 = readonly [x: number, y: number]

export function glslMod(x: number, y: number): number {
  return x - y * Math.floor(x / y)
}

export function fract(x: number): number {
  return x - Math.floor(x)
}

export function step(edge: number, x: number): number {
  return x < edge ? 0 : 1
}

export function clamp(x: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, x))
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function add2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]]
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]]
}

export function mul2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] * b[0], a[1] * b[1]]
}

export function scale2(a: Vec2, s: number): Vec2 {
  return [a[0] * s, a[1] * s]
}

export function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export function atan2(y: number, x: number): number {
  return Math.atan2(y, x)
}

export function rotate(coord: Vec2, angle: number): Vec2 {
  const x = coord[0] - 0.5
  const y = coord[1] - 0.5
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos - y * sin + 0.5, x * sin + y * cos + 0.5]
}

export function spherify(uv: Vec2): Vec2 {
  const centeredX = uv[0] * 2 - 1
  const centeredY = uv[1] * 2 - 1
  const z = Math.sqrt(Math.max(0, 1 - centeredX * centeredX - centeredY * centeredY))
  return [((centeredX / (z + 1)) * 0.5) + 0.5, ((centeredY / (z + 1)) * 0.5) + 0.5]
}

export function dither(uv1: Vec2, uv2: Vec2, pixels: number): boolean {
  return glslMod(uv1[0] + uv2[1], 2 / pixels) <= 1 / pixels
}
