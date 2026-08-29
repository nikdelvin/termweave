import { describe, expect, test } from 'bun:test'
import { parseHexRgb } from '../termweave/color'
import {
  calculateCenteredViewport,
  compositeRgbaInto,
  rgbaByteLength,
} from '../termweave/media/frame'

describe('pixel frame operations', () => {
  test('centers even pixel dimensions in terminal-cell coordinates', () => {
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

  test('validates RGBA allocation bounds', () => {
    expect(rgbaByteLength({ width: 4, height: 3 })).toBe(48)
    expect(() => rgbaByteLength({ width: 0, height: 1 })).toThrow()
    expect(() => rgbaByteLength({ width: Number.MAX_SAFE_INTEGER, height: 2 })).toThrow()
  })

  test('shares one opaque background and CRT palette composition path', () => {
    const source = Uint8Array.of(255, 0, 0, 128, 0, 0, 0, 0)
    const destination = new Uint8Array(source.length)
    compositeRgbaInto(source, destination, [0, 0, 255])
    expect([...destination]).toEqual([146, 0, 85, 255, 0, 0, 255, 255])
    expect(() => compositeRgbaInto(source, new Uint8Array(4), [0, 0, 0])).toThrow('equally sized')
    expect(parseHexRgb('#01aBfF')).toEqual([1, 171, 255])
    expect(() => parseHexRgb('#fff')).toThrow('six-digit')
  })
})
