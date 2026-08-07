import { describe, expect, test } from 'bun:test'
import {
  calculateCenteredViewport,
  compositeFrameOverBackground,
  fitImageDimensions,
  parseHexColor,
  resizeRgbaFrame,
} from '../termweave/components/pixel-frame'

function pixel(frame: { data: Uint8Array; width: number }, x: number, y: number) {
  const offset = (y * frame.width + x) * 4
  return Array.from(frame.data.subarray(offset, offset + 4))
}

describe('pixel frame operations', () => {
  test('uses one contain scale, floors to even dimensions, and never exceeds the target', () => {
    expect(fitImageDimensions({ width: 9, height: 5 }, { width: 20, height: 12 })).toEqual({
      width: 20,
      height: 10,
    })
    expect(fitImageDimensions({ width: 5, height: 9 }, { width: 20, height: 12 })).toEqual({
      width: 6,
      height: 12,
    })
    expect(fitImageDimensions({ width: 1000, height: 1 }, { width: 20, height: 20 })).toEqual({
      width: 20,
      height: 2,
    })
  })

  test('rejects unsafe, fractional, zero, and odd sizing inputs', () => {
    for (const source of [
      { width: 0, height: 1 },
      { width: 1.5, height: 1 },
      { width: Number.MAX_SAFE_INTEGER + 1, height: 2 },
    ]) {
      expect(() => fitImageDimensions(source, { width: 4, height: 4 })).toThrow()
    }
    expect(() => fitImageDimensions({ width: 1, height: 1 }, { width: 3, height: 4 })).toThrow(
      'must be even',
    )
  })

  test('centers fitted pixel dimensions in cell coordinates', () => {
    expect(calculateCenteredViewport({ width: 10, height: 8 }, { width: 12, height: 8 })).toEqual({
      x: 2,
      y: 2,
      width: 6,
      height: 4,
    })
    expect(() =>
      calculateCenteredViewport({ width: 2, height: 2 }, { width: 6, height: 4 }),
    ).toThrow('exceeds')
    expect(() =>
      calculateCenteredViewport({ width: 4, height: 4 }, { width: 3, height: 4 }),
    ).toThrow('must be even')
  })

  test('resizes in premultiplied alpha space and composites to opaque output', () => {
    const resized = resizeRgbaFrame(
      {
        width: 2,
        height: 1,
        data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 0),
      },
      { width: 4, height: 2 },
    )
    for (let offset = 0; offset < resized.data.length; offset += 4) {
      if (resized.data[offset + 3]! > 0) {
        expect(resized.data[offset]).toBe(255)
        expect(resized.data[offset + 2]).toBe(0)
      }
    }

    const composited = compositeFrameOverBackground(resized, [0, 0, 255])
    expect(composited.data.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
    expect(pixel(composited, 3, 0)).toEqual([0, 0, 255, 255])
    expect(parseHexColor('#01aBfF')).toEqual([1, 171, 255])
    expect(() => parseHexColor('#fff')).toThrow('six-digit')
  })
})
