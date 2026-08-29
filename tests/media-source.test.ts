import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  bundledMediaUri,
  detectImageFormat,
  readLocalImageSignature,
  retainMediaInput,
  resolveLocalImagePath,
  resolveMediaSource,
  type RetainedMediaInput,
} from '../termweave/media/source'
import { createMediaFixtures, twoFrameGif, type MediaFixtures } from './support/media-fixtures'

let fixtures: MediaFixtures

beforeAll(async () => {
  fixtures = await createMediaFixtures('termweave-source-test-')
})

afterAll(async () => {
  await fixtures.cleanup()
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
    expect(resolveLocalImagePath(`  ${fixtures.transparentPngPath}  `)).toBe(
      fixtures.transparentPngPath,
    )
    expect(resolveLocalImagePath(pathToFileURL(fixtures.transparentPngPath).href)).toBe(
      fixtures.transparentPngPath,
    )
    expect(() => resolveLocalImagePath('https://example.test/image.png')).toThrow(
      'HTTP and HTTPS images are not supported',
    )
    expect(() => resolveLocalImagePath('http://example.test/image.png')).toThrow('local files only')
    expect(() => resolveLocalImagePath('data:image/png;base64,AA==')).toThrow(
      'only local file paths',
    )
    expect(() => resolveLocalImagePath('   ')).toThrow('Media URI is required')
  })

  test('reads only the local signature needed for detection', async () => {
    const signature = await readLocalImageSignature(fixtures.transparentPngPath)
    expect(signature).toHaveLength(8)
    expect(detectImageFormat(signature)).toBe('png')
  })

  test('trusts local signatures instead of misleading image extensions', async () => {
    await expect(
      resolveMediaSource('/tmp/not-really-a.png', {
        fileExists: async () => true,
        readSignature: async () => Uint8Array.of(0xff, 0xd8, 0xff, 0xe0),
      }),
    ).resolves.toMatchObject({ format: 'jpeg', kind: 'local' })
  })

  test('classifies HTTPS, bundled, MP4, and extensionless local sources', async () => {
    expect(
      await resolveMediaSource('https://cdn.example.test/a%20b/video.mp4?token=one'),
    ).toMatchObject({
      format: 'mp4',
      input: 'https://cdn.example.test/a%20b/video.mp4?token=one',
      kind: 'remote',
      loop: true,
    })
    expect(await resolveMediaSource(fixtures.transparentPngPath)).toMatchObject({
      format: 'png',
      kind: 'local',
      loop: false,
    })
    expect(await resolveMediaSource(fixtures.jpegPath)).toMatchObject({
      format: 'jpeg',
      kind: 'local',
    })
    expect(await resolveMediaSource(fixtures.gifPath)).toMatchObject({
      format: 'gif',
      kind: 'local',
      loop: true,
    })

    const mediaRoot = join(fixtures.directory, 'bundled media')
    const bundledPath = join(mediaRoot, 'clips', 'demo 世界.gif')
    await mkdir(join(mediaRoot, 'clips'), { recursive: true })
    await Bun.write(bundledPath, twoFrameGif)
    const uri = bundledMediaUri('clips/demo 世界.gif')
    expect(uri).toBe('media:clips/demo%20%E4%B8%96%E7%95%8C.gif')
    expect(
      await resolveMediaSource(uri, { environment: { TERMWEAVE_MEDIA_ROOT: mediaRoot } }),
    ).toMatchObject({ format: 'gif', input: bundledPath, kind: 'bundled', loop: true })
  })

  test('rejects insecure, unsupported, escaping, and missing media before spawning', async () => {
    await expect(resolveMediaSource('http://example.test/video.mp4')).rejects.toThrow(
      'Insecure HTTP',
    )
    await expect(resolveMediaSource('ftp://example.test/video.mp4')).rejects.toThrow('local files')
    await expect(
      resolveMediaSource('media:../secret.mp4', {
        environment: { TERMWEAVE_MEDIA_ROOT: fixtures.directory },
      }),
    ).rejects.toThrow('safe paths')
    await expect(
      resolveMediaSource('media:missing.mp4', {
        environment: { TERMWEAVE_MEDIA_ROOT: fixtures.directory },
      }),
    ).rejects.toThrow('does not exist')
    await expect(resolveMediaSource('https://example.test/file.webm')).rejects.toThrow(
      'Unsupported media type',
    )
  })

  test('preserves the bundled extraction failure when rollback also fails', async () => {
    const input = join(tmpdir(), 'termweave-$bunfs-missing', 'asset.gif')
    const cleanupFailure = new Error('rollback removal failed')
    let extractionDirectory: string | undefined
    using warning = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const failure = await retainMediaInput(
        {
          format: 'gif',
          input,
          kind: 'bundled',
          loop: true,
          uri: 'media:asset.gif',
        },
        {
          removeDirectory: async (directory) => {
            extractionDirectory = String(directory)
            throw cleanupFailure
          },
        },
      ).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toContain('Could not extract bundled media for FFmpeg')
      expect((failure as Error).cause).toBeDefined()
      expect(warning).toHaveBeenCalledWith(
        'Termweave could not remove a failed bundled-media extraction: rollback removal failed',
      )
    } finally {
      if (extractionDirectory) {
        await rm(extractionDirectory, { force: true, recursive: true })
      }
    }
  })

  test('keeps Bun-virtual extraction alive across a concurrent final-release handoff', async () => {
    const virtualRoot = await mkdtemp(join(tmpdir(), 'termweave-$bunfs-source-'))
    let second: RetainedMediaInput | undefined
    try {
      const input = join(virtualRoot, 'asset.gif')
      await Bun.write(input, twoFrameGif)
      const source = {
        format: 'gif' as const,
        input,
        kind: 'bundled' as const,
        loop: true,
        uri: 'media:asset.gif',
      }
      const first = await retainMediaInput(source)
      const secondPending = retainMediaInput(source)
      await first.release()
      second = await secondPending

      expect(second.path).toBe(first.path)
      expect(await Bun.file(second.path).exists()).toBe(true)
      await second.release()
      expect(await Bun.file(second.path).exists()).toBe(false)
      second = undefined
    } finally {
      await second?.release()
      await rm(virtualRoot, { force: true, recursive: true })
    }
  })
})
