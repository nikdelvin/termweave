import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createJimp } from '@jimp/core'
import jpeg from '@jimp/js-jpeg'
import png from '@jimp/js-png'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyCrtPalette } from '../termweave/components/crt-palette'
import {
  centeredViewport,
  compositeAgainstBackground,
  compositeGifFrames,
  createImageController,
  detectImageFormat,
  fittedDimensions,
  loadLocalImage,
  normalizeGifDelay,
  parseHexColor,
  readLocalImageBytes,
  resizeRgbaFrame,
  resolveLocalImagePath,
  startAnimationPlayback,
  type AnimationFrame,
  type GifPatchFrame,
  type TimerClock,
} from '../termweave/components/image'

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

function animationFrame(value: number, delayMs: number): AnimationFrame {
  return { width: 2, height: 2, data: new Uint8Array(16).fill(value), delayMs }
}

function last<T>(values: readonly T[]) {
  return values[values.length - 1]
}

class FakeClock implements TimerClock<number> {
  time = 0
  nextId = 1
  maximumPending = 0
  readonly timers = new Map<number, { callback: () => void; due: number }>()

  now() {
    return this.time
  }

  setTimer(callback: () => void, delayMs: number) {
    const id = this.nextId
    this.nextId += 1
    this.timers.set(id, { callback, due: this.time + delayMs })
    this.maximumPending = Math.max(this.maximumPending, this.timers.size)
    return id
  }

  clearTimer(id: number) {
    this.timers.delete(id)
  }

  advanceTo(time: number) {
    this.time = time
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.due <= time)
      .sort((left, right) => left[1].due - right[1].due)
    const next = due[0]
    if (!next) return false
    this.timers.delete(next[0])
    next[1].callback()
    return true
  }
}

describe('local image input and signatures', () => {
  test('detects PNG, JPEG, GIF87a, and GIF89a signatures', () => {
    expect(detectImageFormat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10))).toBe('png')
    expect(detectImageFormat(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(detectImageFormat(new TextEncoder().encode('GIF87a'))).toBe('gif')
    expect(detectImageFormat(new TextEncoder().encode('GIF89a'))).toBe('gif')
  })

  test('reports empty and unsupported content separately', () => {
    expect(() => detectImageFormat(new Uint8Array())).toThrow('image file is empty')
    expect(() => detectImageFormat(new TextEncoder().encode('not an image'))).toThrow(
      'Unsupported image format',
    )
  })

  test('accepts paths and local file URLs while rejecting remote and other schemes', () => {
    expect(resolveLocalImagePath(`  ${pngPath}  `)).toBe(pngPath)
    expect(resolveLocalImagePath(pathToFileURL(pngPath).href)).toBe(pngPath)
    expect(() => resolveLocalImagePath('https://example.test/image.png')).toThrow(
      'HTTP and HTTPS images are not supported',
    )
    expect(() => resolveLocalImagePath('http://example.test/image.png')).toThrow('local files only')
    expect(() => resolveLocalImagePath('data:image/png;base64,AA==')).toThrow(
      'only local file paths',
    )
    expect(() => resolveLocalImagePath('   ')).toThrow('Image URI is required')
  })

  test('reads the same Bun-import-compatible file by path and file URL', async () => {
    const pathBytes = await readLocalImageBytes(pngPath)
    const urlBytes = await readLocalImageBytes(pathToFileURL(pngPath).href)
    expect(pathBytes).toEqual(urlBytes)
    expect(detectImageFormat(pathBytes)).toBe('png')
  })

  test('honors an already-aborted read without starting I/O', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(readLocalImageBytes(pngPath, controller.signal)).rejects.toHaveProperty(
      'name',
      'AbortError',
    )
  })
})

describe('still-image decoding and sizing', () => {
  test('detects and decodes PNG independently of its extension', async () => {
    const [frame] = await loadLocalImage(pngPath, { width: 8, height: 8 }, [0, 0, 255])
    expect(frame).toMatchObject({ width: 8, height: 4, delayMs: 0 })
    expect(frame!.data.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
    expect(pixel(frame!, 0, 0)).toEqual([146, 0, 109, 255])
  })

  test('detects and decodes JPEG independently of its extension', async () => {
    const [frame] = await loadLocalImage(
      pathToFileURL(jpegPath).href,
      { width: 12, height: 8 },
      [1, 2, 3],
    )
    expect(frame).toMatchObject({ width: 12, height: 8, delayMs: 0 })
    expect(frame!.data[3]).toBe(255)
    expect(frame!.data[1]).toBeGreaterThan(240)
  })

  test('decodes a bundled-style animated GIF by content', async () => {
    const frames = await loadLocalImage(gifPath, { width: 4, height: 4 }, [7, 8, 9])
    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => frame.delayMs)).toEqual([10, 10])
    expect(frames.every((frame) => frame.width === 4 && frame.height === 4)).toBe(true)
  })

  test('reports corrupt, unsupported, empty, and missing sources without extension fallback', async () => {
    const corrupt = join(temporaryDirectory, 'corrupt.png')
    const unsupported = join(temporaryDirectory, 'unsupported.jpg')
    const empty = join(temporaryDirectory, 'empty.gif')
    await Bun.write(corrupt, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0))
    await Bun.write(unsupported, 'plain text')
    await Bun.write(empty, new Uint8Array())

    await expect(loadLocalImage(corrupt, { width: 4, height: 4 }, [0, 0, 0])).rejects.toThrow()
    await expect(loadLocalImage(unsupported, { width: 4, height: 4 }, [0, 0, 0])).rejects.toThrow(
      'Unsupported image format',
    )
    await expect(loadLocalImage(empty, { width: 4, height: 4 }, [0, 0, 0])).rejects.toThrow(
      'image file is empty',
    )
    await expect(
      loadLocalImage(join(temporaryDirectory, 'missing.png'), { width: 4, height: 4 }, [0, 0, 0]),
    ).rejects.toThrow()
  })

  test('uses one contain scale, floors to even dimensions, and never exceeds the target', () => {
    expect(fittedDimensions({ width: 9, height: 5 }, { width: 20, height: 12 })).toEqual({
      width: 20,
      height: 10,
    })
    expect(fittedDimensions({ width: 5, height: 9 }, { width: 20, height: 12 })).toEqual({
      width: 6,
      height: 12,
    })
    expect(fittedDimensions({ width: 1000, height: 1 }, { width: 20, height: 20 })).toEqual({
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
      expect(() => fittedDimensions(source, { width: 4, height: 4 })).toThrow()
    }
    expect(() => fittedDimensions({ width: 1, height: 1 }, { width: 3, height: 4 })).toThrow(
      'must be even',
    )
  })

  test('centers fitted pixel dimensions in cell coordinates', () => {
    expect(centeredViewport({ width: 10, height: 8 }, { width: 12, height: 8 })).toEqual({
      x: 2,
      y: 2,
      width: 6,
      height: 4,
    })
    expect(() => centeredViewport({ width: 2, height: 2 }, { width: 6, height: 4 })).toThrow(
      'exceeds',
    )
    expect(() => centeredViewport({ width: 4, height: 4 }, { width: 3, height: 4 })).toThrow(
      'must be even',
    )
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

    const composited = compositeAgainstBackground(resized, [0, 0, 255])
    expect(composited.data.every((value, index) => index % 4 !== 3 || value === 255)).toBe(true)
    expect(pixel(composited, 3, 0)).toEqual([0, 0, 255, 255])
    expect(parseHexColor('#01aBfF')).toEqual([1, 171, 255])
    expect(() => parseHexColor('#fff')).toThrow('six-digit')
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

  test('normalizes invalid delays and rounds valid delays with a 10 ms floor', () => {
    for (const delay of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, '12']) {
      expect(normalizeGifDelay(delay)).toBe(100)
    }
    expect(normalizeGifDelay(1)).toBe(10)
    expect(normalizeGifDelay(10.6)).toBe(11)
    expect(normalizeGifDelay(100.4)).toBe(100)
  })
})

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

describe('monotonic GIF playback', () => {
  test('loops on exact boundaries and skips expired frames after a long pause', () => {
    const clock = new FakeClock()
    const frames = [animationFrame(1, 100), animationFrame(2, 200)]
    const shown: AnimationFrame[] = []
    const dispose = startAnimationPlayback(frames, (frame) => shown.push(frame), { clock })

    expect(shown).toEqual([frames[0]])
    clock.advanceTo(99)
    expect(shown).toEqual([frames[0]])
    clock.advanceTo(100)
    expect(shown).toEqual([frames[0], frames[1]])
    clock.advanceTo(300)
    expect(shown).toEqual([frames[0], frames[1], frames[0]])
    clock.advanceTo(850)
    expect(last(shown)).toBe(frames[1])
    expect(clock.maximumPending).toBe(1)
    expect(clock.timers.size).toBe(1)

    dispose()
    expect(clock.timers.size).toBe(0)
    clock.advanceTo(2000)
    expect(last(shown)).toBe(frames[1])
  })

  test('keeps still images timer-free and clears scheduling failures', () => {
    const stillClock = new FakeClock()
    const shown: AnimationFrame[] = []
    startAnimationPlayback([animationFrame(1, 0)], (frame) => shown.push(frame), {
      clock: stillClock,
    })
    expect(shown).toHaveLength(1)
    expect(stillClock.timers.size).toBe(0)

    const failingClock = new FakeClock()
    const errors: unknown[] = []
    startAnimationPlayback([animationFrame(1, 10), animationFrame(2, 10)], () => {}, {
      clock: failingClock,
      onError: (error) => errors.push(error),
    })
    failingClock.time = Number.NaN
    const scheduled = [...failingClock.timers.entries()][0]!
    failingClock.timers.delete(scheduled[0])
    const callback = scheduled[1].callback
    callback()
    expect(errors).toHaveLength(1)
    expect(failingClock.timers.size).toBe(0)
  })
})

describe('image lifecycle controller', () => {
  test('aborts replaced URI and dimension loads and suppresses stale completions', async () => {
    const pending: Array<{
      resolve: (frames: AnimationFrame[]) => void
      signal: AbortSignal | undefined
      uri: string
      width: number
    }> = []
    const shown: Array<AnimationFrame | undefined> = []
    const errors: unknown[] = []
    const playbackCallbacks: Array<(frame: AnimationFrame) => void> = []
    let stopped = 0
    const controller = createImageController({
      onError: (error) => {
        if (error !== undefined) errors.push(error)
      },
      onFrame: (frame) => shown.push(frame),
      load: (uri, maximum, _background, signal) =>
        new Promise((resolve) => pending.push({ resolve, signal, uri, width: maximum.width })),
      play: (frames, onFrame) => {
        playbackCallbacks.push(onFrame)
        onFrame(frames[0]!)
        return () => {
          stopped += 1
        }
      },
    })

    controller.replace({
      uri: 'first.png',
      maximum: { width: 8, height: 8 },
      background: [0, 0, 0],
    })
    controller.replace({
      uri: 'second.png',
      maximum: { width: 8, height: 8 },
      background: [0, 0, 0],
    })
    expect(pending[0]!.signal?.aborted).toBe(true)
    pending[0]!.resolve([animationFrame(1, 10)])
    await Promise.resolve()
    expect(playbackCallbacks).toHaveLength(0)

    pending[1]!.resolve([animationFrame(2, 10)])
    await Promise.resolve()
    expect(last(shown)?.data[0]).toBe(2)

    controller.replace({
      uri: 'second.png',
      maximum: { width: 4, height: 8 },
      background: [0, 0, 0],
    })
    expect(stopped).toBe(1)
    expect(pending[2]).toMatchObject({ uri: 'second.png', width: 4 })
    playbackCallbacks[0]!(animationFrame(9, 10))
    expect(last(shown)).toBeUndefined()
    expect(errors).toEqual([])

    pending[2]!.resolve([animationFrame(3, 10)])
    await Promise.resolve()
    expect(last(shown)?.data[0]).toBe(3)
  })

  test('handles empty and zero-sized states, failures, repeated changes, and disposal cleanup', async () => {
    const signals: AbortSignal[] = []
    const errors: unknown[] = []
    const shown: Array<AnimationFrame | undefined> = []
    let stopCount = 0
    const controller = createImageController({
      onError: (error) => {
        if (error !== undefined) errors.push(error)
      },
      onFrame: (frame) => shown.push(frame),
      load: async (uri, _maximum, _background, signal) => {
        if (signal) signals.push(signal)
        if (uri === 'bad.png') throw new Error('decode failed')
        return [animationFrame(uri.length, 20), animationFrame(uri.length + 1, 20)]
      },
      play: (frames, onFrame) => {
        onFrame(frames[0]!)
        return () => {
          stopCount += 1
        }
      },
    })

    controller.replace({ uri: '', maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
    expect(String(last(errors))).toContain('Image URI is required')
    controller.replace({ uri: 'zero.png', maximum: { width: 0, height: 4 }, background: [0, 0, 0] })
    expect(signals).toHaveLength(0)
    controller.replace({ uri: 'bad.png', maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
    await Promise.resolve()
    await Promise.resolve()
    expect(String(last(errors))).toContain('decode failed')

    for (const uri of ['a.png', 'bb.png', 'ccc.png']) {
      controller.replace({ uri, maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
      await Promise.resolve()
    }
    expect(last(shown)?.data[0]).toBe(7)
    controller.dispose()
    expect(last(signals)?.aborted).toBe(false)
    expect(stopCount).toBeGreaterThan(0)
    expect(last(shown)).toBeUndefined()

    const count = signals.length
    controller.replace({
      uri: 'ignored.png',
      maximum: { width: 4, height: 4 },
      background: [0, 0, 0],
    })
    expect(signals).toHaveLength(count)
  })
})
