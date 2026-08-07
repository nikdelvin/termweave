import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { createJimp } from '@jimp/core'
import jpeg from '@jimp/js-jpeg'
import png from '@jimp/js-png'
import { OptimizedBuffer } from '@opentui/core'
import { testRender } from '@opentui/solid'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSignal } from 'solid-js'
import {
  PixelRenderer,
  drawPixelFrame,
  pixelRendererErrorMessage,
} from '../termweave/components/PixelRenderer'

const TestImage = createJimp({ formats: [jpeg, png] })
const twoFrameGif = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAABAAAALAAAAAABAAEAAAIBTAAh+QQAAQAAACwAAAAAAQABAAACAUwAOw=='),
  (character) => character.charCodeAt(0),
)

let temporaryDirectory = ''
let landscapePath = ''
let squarePath = ''
let corruptPath = ''
let gifPath = ''

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'termweave-pixel-component-'))
  landscapePath = join(temporaryDirectory, 'landscape.bin')
  squarePath = join(temporaryDirectory, 'square.bin')
  corruptPath = join(temporaryDirectory, 'corrupt.bin')
  gifPath = join(temporaryDirectory, 'animated.bin')
  await Promise.all([
    Bun.write(
      landscapePath,
      await new TestImage({ width: 4, height: 2, color: 0xff4000ff }).getBuffer('image/png'),
    ),
    Bun.write(
      squarePath,
      await new TestImage({ width: 2, height: 2, color: 0x20ff40ff }).getBuffer('image/png'),
    ),
    Bun.write(corruptPath, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0)),
    Bun.write(gifPath, twoFrameGif),
  ])
})

afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true })
})

describe('PixelRenderer native drawing', () => {
  test('centers pixels and passes the exact native draw format, byte length, and stride', async () => {
    const draw = spyOn(OptimizedBuffer.prototype, 'drawSuperSampleBuffer')
    const push = spyOn(OptimizedBuffer.prototype, 'pushScissorRect')
    const pop = spyOn(OptimizedBuffer.prototype, 'popScissorRect')
    const setup = await testRender(
      () => <PixelRenderer uri={landscapePath} width={8} height={6} />,
      { width: 12, height: 8 },
    )

    try {
      await setup.waitFor(() => draw.mock.calls.length > 0)
      const call = draw.mock.calls[draw.mock.calls.length - 1]!
      expect(call[0]).toBe(0)
      expect(call[1]).toBe(1)
      expect(call[2]).toBeTruthy()
      expect(call[3]).toBe(16 * 8 * 4)
      expect(call[4]).toBe('rgba8unorm')
      expect(call[5]).toBe(16 * 4)
      expect(push.mock.calls.some((call) => call.join(',') === '0,1,8,4')).toBe(true)
      expect(pop.mock.calls.length).toBeGreaterThan(0)
    } finally {
      setup.renderer.destroy()
      draw.mockRestore()
      push.mockRestore()
      pop.mockRestore()
    }
  })

  test('always pops the image scissor when native drawing throws', () => {
    const events: string[] = []
    const buffer = {
      pushScissorRect: (...values: number[]) => events.push(`push:${values.join(',')}`),
      drawSuperSampleBuffer: () => {
        events.push('draw')
        throw new Error('native failure')
      },
      popScissorRect: () => events.push('pop'),
    }
    expect(() =>
      drawPixelFrame(
        buffer,
        { screenX: 3, screenY: 4 },
        { width: 6, height: 6 },
        { width: 8, height: 4, data: new Uint8Array(128), delayMs: 0 },
      ),
    ).toThrow('native failure')
    expect(events).toEqual(['push:4,6,4,2', 'draw', 'pop'])
  })

  test('reloads on actual source replacement and measured renderer resize', async () => {
    const draw = spyOn(OptimizedBuffer.prototype, 'drawSuperSampleBuffer')
    const [uri, setUri] = createSignal(landscapePath)
    const setup = await testRender(() => <PixelRenderer uri={uri()} width="100%" height="100%" />, {
      width: 8,
      height: 6,
    })

    try {
      await setup.waitFor(() => draw.mock.calls.some((call) => call[5] === 64))
      const initialCount = draw.mock.calls.length
      setUri(squarePath)
      await setup.waitFor(
        () =>
          draw.mock.calls.length > initialCount && draw.mock.calls.some((call) => call[5] === 48),
      )

      const replacementCount = draw.mock.calls.length
      setup.resize(4, 4)
      await setup.waitFor(
        () =>
          draw.mock.calls.length > replacementCount &&
          draw.mock.calls.some((call) => call[5] === 32),
      )
      expect(draw.mock.calls[draw.mock.calls.length - 1]![3]).toBe(8 * 8 * 4)
    } finally {
      setup.renderer.destroy()
      draw.mockRestore()
    }
  })

  test('renders text and control children after the image', async () => {
    const draw = spyOn(OptimizedBuffer.prototype, 'drawSuperSampleBuffer')
    const setup = await testRender(
      () => (
        <PixelRenderer uri={landscapePath} width={14} height={5}>
          <text position="absolute" top={1} left={1}>
            TEXT OVERLAY
          </text>
          <input position="absolute" top={2} left={1} width={8} value="CONTROL" />
        </PixelRenderer>
      ),
      { width: 16, height: 7 },
    )

    try {
      await setup.waitFor(() => draw.mock.calls.length > 0)
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('TEXT')
      expect(frame).toContain('OVERLAY')
      expect(frame).toContain('ONTROL')
    } finally {
      setup.renderer.destroy()
      draw.mockRestore()
    }
  })
})

describe('PixelRenderer errors and cleanup', () => {
  test('shows a concise component-local remote-input error without harming siblings', async () => {
    const setup = await testRender(
      () => (
        <box width="100%" height="100%">
          <PixelRenderer uri="https://example.test/image.png" width={90} height={4} />
          <text position="absolute" top={5} left={0}>
            SIBLING ALIVE
          </text>
        </box>
      ),
      { width: 100, height: 8 },
    )

    try {
      const frame = await setup.waitForFrame(
        (candidate) => candidate.includes('PixelRenderer:') && candidate.includes('SIBLING ALIVE'),
      )
      expect(frame.replaceAll(/\s+/g, ' ')).toContain('local files only')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('contains corrupt decode failures and native draw failures in the component', async () => {
    const corruptSetup = await testRender(
      () => <PixelRenderer uri={corruptPath} width={30} height={4} />,
      { width: 34, height: 6 },
    )
    try {
      const frame = await corruptSetup.waitForFrame((candidate) =>
        candidate.includes('PixelRenderer:'),
      )
      expect(frame).not.toContain('SIBLING CRASHED')
    } finally {
      corruptSetup.renderer.destroy()
    }

    const draw = spyOn(OptimizedBuffer.prototype, 'drawSuperSampleBuffer').mockImplementation(
      () => {
        throw new Error('native\n draw exploded')
      },
    )
    const nativeSetup = await testRender(
      () => (
        <box width="100%" height="100%">
          <PixelRenderer uri={landscapePath} width={30} height={4} />
          <text position="absolute" top={5} left={0}>
            SIBLING ALIVE
          </text>
        </box>
      ),
      { width: 40, height: 8 },
    )
    try {
      const frame = await nativeSetup.waitForFrame(
        (candidate) =>
          candidate.includes('PixelRenderer: native draw') &&
          candidate.includes('exploded') &&
          candidate.includes('SIBLING ALIVE'),
      )
      expect(frame.replaceAll(/\s+/g, ' ')).toContain('native draw exploded')
    } finally {
      nativeSetup.renderer.destroy()
      draw.mockRestore()
    }
  })

  test('normalizes and caps error banners', () => {
    expect(pixelRendererErrorMessage(new Error('  first\n\tsecond  '))).toBe('first second')
    const message = pixelRendererErrorMessage('x'.repeat(500))
    expect(message).toHaveLength(220)
    expect(message.endsWith('…')).toBe(true)
  })

  test('stops animated rendering when the Solid renderer is destroyed', async () => {
    const draw = spyOn(OptimizedBuffer.prototype, 'drawSuperSampleBuffer')
    const setup = await testRender(() => <PixelRenderer uri={gifPath} width={4} height={4} />, {
      width: 6,
      height: 6,
    })

    try {
      await setup.waitFor(() => draw.mock.calls.length >= 1)
      await Bun.sleep(30)
      await setup.flush()
      expect(draw.mock.calls.length).toBeGreaterThanOrEqual(2)
      setup.renderer.destroy()
      const stoppedAt = draw.mock.calls.length
      await Bun.sleep(50)
      expect(draw.mock.calls).toHaveLength(stoppedAt)
    } finally {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      draw.mockRestore()
    }
  })
})
