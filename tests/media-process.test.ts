import { describe, expect, spyOn, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  assembleRawVideoFrames,
  buildFfmpegMediaArguments,
  createFfmpegProcessError,
  openFfmpegMediaSession,
  parseFfmpegTimestamps,
  resolveFfmpegPath,
  type FfmpegChildProcess,
  type OpenFfmpegDescriptor,
} from '../termweave/media/ffmpeg'
import type { ResolvedMediaSource } from '../termweave/media/source'
import { Deferred } from './support/deferred'

async function* chunks(values: readonly number[][]) {
  for (const value of values) yield Uint8Array.from(value)
}

async function* textChunks(values: readonly string[]) {
  const encoder = new TextEncoder()
  for (const value of values) yield encoder.encode(value)
}

function trackedTimestampStream(values: readonly number[], cleanupError?: Error) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(values.map((value) => `${value} 1/1000\n`).join('')),
      )
      controller.close()
    },
  })
  let finalizers = 0
  const parsed = parseFfmpegTimestamps(
    stream as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>,
  )
  const timestamps: AsyncIterable<number> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => parsed.next(),
        return: async () => {
          finalizers += 1
          const result = await parsed.return(undefined)
          if (cleanupError) throw cleanupError
          return result
        },
      }
    },
  }
  return { finalizers: () => finalizers, stream, timestamps }
}

const mediaSource: ResolvedMediaSource = {
  format: 'mp4',
  input: '/media/movie.mp4',
  kind: 'local',
  loop: true,
  uri: '/media/movie.mp4',
}

function trackedStream(bytes: Uint8Array[] = []) {
  let cancelled = 0
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of bytes) controller.enqueue(chunk)
      if (bytes.length > 0) controller.close()
    },
    cancel() {
      cancelled += 1
    },
  })
  return { stream, cancelled: () => cancelled }
}

function fakeChild(stderrBytes: Uint8Array[] = []) {
  const exit = new Deferred<number>()
  const stdout = trackedStream()
  const stderr = trackedStream(stderrBytes)
  let kills = 0
  const child: FfmpegChildProcess = {
    exited: exit.promise,
    stdout: stdout.stream,
    stderr: stderr.stream,
    stdio: [null, stdout.stream, stderr.stream, 3, 4],
    kill() {
      kills += 1
      exit.resolve(143)
    },
  }
  return { child, exit, kills: () => kills, stderr, stdout }
}

function sessionOptions(signal: AbortSignal) {
  return {
    source: mediaSource,
    width: 2,
    height: 2,
    background: [0, 0, 0] as const,
    ffmpegPath: '/ffmpeg',
    signal,
    withAudio: true,
  }
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

    const packaged = resolve('/Applications/Termweave.app/Contents/MacOS/ffmpeg')
    expect(
      await resolveFfmpegPath({
        architecture: 'arm64',
        environment: {},
        executablePath: '/Applications/Termweave.app/Contents/MacOS/opentui-sidecar',
        fileExists: async (path) => path === packaged,
        platform: 'darwin',
      }),
    ).toBe(packaged)

    for (const executablePath of [
      '/Applications/Termweave.app/Contents/MacOS/opentui-sidecar.exe',
      '/Applications/Termweave.app/Contents/MacOS/OpenTUI-Sidecar',
      '/Applications/Termweave.app/Contents/MacOS/other-sidecar',
    ]) {
      await expect(
        resolveFfmpegPath({
          architecture: 'arm64',
          environment: {},
          executablePath,
          fileExists: async () => true,
          platform: 'darwin',
        }),
      ).rejects.toThrow('bundled FFmpeg executable')
    }

    await expect(
      resolveFfmpegPath({
        environment: {},
        executablePath: '/opt/homebrew/bin/bun',
        fileExists: async () => true,
      }),
    ).rejects.toThrow('bundled FFmpeg executable')
  })

  test('rejects unsupported FFmpeg hosts without Linux or Windows name fallbacks', async () => {
    await expect(
      resolveFfmpegPath({
        architecture: 'x64',
        environment: { TERMWEAVE_FFMPEG_PATH: '/ffmpeg' },
        fileExists: async () => true,
        platform: 'linux',
      }),
    ).rejects.toThrow('supports only macOS arm64 and x64')
    await expect(
      resolveFfmpegPath({
        architecture: 'ia32',
        environment: {},
        fileExists: async () => true,
        platform: 'darwin',
      }),
    ).rejects.toThrow('supports only macOS arm64 and x64')
  })
})

describe('transactional FFmpeg session ownership', () => {
  test('kills the child, cancels opened pipes, removes abort wiring, and releases input on descriptor failure', async () => {
    const controller = new AbortController()
    const add = spyOn(controller.signal, 'addEventListener')
    const remove = spyOn(controller.signal, 'removeEventListener')
    const process = fakeChild()
    const audio = trackedStream()
    let releases = 0
    const openDescriptor: OpenFfmpegDescriptor = (_descriptor, name) => {
      if (name === 'timestamp') throw new Error('descriptor conversion failed')
      return audio.stream
    }

    await expect(
      openFfmpegMediaSession({
        ...sessionOptions(controller.signal),
        openDescriptor,
        retainInput: async () => ({
          path: mediaSource.input,
          release: async () => {
            releases += 1
          },
        }),
        spawn: () => process.child,
      }),
    ).rejects.toThrow('descriptor conversion failed')

    expect(process.kills()).toBe(1)
    expect(process.stdout.cancelled()).toBe(1)
    expect(process.stderr.cancelled()).toBe(1)
    expect(audio.cancelled()).toBe(1)
    expect(releases).toBe(1)
    expect(add).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    add.mockRestore()
    remove.mockRestore()
  })

  test('rolls back a cancellation during pipe setup and performs cleanup only once', async () => {
    const controller = new AbortController()
    const process = fakeChild()
    const audio = trackedStream()
    const timestamps = trackedStream()
    let releases = 0
    let descriptorCount = 0

    await expect(
      openFfmpegMediaSession({
        ...sessionOptions(controller.signal),
        openDescriptor: (_descriptor, name) => {
          descriptorCount += 1
          if (name === 'audio') controller.abort()
          return name === 'audio' ? audio.stream : timestamps.stream
        },
        retainInput: async () => ({
          path: mediaSource.input,
          release: async () => {
            releases += 1
          },
        }),
        spawn: () => process.child,
      }),
    ).rejects.toHaveProperty('name', 'AbortError')

    controller.abort()
    expect(descriptorCount).toBe(2)
    expect(process.kills()).toBe(1)
    expect(audio.cancelled()).toBe(1)
    expect(timestamps.cancelled()).toBe(1)
    expect(releases).toBe(1)
  })

  test('preserves setup and process diagnostics when retained-input cleanup fails', async () => {
    const setupWarning = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(
        openFfmpegMediaSession({
          ...sessionOptions(new AbortController().signal),
          ffmpegPath: undefined,
          resolvePath: async () => {
            throw new Error('primary setup failure')
          },
          retainInput: async () => ({
            path: mediaSource.input,
            release: async () => {
              throw new Error('cleanup failure')
            },
          }),
        }),
      ).rejects.toThrow('primary setup failure')

      const process = fakeChild([new TextEncoder().encode('primary process diagnostic')])
      const session = await openFfmpegMediaSession({
        ...sessionOptions(new AbortController().signal),
        openDescriptor: () => trackedStream().stream,
        retainInput: async () => ({
          path: mediaSource.input,
          release: async () => {
            throw new Error('cleanup failure')
          },
        }),
        spawn: () => process.child,
      })
      process.exit.resolve(7)

      await expect(session.result).resolves.toEqual({
        diagnostic: 'primary process diagnostic',
        exitCode: 7,
      })
      expect(setupWarning).toHaveBeenCalledTimes(2)
      expect(
        setupWarning.mock.calls.every(([message]) => String(message).includes('cleanup failure')),
      ).toBe(true)
    } finally {
      setupWarning.mockRestore()
    }
  })

  test('bounds diagnostics and makes successful-session disposal and completion cleanup idempotent', async () => {
    const controller = new AbortController()
    const diagnostic = `${'a'.repeat(6_000)}TAIL${'z'.repeat(6_000)}`
    const process = fakeChild([new TextEncoder().encode(diagnostic)])
    let releases = 0
    const session = await openFfmpegMediaSession({
      ...sessionOptions(controller.signal),
      openDescriptor: () => trackedStream().stream,
      retainInput: async () => ({
        path: mediaSource.input,
        release: async () => {
          releases += 1
        },
      }),
      spawn: () => process.child,
    })

    session.dispose()
    session.dispose()
    controller.abort()
    const result = await session.result
    expect(process.kills()).toBe(1)
    expect(releases).toBe(1)
    expect(result.exitCode).toBe(143)
    expect(result.diagnostic.length).toBeLessThanOrEqual(8_195)
    expect(result.diagnostic).toStartWith('a')
    expect(result.diagnostic).toEndWith('z')
  })

  test('constructs typed non-zero and no-frame failures with retry diagnostics', () => {
    const failed = createFfmpegProcessError({ diagnostic: '', exitCode: 9 })
    expect(failed).toMatchObject({ diagnostic: '', exitCode: 9, name: 'FfmpegProcessError' })
    expect(failed.message).toBe('FFmpeg media playback failed with exit code 9.')

    const noFrames = createFfmpegProcessError({ diagnostic: '', exitCode: 0 })
    expect(noFrames).toMatchObject({ diagnostic: '', exitCode: 0 })
    expect(noFrames.message).toBe('FFmpeg produced no media frames.')

    const diagnostic = createFfmpegProcessError({ diagnostic: 'decoder unavailable', exitCode: 1 })
    expect(diagnostic.message).toBe('decoder unavailable')
    expect(diagnostic.diagnostic).toBe('decoder unavailable')
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

  test('returns timestamps and unlocks their stream after normal video exhaustion', async () => {
    const tracked = trackedTimestampStream([0, 40])
    const frames = await Array.fromAsync(
      assembleRawVideoFrames(chunks([[1, 2, 3, 4]]), tracked.timestamps, {
        width: 1,
        height: 1,
      }),
    )
    for (const frame of frames) frame.release()

    expect(tracked.finalizers()).toBe(1)
    expect(tracked.stream.locked).toBe(false)
  })

  test('returns timestamps after failure without masking the decode error', async () => {
    const tracked = trackedTimestampStream([0, 40], new Error('timestamp cleanup failed'))
    const frames = assembleRawVideoFrames(chunks([[1, 2, 3, 4, 5, 6, 7]]), tracked.timestamps, {
      width: 1,
      height: 1,
    })
    const first = await frames.next()
    if (!first.done) first.value.release()

    await expect(frames.next()).rejects.toThrow('partial video frame')
    expect(tracked.finalizers()).toBe(1)
    expect(tracked.stream.locked).toBe(false)
  })

  test('returns timestamps and unlocks their stream after cancellation', async () => {
    const controller = new AbortController()
    const tracked = trackedTimestampStream([0, 40])
    const frames = assembleRawVideoFrames(
      chunks([
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ]),
      tracked.timestamps,
      { width: 1, height: 1 },
      controller.signal,
    )
    const first = await frames.next()
    if (!first.done) first.value.release()
    controller.abort()

    expect(await frames.next()).toEqual({ done: true, value: undefined })
    expect(tracked.finalizers()).toBe(1)
    expect(tracked.stream.locked).toBe(false)
  })

  test('returns timestamps and unlocks their stream after an early consumer return', async () => {
    const tracked = trackedTimestampStream([0, 40])
    const frames = assembleRawVideoFrames(
      chunks([
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ]),
      tracked.timestamps,
      { width: 1, height: 1 },
    )
    const first = await frames.next()
    if (!first.done) first.value.release()
    await frames.return(undefined)

    expect(tracked.finalizers()).toBe(1)
    expect(tracked.stream.locked).toBe(false)
  })
})
