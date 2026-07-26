import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  assembleRawVideoFrames,
  buildFfmpegAudioArguments,
  buildFfmpegArguments,
  ffmpegExecutableName,
  isBunVirtualFilePath,
  resolveFfmpegPath,
} from '../../sdk/src/helpers/video-stream'

async function* chunks(values: readonly number[][]) {
  for (const value of values) yield Uint8Array.from(value)
}

describe('FFmpeg command construction', () => {
  test('recognizes Bun virtual files that external FFmpeg cannot open', () => {
    expect(isBunVirtualFilePath('/$bunfs/root/demo-2cjdmeef.mp4')).toBe(true)
    expect(isBunVirtualFilePath('B:\\~BUN\\root\\demo-2cjdmeef.mp4')).toBe(true)
    expect(isBunVirtualFilePath('/Applications/Termweave.app/demo.mp4')).toBe(false)
  })

  test('produces a looping, fixed-size BGRA video stream', () => {
    const inputPath = '/tmp/video with spaces.mp4'
    const arguments_ = buildFfmpegArguments({
      background: [1, 4, 22],
      framesPerSecond: 24,
      height: 144,
      inputPath,
      width: 256,
    })

    expect(arguments_[arguments_.indexOf('-i') + 1]).toBe(inputPath)
    expect(arguments_).toContain('-re')
    expect(arguments_).toContain('-stream_loop')
    expect(arguments_).toContain('-an')
    expect(arguments_).toContain('bgra')
    expect(arguments_.at(-1)).toBe('pipe:1')
    expect(arguments_[arguments_.indexOf('-vf') + 1]).toBe(
      'fps=fps=24:round=near,' +
        'scale=256:144:force_original_aspect_ratio=decrease:flags=fast_bilinear,' +
        'pad=256:144:(ow-iw)/2:(oh-ih)/2:color=0x010416,format=bgra',
    )
  })

  test('produces a paced, looping low-compression FLAC audio stream', () => {
    const inputPath = '/tmp/video with spaces.mp4'
    const arguments_ = buildFfmpegAudioArguments(inputPath)

    expect(arguments_[arguments_.indexOf('-i') + 1]).toBe(inputPath)
    expect(arguments_).toContain('-re')
    expect(arguments_[arguments_.indexOf('-map') + 1]).toBe('0:a:0')
    expect(arguments_[arguments_.indexOf('-af') + 1]).toBe('aresample=async=1:first_pts=0')
    expect(arguments_[arguments_.indexOf('-c:a') + 1]).toBe('flac')
    expect(arguments_[arguments_.indexOf('-compression_level') + 1]).toBe('0')
    expect(arguments_.at(-1)).toBe('pipe:1')
  })

  test('resolves an explicit development override before the packaged sibling', async () => {
    const configuredPath = resolve('/tmp/termweave-ffmpeg')
    const checked: string[] = []
    const resolved = await resolveFfmpegPath({
      environment: { TERMWEAVE_FFMPEG_PATH: configuredPath },
      executablePath: '/Applications/Termweave.app/Contents/MacOS/opentui-sidecar',
      fileExists: async (path) => {
        checked.push(path)
        return path === configuredPath
      },
      platform: 'darwin',
    })

    expect(resolved).toBe(configuredPath)
    expect(checked).toEqual([configuredPath])
    expect(ffmpegExecutableName('win32')).toBe('ffmpeg.exe')
  })

  test('fails instead of falling back to a system FFmpeg executable', async () => {
    const checked: string[] = []
    await expect(
      resolveFfmpegPath({
        environment: {},
        executablePath: '/opt/homebrew/bin/bun',
        fileExists: async (path) => {
          checked.push(path)
          return true
        },
        platform: 'darwin',
      }),
    ).rejects.toThrow('bundled FFmpeg executable')
    expect(checked).toEqual([])
  })
})

describe('raw FFmpeg frame assembly', () => {
  test('reassembles frames across arbitrary stdout chunks', async () => {
    const values: number[][] = []
    const indexes: number[] = []

    for await (const frame of assembleRawVideoFrames(
      chunks([
        [1, 2, 3],
        [4, 5, 6, 7, 8],
      ]),
      { width: 1, height: 1 },
    )) {
      values.push([...frame.data])
      indexes.push(frame.frameIndex)
      frame.release()
    }

    expect(values).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ])
    expect(indexes).toEqual([0, 1])
  })

  test('rejects a partial final frame', async () => {
    const consume = async () => {
      for await (const frame of assembleRawVideoFrames(chunks([[1, 2, 3]]), {
        width: 1,
        height: 1,
      })) {
        frame.release()
      }
    }

    await expect(consume()).rejects.toThrow('partial video frame')
  })
})
