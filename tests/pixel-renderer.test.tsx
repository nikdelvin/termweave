/** @jsxImportSource @opentui/react */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender } from '@opentui/react/test-utils'
import { parseHexRgb } from '../termweave/color'
import {
  PixelRenderer,
  calculateCenteredViewport,
  compositeRgbaInto,
  drawPixelFrameToBuffer,
  fitImageDimensions,
  type RgbaFrame,
} from '../termweave/media/PixelRenderer'

const fixturePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAFElEQVR4nGP4z8DQwNDQ8B+O0QUA8SAO+Rs+CW8AAAAASUVORK5CYII=',
  'base64',
)

let fixtureDirectory: string

beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'termweave-pixel-renderer-'))
  writeFileSync(join(fixtureDirectory, 'fixture.png'), fixturePng)
})

afterAll(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true })
})

describe('static image geometry', () => {
  test('fits images into the maximum box while preserving the aspect ratio', () => {
    expect(fitImageDimensions({ width: 768, height: 432 }, { width: 256, height: 144 })).toEqual({
      width: 256,
      height: 144,
    })
    expect(fitImageDimensions({ width: 4, height: 2 }, { width: 256, height: 144 })).toEqual({
      width: 256,
      height: 128,
    })
    expect(fitImageDimensions({ width: 7, height: 5 }, { width: 4, height: 4 })).toEqual({
      width: 4,
      height: 2,
    })
  })

  test('centers even-pixel images at two pixels per cell', () => {
    expect(calculateCenteredViewport({ width: 10, height: 10 }, { width: 4, height: 2 })).toEqual({
      x: 4,
      y: 4,
      width: 2,
      height: 1,
    })
  })

  test('rejects images that cannot fill whole cells', () => {
    expect(() => calculateCenteredViewport({ width: 8, height: 8 }, { width: 3, height: 3 })).toThrow(
      /even/,
    )
  })

  test('rejects fitted images larger than their container', () => {
    expect(() => calculateCenteredViewport({ width: 2, height: 2 }, { width: 10, height: 4 })).toThrow(
      /exceeds/,
    )
  })
})

describe('CRT pixel pipeline', () => {
  test('composites transparency over the theme background and applies the RGB332 palette', () => {
    const source = Uint8Array.from([255, 0, 0, 128, 0, 128, 128, 255, 0, 0, 0, 0])
    const destination = new Uint8Array(source.byteLength)
    compositeRgbaInto(source, destination, parseHexRgb('#010416'))
    expect([...destination.slice(0, 4)]).toEqual([146, 0, 0, 255])
    expect([...destination.slice(4, 8)]).toEqual([0, 146, 170, 255])
    expect([...destination.slice(8)]).toEqual([0, 0, 0, 255])
  })

  test('draws the frame through a scissored super-sample call', () => {
    const frame: RgbaFrame = {
      width: 4,
      height: 2,
      data: new Uint8Array(4 * 2 * 4),
    }
    const calls: unknown[][] = []
    const buffer = {
      pushScissorRect: (...args: unknown[]) => calls.push(['scissor', ...args]),
      popScissorRect: () => calls.push(['pop']),
      drawSuperSampleBuffer: (...args: unknown[]) => calls.push(['draw', ...args]),
    }
    drawPixelFrameToBuffer(buffer, { screenX: 3, screenY: 2 }, { width: 10, height: 10 }, frame)
    expect(calls).toEqual([
      ['scissor', 7, 6, 2, 1],
      ['draw', 7, 6, frame.data, frame.data.byteLength, 'rgba8unorm', 16],
      ['pop'],
    ])
  })
})

describe('PixelRenderer component', () => {
  test('renders children and paints a static image without errors', async () => {
    const setup = await testRender(
      <PixelRenderer uri={join(fixtureDirectory, 'fixture.png')} width={8} height={4}>
        <text>SMOKE</text>
      </PixelRenderer>,
      { width: 16, height: 8 },
    )
    try {
      const frame = await setup.waitForFrame((captured) => captured.includes('SMOKE'))
      expect(frame).toContain('SMOKE')
      await setup.waitForVisualIdle()
      expect(setup.captureCharFrame()).not.toContain('PixelRenderer:')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('shows the error banner when the image cannot be loaded', async () => {
    const setup = await testRender(
      <PixelRenderer uri={join(fixtureDirectory, 'missing.png')} width={32} height={4} />,
      { width: 40, height: 8 },
    )
    try {
      await Bun.sleep(100)
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain('PixelRenderer:')
    } finally {
      setup.renderer.destroy()
    }
  })
})
