import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  assembleRawVideoFrames,
  buildFfmpegMediaArguments,
  parseFfmpegTimestamps,
  resolveFfmpegPath,
} from '../termweave/media/ffmpeg'

async function* chunks(values: readonly number[][]) {
  for (const value of values) yield Uint8Array.from(value)
}

async function* textChunks(values: readonly string[]) {
  const encoder = new TextEncoder()
  for (const value of values) yield encoder.encode(value)
}

describe('FFmpeg media command construction', () => {
  test('uses direct arguments, source timestamps, separate pipes, and no FPS resampling', () => {
    const input = 'https://cdn.example.test/video with spaces.mp4?token=secret'
    const arguments_ = buildFfmpegMediaArguments({
      background: [1, 4, 22],
      hardwareAcceleration: true,
      height: 144,
      input,
      inputFormat: 'mp4',
      realtime: true,
      remote: true,
      width: 256,
      withAudio: true,
    })

    expect(arguments_[arguments_.indexOf('-i') + 1]).toBe(input)
    expect(arguments_).toContain('-re')
    expect(arguments_).toContain('videotoolbox')
    expect(arguments_).toContain('pipe:1')
    expect(arguments_).toContain('pipe:3')
    expect(arguments_).toContain('pipe:4')
    expect(arguments_).toContain('passthrough')
    expect(arguments_.join(' ')).not.toMatch(/\bfps=/)
    expect(arguments_[arguments_.indexOf('-vf') + 1]).toBe(
      'scale=256:144:force_original_aspect_ratio=decrease:flags=bilinear,' +
        'pad=256:144:(ow-iw)/2:(oh-ih)/2:color=0x010416,format=rgba,setpts=PTS-STARTPTS',
    )
    expect(arguments_[arguments_.lastIndexOf('-map') + 1]).toBe('0:a:0')
  })

  test('builds a video-only software fallback without an audio output', () => {
    const arguments_ = buildFfmpegMediaArguments({
      background: [0, 0, 0],
      hardwareAcceleration: false,
      height: 2,
      input: '/tmp/movie 世界.mp4',
      inputFormat: 'mp4',
      realtime: true,
      remote: false,
      width: 2,
      withAudio: false,
    })
    expect(arguments_[arguments_.indexOf('-i') + 1]).toBe('/tmp/movie 世界.mp4')
    expect(arguments_).not.toContain('videotoolbox')
    expect(arguments_).not.toContain('pipe:3')
    expect(arguments_).not.toContain('0:a:0')
  })

  test('collects finite signature-detected images without real-time throttling', () => {
    const arguments_ = buildFfmpegMediaArguments({
      background: [0, 0, 0],
      hardwareAcceleration: false,
      height: 4,
      input: '/tmp/extensionless-image',
      inputFormat: 'png',
      realtime: false,
      remote: false,
      width: 4,
      withAudio: false,
    })
    expect(arguments_).not.toContain('-re')
    expect(arguments_[arguments_.indexOf('-vf') + 1]).toContain('flags=bilinear')
    expect(arguments_[arguments_.indexOf('-vf') + 1]).not.toContain('flags=fast_bilinear')
    expect(arguments_.slice(arguments_.indexOf('-f'), arguments_.indexOf('-i'))).toEqual([
      '-f',
      'image2',
      '-c:v',
      'png',
    ])
  })

  test('selects the GIF demuxer explicitly for extensionless inputs', () => {
    const arguments_ = buildFfmpegMediaArguments({
      background: [0, 0, 0],
      hardwareAcceleration: false,
      height: 4,
      input: '/tmp/animation.data',
      inputFormat: 'gif',
      realtime: false,
      remote: false,
      width: 4,
      withAudio: false,
    })
    expect(arguments_.slice(arguments_.indexOf('-f'), arguments_.indexOf('-i'))).toEqual([
      '-f',
      'gif',
    ])
  })

  test('resolves only an explicit development binary or packaged sibling', async () => {
    const configured = resolve('/tmp/termweave-ffmpeg')
    expect(
      await resolveFfmpegPath({
        environment: { TERMWEAVE_FFMPEG_PATH: configured },
        executablePath: '/opt/homebrew/bin/bun',
        fileExists: async (path) => path === configured,
      }),
    ).toBe(configured)
    await expect(
      resolveFfmpegPath({
        environment: {},
        executablePath: '/opt/homebrew/bin/bun',
        fileExists: async () => true,
      }),
    ).rejects.toThrow('bundled FFmpeg executable')
  })
})

describe('timestamp and raw-frame assembly', () => {
  test('parses arbitrary timestamp chunks and rebases variable frame cadence', async () => {
    const timestamps = await Array.fromAsync(
      parseFfmpegTimestamps(textChunks(['1200 1/1000\n12', '40 1/1000\n1280 1/1000\n'])),
    )
    expect(timestamps).toEqual([0, 40, 80])
  })

  test('assembles arbitrary video chunks and requires one timestamp per frame', async () => {
    const values: number[][] = []
    async function* timestamps() {
      yield 0
      yield 41.667
    }
    for await (const frame of assembleRawVideoFrames(
      chunks([
        [1, 2, 3],
        [4, 5, 6, 7, 8],
      ]),
      timestamps(),
      { width: 1, height: 1 },
    )) {
      values.push([...frame.data, frame.ptsMs])
      frame.release()
    }
    expect(values).toEqual([
      [1, 2, 3, 4, 0],
      [5, 6, 7, 8, 41.667],
    ])

    const consumePartial = async () => {
      for await (const frame of assembleRawVideoFrames(chunks([[1, 2, 3]]), timestamps(), {
        width: 1,
        height: 1,
      })) {
        frame.release()
      }
    }
    await expect(consumePartial()).rejects.toThrow('partial video frame')
  })
})
