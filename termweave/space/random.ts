import { SPACE_OBJECT_TYPES, type SpaceObjectConfig } from './space-objects'
import { REALISTIC_PALETTES } from './palettes'

export function randomSpaceObjectConfig(seed: number): SpaceObjectConfig {
  const rng = createRng(seed)
  const type = SPACE_OBJECT_TYPES[rng.randi() % SPACE_OBJECT_TYPES.length]!
  const palettes = REALISTIC_PALETTES[type]
  const palette = palettes[rng.randi() % palettes.length]!.name
  return { type, seed, palette }
}

export interface SeededRng {
  randi(): number
  randf(): number
  randfRange(from: number, to: number): number
}

export function createRng(seed: number): SeededRng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    randi: () => Math.floor(next() * 2147483647),
    randf: next,
    randfRange: (from: number, to: number) => from + next() * (to - from),
  }
}
