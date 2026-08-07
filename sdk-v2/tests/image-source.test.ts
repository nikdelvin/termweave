import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createJimp } from '@jimp/core'
import jpeg from '@jimp/js-jpeg'
import png from '@jimp/js-png'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  detectImageFormat,
  readLocalImageBytes,
  resolveLocalImagePath,
} from '../termweave/components/image-source'

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
