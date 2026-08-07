import { describe, expect, test } from 'bun:test'
import { applyCrtPalette } from '../termweave/host/crt-effects/crt-palette'

describe('CRT image palette', () => {
  test('uses the uniform RGB333 cube and keeps alpha opaque', () => {
    const data = Uint8Array.of(100, 150, 200, 255, 255, 0, 36, 255)
    applyCrtPalette(data, [1, 4, 22])
    expect(Array.from(data)).toEqual([109, 146, 182, 255, 255, 0, 36, 255])
  })

  test('preserves the exact configured background as a seamless palette anchor', () => {
    const data = Uint8Array.of(1, 4, 22, 255, 2, 5, 21, 255, 30, 30, 30, 255)
    applyCrtPalette(data, [1, 4, 22])
    expect(Array.from(data.subarray(0, 8))).toEqual([1, 4, 22, 255, 1, 4, 22, 255])
    expect(Array.from(data.subarray(8))).toEqual([36, 36, 36, 255])
  })

  test('is idempotent and rejects incomplete pixels', () => {
    const data = Uint8Array.of(109, 146, 182, 255, 1, 4, 22, 255)
    applyCrtPalette(data, [1, 4, 22])
    const once = data.slice()
    applyCrtPalette(data, [1, 4, 22])
    expect(data).toEqual(once)
    expect(() => applyCrtPalette(new Uint8Array(3), [0, 0, 0])).toThrow('complete RGBA')
  })
})
