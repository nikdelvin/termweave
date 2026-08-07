import { describe, expect, test } from 'bun:test'
import { TERMINAL_SURFACE } from '../termweave/constants'
import {
  CRT_BARREL_APERTURE_GAIN,
  CRT_BARREL_COEFFICIENT,
  CRT_BLOOM_CARDINAL_WEIGHT,
  CRT_BLOOM_DIAMETER_MM,
  CRT_BLOOM_RADIUS_MM,
  CRT_BLOOM_RADIUS_RASTER_PIXELS,
  CRT_BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE,
  CRT_CHROMA_RED_TO_BLUE_EDGE_MM,
  CRT_CHROMA_RED_TO_BLUE_EDGE_RASTER_PIXELS,
  CRT_CHROMA_SHIFT_RASTER_PIXELS,
  CRT_CHROMA_VISIBILITY,
  CRT_HORIZONTAL_EDGE_CURVATURE_SCALE,
  CRT_REFERENCE_ASPECT_HEIGHT,
  CRT_REFERENCE_ASPECT_WIDTH,
  CRT_REFERENCE_BARREL_COEFFICIENT,
  CRT_REFERENCE_MM_PER_RASTER_PIXEL,
  CRT_REFERENCE_MODEL,
  CRT_REFERENCE_NOMINAL_DIAGONAL_MM,
  CRT_REFERENCE_PICTURE_HEIGHT_MM,
  CRT_REFERENCE_PICTURE_WIDTH_MM,
  CRT_REFERENCE_RASTER_HEIGHT,
  CRT_REFERENCE_RASTER_WIDTH,
  CRT_REFERENCE_VISIBLE_DIAGONAL_MM,
  CRT_SCANLINE_DARKENING,
  CRT_SCANLINE_PITCH_RASTER_PIXELS,
  CRT_TUBE_RADIUS_MM,
  crtBrightPassThreshold,
  crtFragmentShaderSource,
  mapCrtDestinationToSource,
  parseRgbHex,
} from '../termweave/host/crt-optics'

describe('physically calibrated CRT optics', () => {
  test('keeps the reference display and measured optics constants internally consistent', () => {
    expect(CRT_REFERENCE_MODEL).toBe('Philips 28PW6006')
    expect(CRT_REFERENCE_NOMINAL_DIAGONAL_MM).toBe(711.2)
    expect(CRT_REFERENCE_VISIBLE_DIAGONAL_MM).toBe(660)
    expect(CRT_REFERENCE_PICTURE_WIDTH_MM).toBeCloseTo(575.2398545022025, 12)
    expect(CRT_REFERENCE_PICTURE_HEIGHT_MM).toBeCloseTo(323.5724181574889, 12)
    expect(CRT_REFERENCE_RASTER_HEIGHT).toBe(240)
    expect(CRT_REFERENCE_RASTER_WIDTH).toBeCloseTo(426.6666666667, 10)
    expect(CRT_REFERENCE_RASTER_WIDTH / CRT_REFERENCE_RASTER_HEIGHT).toBeCloseTo(
      CRT_REFERENCE_ASPECT_WIDTH / CRT_REFERENCE_ASPECT_HEIGHT,
      14,
    )
    expect(CRT_REFERENCE_MM_PER_RASTER_PIXEL).toBeCloseTo(1.3482184089895373, 14)
    expect(CRT_TUBE_RADIUS_MM).toBeCloseTo((CRT_REFERENCE_NOMINAL_DIAGONAL_MM / 2) * 1.7, 12)
    expect(CRT_CHROMA_SHIFT_RASTER_PIXELS * 2 * CRT_REFERENCE_MM_PER_RASTER_PIXEL).toBeCloseTo(
      CRT_CHROMA_RED_TO_BLUE_EDGE_MM,
      12,
    )
    expect(CRT_CHROMA_RED_TO_BLUE_EDGE_RASTER_PIXELS).toBe(0.5)
    expect(CRT_CHROMA_VISIBILITY).toBe(0.45)
    expect(CRT_CHROMA_RED_TO_BLUE_EDGE_MM).toBeCloseTo(0.6741092044947686, 14)
    expect(CRT_BLOOM_RADIUS_MM).toBe(CRT_BLOOM_DIAMETER_MM / 2)
    expect(CRT_BLOOM_RADIUS_RASTER_PIXELS * CRT_REFERENCE_MM_PER_RASTER_PIXEL).toBeCloseTo(
      CRT_BLOOM_RADIUS_MM,
      12,
    )
    expect(CRT_BLOOM_CARDINAL_WEIGHT).toBe(0.05)
    expect(CRT_SCANLINE_PITCH_RASTER_PIXELS).toBe(1)
    expect(CRT_SCANLINE_DARKENING).toBe(0.15)
    expect(CRT_REFERENCE_BARREL_COEFFICIENT).toBeCloseTo(0.0138613658, 10)
    expect(CRT_BARREL_APERTURE_GAIN).toBe(2)
    expect(CRT_BARREL_COEFFICIENT).toBeCloseTo(0.0277227316, 10)
    expect(CRT_HORIZONTAL_EDGE_CURVATURE_SCALE).toBe(0.82)
    expect(CRT_BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE).toBe(0.6)
  })

  test('preserves the physical convergence-to-scanline ratio through the 6x logical scale', () => {
    const logicalScale = TERMINAL_SURFACE.height / CRT_REFERENCE_RASTER_HEIGHT
    const horizontalMillimetersPerRasterPixel =
      CRT_REFERENCE_PICTURE_WIDTH_MM / CRT_REFERENCE_RASTER_WIDTH
    const redToBlueRasterPixels = CRT_CHROMA_SHIFT_RASTER_PIXELS * 2
    const redToBlueLogicalPixels = redToBlueRasterPixels * logicalScale

    expect(logicalScale).toBe(6)
    expect(horizontalMillimetersPerRasterPixel).toBeCloseTo(CRT_REFERENCE_MM_PER_RASTER_PIXEL, 3)
    expect(CRT_CHROMA_SHIFT_RASTER_PIXELS * logicalScale).toBe(1.5)
    expect(redToBlueLogicalPixels).toBe(3)
    expect(redToBlueLogicalPixels / (CRT_SCANLINE_PITCH_RASTER_PIXELS * logicalScale)).toBeCloseTo(
      CRT_CHROMA_RED_TO_BLUE_EDGE_RASTER_PIXELS,
      14,
    )
    expect(CRT_BLOOM_RADIUS_RASTER_PIXELS * logicalScale).toBeCloseTo(2.225158757658887, 14)
  })

  test('keeps the center invariant and remains horizontally symmetric', () => {
    for (const [width, height] of [
      [2560, 1440],
      [1440, 2560],
      [1024, 1024],
    ]) {
      expect(mapCrtDestinationToSource({ x: 0.5, y: 0.5 }, width, height)).toEqual({
        x: 0.5,
        y: 0.5,
      })
      const first = mapCrtDestinationToSource({ x: 0.31, y: 0.42 }, width, height)!
      const reflected = mapCrtDestinationToSource({ x: 0.69, y: 0.42 }, width, height)!
      expect(first.x + reflected.x).toBeCloseTo(1, 14)
      expect(first.y).toBeCloseTo(reflected.y, 14)
    }
  })

  test('fills the drawable at every cardinal edge while retaining curved corners', () => {
    for (const [width, height] of [
      [2560, 1440],
      [1440, 2560],
      [1024, 1024],
    ]) {
      expect(mapCrtDestinationToSource({ x: 0, y: 0.5 }, width, height)).toEqual({
        x: 0,
        y: 0.5,
      })
      expect(mapCrtDestinationToSource({ x: 1, y: 0.5 }, width, height)).toEqual({
        x: 1,
        y: 0.5,
      })
      expect(mapCrtDestinationToSource({ x: 0.5, y: 0 }, width, height)).toEqual({
        x: 0.5,
        y: 0,
      })
      expect(mapCrtDestinationToSource({ x: 0.5, y: 1 }, width, height)).toEqual({
        x: 0.5,
        y: 1,
      })
      expect(mapCrtDestinationToSource({ x: 0, y: 0 }, width, height)).toBeUndefined()
    }
  })

  test('flattens both horizontal edges and applies the additional lower-edge adjustment', () => {
    const sharedEdgeMapping = (x: number, y: number) => {
      const aspect = 2560 / 1440
      const centeredX = (x * 2 - 1) * aspect
      const centeredY = y * 2 - 1
      const radialScale =
        1 + CRT_BARREL_COEFFICIENT * (centeredX * centeredX + centeredY * centeredY)
      const verticalScale =
        1 +
        CRT_BARREL_COEFFICIENT *
          (centeredY * centeredY + centeredX * centeredX * CRT_HORIZONTAL_EDGE_CURVATURE_SCALE)
      const horizontalApertureScale = 1 / (1 + CRT_BARREL_COEFFICIENT * aspect * aspect)
      const verticalApertureScale = 1 / (1 + CRT_BARREL_COEFFICIENT)
      return {
        x: ((centeredX * radialScale * horizontalApertureScale) / aspect + 1) * 0.5,
        y: (centeredY * verticalScale * verticalApertureScale + 1) * 0.5,
      }
    }

    for (const point of [
      { x: 0.08, y: 0.92 },
      { x: 0.31, y: 0.72 },
      { x: 0.5, y: 0.9 },
    ]) {
      const mapped = mapCrtDestinationToSource(point, 2560, 1440)!
      expect(mapped).toEqual(sharedEdgeMapping(point.x, point.y))
    }

    const lowerEdgePoint = { x: 0.08, y: 0.08 }
    const adjusted = mapCrtDestinationToSource(lowerEdgePoint, 2560, 1440)!
    const shared = sharedEdgeMapping(lowerEdgePoint.x, lowerEdgePoint.y)
    expect(adjusted.x).toBe(shared.x)
    expect(adjusted.y).toBeGreaterThan(shared.y)

    const bottomCenter = mapCrtDestinationToSource({ x: 0.5, y: 0.08 }, 2560, 1440)!
    expect(bottomCenter).toEqual(sharedEdgeMapping(0.5, 0.08))
  })

  test('rejects non-finite, zero-sized, and curved-boundary samples', () => {
    expect(mapCrtDestinationToSource({ x: 0.5, y: 0.5 }, 0, 1440)).toBeUndefined()
    expect(mapCrtDestinationToSource({ x: 0.5, y: 0.5 }, 2560, Number.NaN)).toBeUndefined()
    expect(
      mapCrtDestinationToSource({ x: Number.POSITIVE_INFINITY, y: 0.5 }, 2560, 1440),
    ).toBeUndefined()
    expect(mapCrtDestinationToSource({ x: 0, y: 0 }, 2560, 1440)).toBeUndefined()
    expect(mapCrtDestinationToSource({ x: 0.5, y: 0.1 }, 2560, 1440)).toBeDefined()
  })

  test('embeds the same coefficients and aspect-correct mapping in GLSL', () => {
    expect(crtFragmentShaderSource).toContain(CRT_BARREL_COEFFICIENT.toPrecision(17))
    expect(crtFragmentShaderSource).toContain(CRT_HORIZONTAL_EDGE_CURVATURE_SCALE.toPrecision(17))
    expect(crtFragmentShaderSource).toContain(
      CRT_BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE.toPrecision(17),
    )
    expect(crtFragmentShaderSource).toContain(CRT_REFERENCE_RASTER_HEIGHT.toPrecision(17))
    expect(crtFragmentShaderSource).toContain(CRT_CHROMA_SHIFT_RASTER_PIXELS.toPrecision(17))
    expect(crtFragmentShaderSource).toContain(CRT_CHROMA_VISIBILITY.toPrecision(17))
    expect(crtFragmentShaderSource).toContain(CRT_BLOOM_RADIUS_RASTER_PIXELS.toPrecision(17))
    expect(crtFragmentShaderSource).toContain(CRT_SCANLINE_PITCH_RASTER_PIXELS.toPrecision(17))
    expect(crtFragmentShaderSource).toContain(CRT_SCANLINE_DARKENING.toPrecision(17))
    expect(crtFragmentShaderSource).toContain('centered.x *= aspect')
    expect(crtFragmentShaderSource).toContain(
      'float horizontalApertureScale = 1.0 / (1.0 + BARREL_K * aspect * aspect)',
    )
    expect(crtFragmentShaderSource).toContain(
      'float verticalApertureScale = 1.0 / (1.0 + BARREL_K)',
    )
    expect(crtFragmentShaderSource).toContain(
      'float horizontalEdgeCurvatureScale = HORIZONTAL_EDGE_CURVATURE_SCALE',
    )
    expect(crtFragmentShaderSource).toContain('if (centered.y < 0.0)')
    expect(crtFragmentShaderSource).toContain(
      'BOTTOM_EDGE_HORIZONTAL_CURVATURE_SCALE,\n      bottomAmount',
    )
    expect(crtFragmentShaderSource).toContain(
      'horizontalEdgeCurvatureScale *= bottomCurvatureScale',
    )
    expect(crtFragmentShaderSource).toContain('centered.x *= radialScale * horizontalApertureScale')
    expect(crtFragmentShaderSource).toContain('centered.y *= verticalScale * verticalApertureScale')
    expect(crtFragmentShaderSource).toContain('centered.x /= aspect')
    expect(crtFragmentShaderSource).toContain('outColor = vec4(u_background, 1.0)')
    expect(crtFragmentShaderSource).toContain('sourceUv.y * CRT_RASTER_HEIGHT')
    expect(crtFragmentShaderSource).toContain('CHROMA_SHIFT_RASTER_PIXELS / crtRasterSize()')
    expect(crtFragmentShaderSource).toContain('BLOOM_RADIUS_RASTER_PIXELS / crtRasterSize()')
    expect(crtFragmentShaderSource).not.toContain('u_drawablePerCssPixel')
    expect(crtFragmentShaderSource).toContain('fwidth(scanlineRadians)')
    expect(crtFragmentShaderSource).toContain('float scanlineDarkness = scanlineDarkBand(sourceUv)')
  })

  test('applies channel separation around one shared barrel-mapped source coordinate', () => {
    expect(crtFragmentShaderSource).toContain('vec2 chromaSourceOffset = (sourceUv * 2.0 - 1.0)')
    expect(crtFragmentShaderSource).toContain('vec2 redSourceUv = sourceUv + chromaSourceOffset')
    expect(crtFragmentShaderSource).toContain('vec2 blueSourceUv = sourceUv - chromaSourceOffset')
    expect(crtFragmentShaderSource).toContain('sampleTerminal(redSourceUv).r')
    expect(crtFragmentShaderSource).toContain('sampleTerminal(blueSourceUv).b')
    expect(crtFragmentShaderSource).toContain('mix(center, shiftedColor, CHROMA_VISIBILITY)')
    expect(crtFragmentShaderSource).toContain('outColor = vec4(emittedColor, 1.0)')
    expect(crtFragmentShaderSource).not.toContain(
      'destinationToSource(v_destinationUv + chromaSourceOffset)',
    )
    expect(crtFragmentShaderSource).not.toContain(
      'destinationToSource(v_destinationUv - chromaSourceOffset)',
    )
    expect(crtFragmentShaderSource).not.toContain('radialDirection')
    expect(crtFragmentShaderSource).not.toContain('edgeStrength')
    expect(crtFragmentShaderSource.match(/destinationToSource\(v_destinationUv/g)).toHaveLength(1)
  })

  test('derives the documented luminance threshold from the configured background', () => {
    expect(parseRgbHex('#010416')).toEqual([1 / 255, 4 / 255, 22 / 255])
    expect(crtBrightPassThreshold(parseRgbHex('#010416'))).toBe(0.5)
    expect(crtBrightPassThreshold([0.8, 0.8, 0.8])).toBeCloseTo(0.9, 12)
    expect(() => parseRgbHex('black')).toThrow()
  })
})
