import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Rgb } from '../termweave/color'
import type { Dimensions } from '../termweave/media/frame'
import {
  getCachedLocalImageFrames,
  loadResolvedLocalImageFrames,
} from '../termweave/media/playback'
import { resolveMediaSource, throwIfMediaAborted } from '../termweave/media/source'
import {
  createMediaFixtures,
  opaqueSquarePng,
  testFfmpegPath,
  type MediaFixtures,
} from './support/media-fixtures'

const maximum = { width: 8, height: 8 }
const background = [0, 0, 255] as const
let fixtures: MediaFixtures

async function loadLocalMediaFrames(
  uri: string,
  dimensions: Dimensions,
  background: Rgb,
  signal?: AbortSignal,
  ffmpegPath?: string,
) {
  throwIfMediaAborted(signal)
  const source = await resolveMediaSource(uri)
  return loadResolvedLocalImageFrames(source, dimensions, background, signal, ffmpegPath)
}

function pixel(frame: { data: Uint8Array; width: number }, x: number, y: number) {
  const offset = (y * frame.width + x) * 4
  return Array.from(frame.data.subarray(offset, offset + 4))
}

beforeAll(async () => {
  fixtures = await createMediaFixtures('termweave-ffmpeg-images-')
})

afterAll(async () => {
  await fixtures.cleanup()
})

describe('FFmpeg image decoding', () => {
  test('decodes the committed campfire GIF into eight 150 ms frames', async () => {
    const assets = resolve(import.meta.dir, '../app/assets')
    const dimensions = { width: 640, height: 360 }
    const paletteBackground = [1, 4, 22] as const
    const [gifFrames, pngFrames] = await Promise.all([
      loadLocalMediaFrames(
        join(assets, 'campfire.gif'),
        dimensions,
        paletteBackground,
        undefined,
        testFfmpegPath(),
      ),
      loadLocalMediaFrames(
        join(assets, 'campfire.png'),
        dimensions,
        paletteBackground,
        undefined,
        testFfmpegPath(),
      ),
    ])

    expect(gifFrames).toHaveLength(8)
    expect(gifFrames.map((frame) => frame.delayMs)).toEqual(Array(8).fill(150))
    expect(pngFrames).toHaveLength(1)
    expect(gifFrames[0]!.data).toEqual(pngFrames[0]!.data)
  })

  test('detects extensionless PNG content and composites transparency once', async () => {
    const [frame] = await loadLocalMediaFrames(
      fixtures.transparentPngPath,
      maximum,
      background,
      undefined,
      testFfmpegPath(),
    )
    expect(frame).toMatchObject({ width: 8, height: 8, delayMs: 0 })
    expect(pixel(frame!, 0, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(frame!, 0, 2)).toEqual([146, 0, 85, 255])
    expect(frame!.data.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
  })

  test('detects and decodes extensionless JPEG content', async () => {
    const [frame] = await loadLocalMediaFrames(
      pathToFileURL(fixtures.jpegPath).href,
      maximum,
      [1, 2, 3],
      undefined,
      testFfmpegPath(),
    )
    expect(frame).toMatchObject({ width: 8, height: 8, delayMs: 0 })
    expect(frame!.data[3]).toBe(255)
    expect(frame!.data.some((value, index) => index % 4 !== 3 && value > 0)).toBe(true)
  })

  test('uses PTS timing and normalizes invalid GIF delays', async () => {
    const frames = await loadLocalMediaFrames(
      fixtures.gifPath,
      { width: 4, height: 4 },
      [7, 8, 9],
      undefined,
      testFfmpegPath(),
    )
    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => frame.delayMs)).toEqual([10, 10])
    expect(frames[0]!.data).not.toBe(frames[1]!.data)
  })

  test('honors GIF disposal before composing each full frame', async () => {
    const frames = await loadLocalMediaFrames(
      fixtures.disposalGifPath,
      { width: 4, height: 2 },
      [0, 0, 0],
      undefined,
      testFfmpegPath(),
    )
    expect(frames.map((frame) => frame.delayMs)).toEqual([50, 50])
    expect(pixel(frames[0]!, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(frames[0]!, 3, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(frames[1]!, 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixel(frames[1]!, 3, 0)).toEqual([255, 0, 0, 255])
  })

  test('reuses cached frames and invalidates file or rendering changes', async () => {
    const first = await loadLocalMediaFrames(
      fixtures.brownPngPath,
      maximum,
      [1, 2, 3],
      undefined,
      testFfmpegPath(),
    )
    expect(
      getCachedLocalImageFrames(pathToFileURL(fixtures.brownPngPath).href, maximum, [1, 2, 3]),
    ).toBe(first)
    expect(
      await loadLocalMediaFrames(
        pathToFileURL(fixtures.brownPngPath).href,
        maximum,
        [1, 2, 3],
        undefined,
        testFfmpegPath(),
      ),
    ).toBe(first)
    expect(
      await loadLocalMediaFrames(
        fixtures.brownPngPath,
        maximum,
        [3, 2, 1],
        undefined,
        testFfmpegPath(),
      ),
    ).not.toBe(first)

    await Bun.write(fixtures.brownPngPath, opaqueSquarePng)
    expect(getCachedLocalImageFrames(fixtures.brownPngPath, maximum, [1, 2, 3])).toBeUndefined()
    expect(
      await loadLocalMediaFrames(
        fixtures.brownPngPath,
        maximum,
        [1, 2, 3],
        undefined,
        testFfmpegPath(),
      ),
    ).not.toBe(first)
  })

  test('propagates cancellation and corrupt, unsupported, empty, and missing errors', async () => {
    const unsupported = join(fixtures.directory, 'unsupported.data')
    const empty = join(fixtures.directory, 'empty.data')
    await Bun.write(unsupported, 'plain text')
    await Bun.write(empty, new Uint8Array())

    const controller = new AbortController()
    controller.abort()
    await expect(
      loadLocalMediaFrames(
        fixtures.transparentPngPath,
        maximum,
        background,
        controller.signal,
        testFfmpegPath(),
      ),
    ).rejects.toHaveProperty('name', 'AbortError')
    await expect(
      loadLocalMediaFrames(
        fixtures.corruptPngPath,
        maximum,
        background,
        undefined,
        testFfmpegPath(),
      ),
    ).rejects.toThrow()
    await expect(
      loadLocalMediaFrames(unsupported, maximum, background, undefined, testFfmpegPath()),
    ).rejects.toThrow('Unsupported image format')
    await expect(
      loadLocalMediaFrames(empty, maximum, background, undefined, testFfmpegPath()),
    ).rejects.toThrow('image file is empty')
    await expect(
      loadLocalMediaFrames(
        join(fixtures.directory, 'missing.data'),
        maximum,
        background,
        undefined,
        testFfmpegPath(),
      ),
    ).rejects.toThrow('does not exist')
  })
})
