import { NativeImage } from '@opentui/core'
import { TERMINAL_GRID } from '../constants'
import { colorsFromPackedArray, type Rgba } from './color'
import { add2, glslMod, scale2, step, type Vec2 } from './glsl'
import { createBackgroundHash, createCircleNoise, createFbm, createValueNoise, type HashFn } from './noise'
import { createRng, type SeededRng } from './random'
import { blendPixel, createFrameBuffer, fillFrameBuffer, type FrameBuffer } from './pixels'
import starsAtlasPath from './assets/stars.png' with { type: 'file' }
import starsSpecialAtlasPath from './assets/stars-special.png' with { type: 'file' }

export const BACKGROUND_WIDTH = TERMINAL_GRID.cols * 2
export const BACKGROUND_HEIGHT = TERMINAL_GRID.rows * 2
const BACKGROUND_PALETTE = colorsFromPackedArray([
  0.0228, 0.0228, 0.04, 1, 0.0666667, 0.0666667, 0.121569, 1, 0.113725, 0.113725, 0.2, 1,
  0.152941, 0.152941, 0.266667, 1, 0.286275, 0.301961, 0.494118, 1, 0.545098, 0.427451,
  0.611765, 1, 0.776471, 0.623529, 0.647059, 1, 0.94902, 0.827451, 0.670588, 1, 0.984314,
  0.960784, 0.937255, 1,
])
export const BACKGROUND_FILL: Rgba = BACKGROUND_PALETTE[0]!
const BACKGROUND_RAMP: readonly Rgba[] = BACKGROUND_PALETTE.slice(1)
const DEFAULT_BACKGROUND_SEED = 4242
const SHOULD_TILE = false
const SHOULD_DITHER = false

interface Placement {
  x: number
  y: number
  frame: number
  colorIndex: number
}

interface BackgroundLayout {
  dustSeed: number
  particles: Placement[]
  bigStars: Placement[]
}

function sampleRamp(step: number): Rgba {
  const index = Math.min(7, Math.max(0, Math.round(step)))
  return BACKGROUND_RAMP[index]!
}

function generateLayout(rng: SeededRng): BackgroundLayout {
  const width = BACKGROUND_WIDTH
  const height = BACKGROUND_HEIGHT
  const dustSeed = rng.randfRange(1, 10)
  rng.randfRange(1, 10)
  const particleBudget = (width * height) / 150
  const particleCount =
    (rng.randi() % Math.trunc(particleBudget * 0.75)) + Math.trunc(particleBudget * 0.25)
  const particles: Placement[] = []
  for (let i = 0; i < particleCount; i += 1) {
    particles.push({
      x: rng.randfRange(0, width),
      y: rng.randfRange(0, height),
      frame: rng.randi() % 16,
      colorIndex: Math.floor(rng.randf() * 7),
    })
  }
  const starBudget = Math.max(Math.trunc(Math.max(width, height) / 20), 1)
  const bigStars: Placement[] = []
  for (let i = 0; i < rng.randi() % starBudget; i += 1) {
    bigStars.push({
      x: rng.randfRange(0, width),
      y: rng.randfRange(0, height),
      frame: rng.randi() % 5,
      colorIndex: 0,
    })
  }
  return { dustSeed, particles, bigStars }
}

function tileWrap(uv: Vec2, tilesize: number, divideUvCorrect: boolean, uvCorrect: Vec2): Vec2 {
  if (!divideUvCorrect) return [glslMod(uv[0], tilesize), glslMod(uv[1], tilesize)]
  return [
    glslMod(uv[0], tilesize / uvCorrect[0]),
    glslMod(uv[1], tilesize / uvCorrect[1]),
  ]
}

function renderDust(target: FrameBuffer, seed: number) {
  const size = 10
  const octaves = 8
  const uvCorrect: Vec2 = [BACKGROUND_WIDTH / BACKGROUND_HEIGHT, 1]
  const backgroundHash = createBackgroundHash(seed, SHOULD_TILE, uvCorrect)
  const hash5: HashFn = (coord) => backgroundHash(coord, Math.ceil(size * 0.5))
  const hash2: HashFn = (coord) => backgroundHash(coord, Math.ceil(size * 0.2))
  const hash10: HashFn = (coord) => backgroundHash(coord, size)
  const fbmAlpha = createFbm(createValueNoise(hash5), octaves)
  const fbmDust = createFbm(createValueNoise(hash10), octaves)
  const fbmDust2 = createFbm(createValueNoise(hash2), octaves)
  const circleNoise5 = createCircleNoise(hash5)
  const circleNoise5Wrapped = (uv: Vec2) =>
    circleNoise5(SHOULD_TILE ? tileWrap(uv, Math.ceil(size * 0.5), false, uvCorrect) : uv)
  const cloudAlpha = (uv: Vec2) => {
    let cNoise = 0
    for (let i = 0; i < 2; i += 1) {
      cNoise += circleNoise5Wrapped([uv[0] * 0.5 + (i + 1) - 0.3, uv[1] * 0.5 + (i + 1)])
    }
    return fbmDust(add2(uv, [cNoise, cNoise]))
  }
  const pixels = BACKGROUND_WIDTH
  const halfScale = Math.ceil(size * 0.5)
  const fifthScale = Math.ceil(size * 0.2)
  for (let y = 0; y < BACKGROUND_HEIGHT; y += 1) {
    for (let x = 0; x < BACKGROUND_WIDTH; x += 1) {
      const uvReal: Vec2 = [(x + 0.5) / BACKGROUND_WIDTH, (y + 0.5) / BACKGROUND_HEIGHT]
      const uv: Vec2 = [
        (Math.floor(uvReal[0] * pixels) / pixels) * uvCorrect[0],
        (Math.floor(uvReal[1] * pixels) / pixels) * uvCorrect[1],
      ]
      const dith = SHOULD_DITHER && glslMod(uv[1] + uvReal[0], 2 / pixels) <= 1 / pixels
      const alphaNoise = fbmAlpha([
        uv[0] * halfScale + 2,
        uv[1] * halfScale + 2,
      ])
      const dust = cloudAlpha(scale2(uv, size))
      const dust2 = fbmDust2([uv[0] * fifthScale - 2, uv[1] * fifthScale - 2])
      let lerp = dust2 * dust
      if (dith) {
        lerp *= 0.95
      }
      const alpha = step(alphaNoise, lerp * 1.8)
      lerp = Math.pow(lerp, 3.2) * 56
      if (dith) {
        lerp *= 1.1
      }
      lerp = Math.pow(lerp, 0.8) * 0.7
      const col = sampleRamp(Math.floor(lerp))
      blendPixel(target, x, y, [col[0], col[1], col[2], alpha])
    }
  }
}

interface SpriteFrame {
  width: number
  height: number
  data: Uint8Array
}

interface SpaceSprites {
  particleFrames: SpriteFrame[]
  bigStarFrames: SpriteFrame[]
}

let spritesPromise: Promise<SpaceSprites> | undefined

async function loadSpaceSprites(): Promise<SpaceSprites> {
  if (spritesPromise) return spritesPromise
  spritesPromise = (async () => {
    const decodeAtlas = async (path: string, frameW: number, frameH: number) => {
      const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
      const image = NativeImage.decode(bytes)
      try {
        const raw = image.raw('rgba8')
        const frames: SpriteFrame[] = []
        const columns = Math.trunc(raw.width / frameW)
        const rows = Math.trunc(raw.height / frameH)
        const rowPixels = raw.stride / 4
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const data = new Uint8Array(frameW * frameH * 4)
            for (let y = 0; y < frameH; y += 1) {
              const sourceOffset = (row * frameH + y) * rowPixels + column * frameW
              data.set(
                raw.data.subarray(sourceOffset * 4, (sourceOffset + frameW) * 4),
                y * frameW * 4,
              )
            }
            frames.push({ width: frameW, height: frameH, data })
          }
        }
        return frames
      } finally {
        image.dispose()
      }
    }
    const [particleFrames, bigStarFrames] = await Promise.all([
      decodeAtlas(starsAtlasPath, 9, 9),
      decodeAtlas(starsSpecialAtlasPath, 25, 25),
    ])
    return { particleFrames, bigStarFrames }
  })()
  return spritesPromise
}

function blitSprite(
  target: FrameBuffer,
  frame: SpriteFrame,
  centerX: number,
  centerY: number,
  tint?: Rgba,
) {
  const left = Math.floor(centerX - frame.width / 2)
  const top = Math.floor(centerY - frame.height / 2)
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const offset = (y * frame.width + x) * 4
      const r = frame.data[offset]! / 255
      const g = frame.data[offset + 1]! / 255
      const b = frame.data[offset + 2]! / 255
      const a = frame.data[offset + 3]! / 255
      let color: Rgba
      if (!tint) {
        const replaced = sampleRamp(Math.round(r * 7))
        color = [replaced[0], replaced[1], replaced[2], a]
      } else {
        color = [r * tint[0], g * tint[1], b * tint[2], a]
      }
      blendPixel(target, left + x, top + y, color)
    }
  }
}

export async function renderBackground(seed = DEFAULT_BACKGROUND_SEED): Promise<FrameBuffer> {
  const rng = createRng(seed)
  const layout = generateLayout(rng)
  const buffer = createFrameBuffer(BACKGROUND_WIDTH, BACKGROUND_HEIGHT)
  fillFrameBuffer(buffer, BACKGROUND_FILL)
  renderDust(buffer, layout.dustSeed)
  const sprites = await loadSpaceSprites()
  for (const particle of layout.particles) {
    const frame = sprites.particleFrames[particle.frame % sprites.particleFrames.length]!
    const tint = BACKGROUND_RAMP[particle.colorIndex % BACKGROUND_RAMP.length]!
    blitSprite(buffer, frame, particle.x, particle.y, tint)
  }
  for (const star of layout.bigStars) {
    const frame = sprites.bigStarFrames[star.frame % sprites.bigStarFrames.length]!
    blitSprite(buffer, frame, star.x, star.y)
  }
  return buffer
}
