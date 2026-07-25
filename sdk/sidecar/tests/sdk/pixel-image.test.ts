import { describe, expect, test } from 'bun:test'
import { centeredViewport } from '../../sdk/src/components/PixelRenderer'
import {
  createImageCells,
  fittedDimensions,
  FULL_BLOCK,
  gifFrameIterator,
  normalizedGifFrameDelay,
  resizeFrame,
  type Frame,
} from '../../sdk/src/helpers/pixel-image'

function frame(width: number, height: number, pixels: readonly number[]): Frame {
  return { width, height, data: Uint8Array.from(pixels) }
}

describe('pixel image sizing', () => {
  test('fits within the target while keeping dimensions divisible into terminal cells', () => {
    expect(fittedDimensions({ width: 400, height: 200 }, { width: 100, height: 100 })).toEqual({
      width: 100,
      height: 50,
    })
    expect(fittedDimensions({ width: 75, height: 100 }, { width: 100, height: 60 })).toEqual({
      width: 44,
      height: 60,
    })
  })

  test('centers the visible image and clips images larger than the container', () => {
    expect(centeredViewport({ width: 10, height: 8 }, { width: 4, height: 2 })).toEqual({
      x: 3,
      y: 3,
      width: 4,
      height: 2,
    })
    expect(centeredViewport({ width: 4, height: 2 }, { width: 10, height: 8 })).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 2,
    })
  })
})

describe('pixel image conversion', () => {
  test('copies a frame when no resize is needed', () => {
    const source = frame(1, 1, [10, 20, 30, 255])
    const resized = resizeFrame(source, { width: 1, height: 1 })

    expect(resized).toEqual(source)
    expect(resized.data).not.toBe(source.data)
  })

  test('represents a solid 2x2 block with one full-block cell', () => {
    const solidRed = frame(2, 2, [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255])

    const image = createImageCells(solidRed, [0, 0, 0])

    expect({ width: image.width, height: image.height }).toEqual({ width: 1, height: 1 })
    expect([...image.glyphs]).toEqual([FULL_BLOCK])
    expect([...image.foregrounds]).toEqual([255, 0, 0])
    expect([...image.backgrounds]).toEqual([255, 0, 0])
  })

  test('bounds pixel colors without changing the selected glyph shape', () => {
    const solidColor = frame(
      2,
      2,
      [100, 150, 200, 255, 100, 150, 200, 255, 100, 150, 200, 255, 100, 150, 200, 255],
    )

    const image = createImageCells(solidColor, [0, 0, 0])

    expect([...image.glyphs]).toEqual([FULL_BLOCK])
    expect([...image.foregrounds]).toEqual([109, 146, 182])
    expect([...image.backgrounds]).toEqual([109, 146, 182])
  })

  test('chooses the upper-left quadrant glyph and composites transparency', () => {
    const upperLeftRed = frame(
      2,
      2,
      [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0],
    )

    const image = createImageCells(upperLeftRed, [0, 0, 255])

    expect([...image.glyphs]).toEqual([0x2598])
    expect([...image.foregrounds]).toEqual([255, 0, 0])
    expect([...image.backgrounds]).toEqual([0, 0, 255])
  })
})

describe('GIF animation timing', () => {
  test('uses a safe browser-compatible delay when GIF timing is absent', () => {
    expect(normalizedGifFrameDelay(0)).toBe(100)
    expect(normalizedGifFrameDelay(Number.NaN)).toBe(100)
  })

  test('keeps the delay metadata attached to each decoded frame', async () => {
    const uri = new URL('../../src/assets/campfire.gif', import.meta.url)
    const bytes = Uint8Array.from(await Bun.file(uri).bytes())

    for (let offset = 0; offset < bytes.length - 7; offset += 1) {
      if (bytes[offset] === 0x21 && bytes[offset + 1] === 0xf9 && bytes[offset + 2] === 0x04) {
        bytes[offset + 4] = 2
        bytes[offset + 5] = 0
        break
      }
    }

    const frames = [...gifFrameIterator(bytes, { width: 2, height: 2 })!]

    expect(frames[0]?.delayMs).toBe(20)
    expect(frames[1]?.delayMs).toBe(150)
  })
})
