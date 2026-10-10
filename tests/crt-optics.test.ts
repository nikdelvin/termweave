import { describe, expect, test } from 'bun:test'
import { applyCrtPalette, parseHexRgb } from '../termweave/color'
import {
  CRT_REFERENCE_MODEL,
  crtBrightPassThreshold,
  crtFragmentShaderSource,
  mapCrtDestinationToSource,
} from '../termweave/host/crt-effects/crt-optics'

describe('CRT barrel mapping', () => {
  test('maps the screen center onto itself', () => {
    expect(mapCrtDestinationToSource({ x: 0.5, y: 0.5 }, 2560, 1440)).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })

  test('keeps visible screen coordinates inside the aperture for the terminal surface', () => {
    for (const [x, y] of [
      [0.05, 0.05],
      [0.95, 0.05],
      [0.05, 0.95],
      [0.95, 0.95],
      [0.5, 0.02],
      [0.02, 0.5],
    ]) {
      const source = mapCrtDestinationToSource({ x, y }, 2560, 1440)
      expect(source).toBeDefined()
      expect(source!.x).toBeGreaterThanOrEqual(0)
      expect(source!.x).toBeLessThanOrEqual(1)
      expect(source!.y).toBeGreaterThanOrEqual(0)
      expect(source!.y).toBeLessThanOrEqual(1)
    }
  })

  test('rejects invalid drawables and coordinates', () => {
    expect(mapCrtDestinationToSource({ x: 0.5, y: 0.5 }, 0, 1440)).toBeUndefined()
    expect(mapCrtDestinationToSource({ x: 0.5, y: 0.5 }, 2560, Number.NaN)).toBeUndefined()
    expect(mapCrtDestinationToSource({ x: Number.POSITIVE_INFINITY, y: 0.5 }, 2560, 1440)).toBeUndefined()
  })

  test('keeps the fragment shader constants in sync with the TypeScript mapping', () => {
    expect(CRT_REFERENCE_MODEL).toBe('Philips 28PW6006')
    expect(crtFragmentShaderSource).toContain('#version 300 es')
    expect(crtFragmentShaderSource).toContain('destinationToSource')
    expect(crtFragmentShaderSource).toContain('u_brightPassThreshold')
  })
})

describe('CRT bright pass and palette', () => {
  test('floors the bright-pass threshold for dark themes', () => {
    expect(crtBrightPassThreshold([0, 0, 0])).toBe(0.5)
  })

  test('raises the bright-pass threshold with the background luminance', () => {
    const threshold = crtBrightPassThreshold([1, 1, 1])
    expect(threshold).toBeGreaterThan(1.0)
  })

  test('quantizes opaque pixels to the 256-color RGB332 cube', () => {
    const data = Uint8Array.from([255, 0, 0, 255, 128, 128, 128, 255, 0, 0, 255, 255])
    applyCrtPalette(data)
    expect([...data]).toEqual([255, 0, 0, 255, 146, 146, 170, 255, 0, 0, 255, 255])
  })

  test('accepts the configured theme color as a hex triplet', () => {
    expect(parseHexRgb('#010416')).toEqual([1, 4, 22])
  })
})
