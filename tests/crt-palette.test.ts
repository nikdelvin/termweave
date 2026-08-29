import { describe, expect, test } from 'bun:test'
import { applyCrtPalette } from '../termweave/host/crt-effects/crt-palette'

describe('CRT image palette', () => {
  test('uses the uniform RGB332 cube and keeps alpha opaque', () => {
    const data = Uint8Array.of(100, 150, 200, 255, 255, 0, 36, 255)
    applyCrtPalette(data)
    expect(Array.from(data)).toEqual([109, 146, 170, 255, 255, 0, 0, 255])
  })

  test('produces exactly 256 possible RGB values without an extra background anchor', () => {
    const data = new Uint8Array(8 * 8 * 4 * 4)
    let offset = 0
    for (let red = 0; red < 8; red += 1) {
      for (let green = 0; green < 8; green += 1) {
        for (let blue = 0; blue < 4; blue += 1) {
          data[offset] = Math.round((red * 255) / 7)
          data[offset + 1] = Math.round((green * 255) / 7)
          data[offset + 2] = Math.round((blue * 255) / 3)
          data[offset + 3] = 255
          offset += 4
        }
      }
    }

    applyCrtPalette(data)
    const colors = new Set<string>()
    for (let pixel = 0; pixel < data.length; pixel += 4) {
      colors.add(`${data[pixel]},${data[pixel + 1]},${data[pixel + 2]}`)
    }
    expect(colors.size).toBe(256)
  })

  test('is idempotent and rejects incomplete pixels', () => {
    const data = Uint8Array.of(109, 146, 170, 255, 0, 0, 0, 255)
    applyCrtPalette(data)
    const once = data.slice()
    applyCrtPalette(data)
    expect(data).toEqual(once)
    expect(() => applyCrtPalette(new Uint8Array(3))).toThrow('complete RGBA')
  })
})
