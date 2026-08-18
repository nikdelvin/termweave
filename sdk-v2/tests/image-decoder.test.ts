import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createJimp } from '@jimp/core'
import jpeg from '@jimp/js-jpeg'
import png from '@jimp/js-png'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  compositeGifFrames,
  getCachedLocalImageFrames,
  loadLocalImageFrames,
  type GifPatchFrame,
} from '../termweave/components/image-decoder'

const TestImage = createJimp({ formats: [jpeg, png] })
const twoFrameGif = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAABAAAALAAAAAABAAEAAAIBTAAh+QQAAQAAACwAAAAAAQABAAACAUwAOw=='),
  (character) => character.charCodeAt(0),
)

let temporaryDirectory = ''
let pngPath = ''
let jpegPath = ''
let gifPath = ''

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'termweave-pixel-renderer-'))
  pngPath = join(temporaryDirectory, 'opaque-jpeg-name.data')
  jpegPath = join(temporaryDirectory, 'lossy-png-name.data')
  gifPath = join(temporaryDirectory, 'animation.bin')

  const transparentRed = new TestImage({ width: 4, height: 2, color: 0xff000080 })
  const opaqueGreen = new TestImage({ width: 3, height: 2, color: 0x00ff00ff })
  await Promise.all([
    Bun.write(pngPath, await transparentRed.getBuffer('image/png')),
    Bun.write(jpegPath, await opaqueGreen.getBuffer('image/jpeg')),
    Bun.write(gifPath, twoFrameGif),
  ])
})

afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true })
})

function solidPatch(width: number, height: number, rgba: readonly number[]) {
  const patch = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < patch.length; offset += 4) patch.set(rgba, offset)
  return patch
}

function pixel(frame: { data: Uint8Array; width: number }, x: number, y: number) {
  const offset = (y * frame.width + x) * 4
  return Array.from(frame.data.subarray(offset, offset + 4))
}

describe('still-image decoding and sizing', () => {
  test('committed campfire PNG matches the GIF first rendered frame', async () => {
    const assets = resolve(import.meta.dir, '../app/assets')
    const maximum = { width: 640, height: 360 }
    const background = [1, 4, 22] as const
    const [gifFrames, pngFrames] = await Promise.all([
      loadLocalImageFrames(join(assets, 'campfire.gif'), maximum, background),
      loadLocalImageFrames(join(assets, 'campfire.png'), maximum, background),
    ])

    expect(pngFrames).toHaveLength(1)
    expect(pngFrames[0]).toMatchObject({ width: 640, height: 360, delayMs: 0 })
    expect(pngFrames[0]!.data).toEqual(gifFrames[0]!.data)
  })

  test('detects and decodes PNG independently of its extension', async () => {
    const [frame] = await loadLocalImageFrames(pngPath, { width: 8, height: 8 }, [0, 0, 255])
    expect(frame).toMatchObject({ width: 8, height: 4, delayMs: 0 })
    expect(frame!.data.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
    expect(pixel(frame!, 0, 0)).toEqual([146, 0, 109, 255])
  })

  test('detects and decodes JPEG independently of its extension', async () => {
    const [frame] = await loadLocalImageFrames(
      pathToFileURL(jpegPath).href,
      { width: 12, height: 8 },
      [1, 2, 3],
    )
    expect(frame).toMatchObject({ width: 12, height: 8, delayMs: 0 })
    expect(frame!.data[3]).toBe(255)
    expect(frame!.data[1]).toBeGreaterThan(240)
  })

  test('decodes a bundled-style animated GIF by content', async () => {
    const frames = await loadLocalImageFrames(gifPath, { width: 4, height: 4 }, [7, 8, 9])
    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => frame.delayMs)).toEqual([10, 10])
    expect(frames.every((frame) => frame.width === 4 && frame.height === 4)).toBe(true)
  })

  test('reuses exact decoded frames synchronously and invalidates changed files', async () => {
    const cachePath = join(temporaryDirectory, 'cache-source.data')
    const maximum = { width: 8, height: 8 }
    const background = [1, 2, 3] as const
    await Bun.write(
      cachePath,
      await new TestImage({ width: 4, height: 2, color: 0x112233ff }).getBuffer('image/png'),
    )

    const first = await loadLocalImageFrames(cachePath, maximum, background)
    expect(getCachedLocalImageFrames(pathToFileURL(cachePath).href, maximum, background)).toBe(
      first,
    )
    expect(await loadLocalImageFrames(pathToFileURL(cachePath).href, maximum, background)).toBe(
      first,
    )
    expect(await loadLocalImageFrames(cachePath, maximum, [3, 2, 1])).not.toBe(first)

    await Bun.write(
      cachePath,
      await new TestImage({ width: 3, height: 3, color: 0x445566ff }).getBuffer('image/png'),
    )
    expect(getCachedLocalImageFrames(cachePath, maximum, background)).toBeUndefined()
    expect(await loadLocalImageFrames(cachePath, maximum, background)).not.toBe(first)
  })

  test('reports corrupt, unsupported, empty, and missing sources without extension fallback', async () => {
    const corrupt = join(temporaryDirectory, 'corrupt.png')
    const unsupported = join(temporaryDirectory, 'unsupported.jpg')
    const empty = join(temporaryDirectory, 'empty.gif')
    await Bun.write(corrupt, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0))
    await Bun.write(unsupported, 'plain text')
    await Bun.write(empty, new Uint8Array())

    await expect(
      loadLocalImageFrames(corrupt, { width: 4, height: 4 }, [0, 0, 0]),
    ).rejects.toThrow()
    await expect(
      loadLocalImageFrames(unsupported, { width: 4, height: 4 }, [0, 0, 0]),
    ).rejects.toThrow('Unsupported image format')
    await expect(loadLocalImageFrames(empty, { width: 4, height: 4 }, [0, 0, 0])).rejects.toThrow(
      'image file is empty',
    )
    await expect(
      loadLocalImageFrames(
        join(temporaryDirectory, 'missing.png'),
        { width: 4, height: 4 },
        [0, 0, 0],
      ),
    ).rejects.toThrow()
  })
})

describe('GIF full-frame composition', () => {
  test('clears a disposal-2 rectangle to transparency before the next patch', () => {
    const frames: GifPatchFrame[] = [
      {
        dims: { left: 0, top: 0, width: 2, height: 2 },
        patch: solidPatch(2, 2, [255, 0, 0, 255]),
        delay: 20,
        disposalType: 2,
      },
      {
        dims: { left: 0, top: 0, width: 1, height: 1 },
        patch: solidPatch(1, 1, [0, 0, 255, 255]),
        delay: 20,
      },
    ]
    const output = compositeGifFrames(
      frames,
      { width: 2, height: 2 },
      { width: 2, height: 2 },
      [4, 5, 6],
    )
    expect(pixel(output[0]!, 1, 1)).toEqual([255, 0, 0, 255])
    expect(pixel(output[1]!, 0, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(output[1]!, 1, 1)).toEqual([4, 5, 6, 255])
  })

  test('snapshots and restores disposal-3 frames', () => {
    const frames: GifPatchFrame[] = [
      {
        dims: { left: 0, top: 0, width: 2, height: 2 },
        patch: solidPatch(2, 2, [255, 0, 0, 255]),
        disposalType: 1,
      },
      {
        dims: { left: 0, top: 0, width: 1, height: 1 },
        patch: solidPatch(1, 1, [0, 0, 255, 255]),
        disposalType: 3,
      },
      {
        dims: { left: 1, top: 0, width: 1, height: 1 },
        patch: solidPatch(1, 1, [0, 255, 0, 255]),
      },
    ]
    const output = compositeGifFrames(
      frames,
      { width: 2, height: 2 },
      { width: 2, height: 2 },
      [0, 0, 0],
    )
    expect(pixel(output[1]!, 0, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(output[2]!, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(output[2]!, 1, 0)).toEqual([0, 255, 0, 255])
  })

  test('preserves patch transparency until final background composition', () => {
    const [frame] = compositeGifFrames(
      [
        {
          dims: { left: 0, top: 0, width: 2, height: 2 },
          patch: solidPatch(2, 2, [255, 0, 0, 128]),
        },
      ],
      { width: 2, height: 2 },
      { width: 2, height: 2 },
      [0, 0, 255],
    )
    expect(pixel(frame!, 0, 0)).toEqual([146, 0, 109, 255])
  })

  test('rejects missing frames and malformed or out-of-bounds patches', () => {
    expect(() =>
      compositeGifFrames([], { width: 2, height: 2 }, { width: 2, height: 2 }, [0, 0, 0]),
    ).toThrow('does not contain any image frames')
    expect(() =>
      compositeGifFrames(
        [{ dims: { left: 0, top: 0, width: 2, height: 2 }, patch: new Uint8Array(3) }],
        { width: 2, height: 2 },
        { width: 2, height: 2 },
        [0, 0, 0],
      ),
    ).toThrow('invalid frame patch')
    expect(() =>
      compositeGifFrames(
        [
          {
            dims: { left: 2, top: 0, width: 1, height: 1 },
            patch: solidPatch(1, 1, [1, 2, 3, 4]),
          },
        ],
        { width: 2, height: 2 },
        { width: 2, height: 2 },
        [0, 0, 0],
      ),
    ).toThrow('outside the logical canvas')
  })
})
