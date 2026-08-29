import { describe, expect, test } from 'bun:test'
import { startStreamingMediaPlayback, type MediaRequest } from '../termweave/media/controller'
import type {
  FfmpegMediaSession,
  FfmpegProcessResult,
  OpenFfmpegMediaSessionOptions,
  TimedVideoFrame,
} from '../termweave/media/ffmpeg'
import type { ResolvedMediaSource } from '../termweave/media/source'
import { Deferred } from './support/deferred'

const request: MediaRequest = {
  uri: '/movie.mp4',
  maximum: { width: 2, height: 2 },
  background: [0, 0, 0],
}

function mediaSource(overrides: Partial<ResolvedMediaSource> = {}): ResolvedMediaSource {
  return {
    format: 'mp4',
    input: '/movie.mp4',
    kind: 'local',
    loop: true,
    uri: '/movie.mp4',
    ...overrides,
  }
}

function timedFrame(ptsMs = 0) {
  let releases = 0
  const frame: TimedVideoFrame = {
    width: 2,
    height: 2,
    data: new Uint8Array(16).fill(7),
    ptsMs,
    release() {
      releases += 1
    },
  }
  return { frame, releases: () => releases }
}

function fakeSession({
  audio,
  frames = [],
  result = { diagnostic: '', exitCode: 0 },
}: {
  audio?: ReadableStream<Uint8Array>
  frames?: readonly TimedVideoFrame[]
  result?: FfmpegProcessResult
} = {}) {
  let disposals = 0
  let frameReturns = 0
  const session: FfmpegMediaSession = {
    audio,
    frames: (async function* () {
      try {
        for (const frame of frames) yield frame
      } finally {
        frameReturns += 1
      }
    })(),
    result: Promise.resolve(result),
    dispose() {
      disposals += 1
    },
  }
  return { disposals: () => disposals, frameReturns: () => frameReturns, session }
}

function completionHarness() {
  const completed = new Deferred<void>()
  const errors: unknown[] = []
  return {
    completed,
    errors,
    options: {
      onComplete: () => completed.resolve(),
      onError: (error: unknown) => errors.push(error),
      onFrame: (frame: { release?: () => void }) => frame.release?.(),
    },
  }
}

describe('streaming media retry and fallback lifecycle', () => {
  test('retries missing audio silently, then publishes the first video frame', async () => {
    const harness = completionHarness()
    const attempts: OpenFfmpegMediaSessionOptions[] = []
    const sessions = [
      fakeSession({ result: { diagnostic: 'Stream map 0:a:0 matches no streams', exitCode: 1 } }),
      fakeSession({ frames: [timedFrame().frame] }),
    ]
    const stop = startStreamingMediaPlayback(mediaSource(), request, {
      ...harness.options,
      onFrame: (frame) => {
        frame.release?.()
        stop()
      },
      openSession: async (options) => {
        attempts.push(options)
        return sessions.shift()!.session
      },
    })

    await harness.completed.promise
    expect(attempts.map((attempt) => attempt.withAudio)).toEqual([true, false])
    expect(attempts.map((attempt) => attempt.hardwareAcceleration)).toEqual([true, true])
    expect(harness.errors).toEqual([])
  })

  test('falls back from VideoToolbox to software without changing audio policy', async () => {
    const harness = completionHarness()
    const attempts: OpenFfmpegMediaSessionOptions[] = []
    const sessions = [
      fakeSession({ result: { diagnostic: 'VideoToolbox hardware device failed', exitCode: 1 } }),
      fakeSession({ frames: [timedFrame().frame] }),
    ]
    const stop = startStreamingMediaPlayback(mediaSource(), request, {
      ...harness.options,
      onFrame: (frame) => {
        frame.release?.()
        stop()
      },
      openSession: async (options) => {
        attempts.push(options)
        return sessions.shift()!.session
      },
    })

    await harness.completed.promise
    expect(attempts.map((attempt) => attempt.hardwareAcceleration)).toEqual([true, false])
    expect(attempts.map((attempt) => attempt.withAudio)).toEqual([true, true])
    expect(harness.errors).toEqual([])
  })

  test('bounds remote retry delays and attempts before publishing one terminal error', async () => {
    const harness = completionHarness()
    const delays: number[] = []
    let attempts = 0
    startStreamingMediaPlayback(
      mediaSource({ input: 'https://example.test/movie.mp4', kind: 'remote' }),
      request,
      {
        ...harness.options,
        openSession: async () => {
          attempts += 1
          return fakeSession({
            result: { diagnostic: 'remote connection failed', exitCode: 1 },
          }).session
        },
        retryDelaysMs: [10, 20, 30, 40],
        waitForRetry: async (_signal, delay) => {
          delays.push(delay)
        },
      },
    )

    await harness.completed.promise
    expect(attempts).toBe(4)
    expect(delays).toEqual([10, 20, 30])
    expect(harness.errors).toHaveLength(1)
    expect(String(harness.errors[0])).toContain('remote connection failed')
  })

  test('restarts a completed loop and disposes every session exactly once', async () => {
    const harness = completionHarness()
    const firstFrame = timedFrame()
    const secondFrame = timedFrame()
    const sessions = [
      fakeSession({ frames: [firstFrame.frame] }),
      fakeSession({ frames: [secondFrame.frame] }),
    ]
    let attempts = 0
    const stop = startStreamingMediaPlayback(mediaSource(), request, {
      ...harness.options,
      onFrame: (frame) => {
        frame.release?.()
        if (attempts === 2) stop()
      },
      openSession: async () => {
        const next = sessions[attempts]!
        attempts += 1
        return next.session
      },
    })

    await harness.completed.promise
    expect(attempts).toBe(2)
    expect(sessions.map((session) => session.disposals())).toEqual([1, 1])
    expect(sessions.map((session) => session.frameReturns())).toEqual([1, 1])
    expect(firstFrame.releases()).toBe(1)
    expect(secondFrame.releases()).toBe(1)
    expect(harness.errors).toEqual([])
  })
})

describe('streaming media cancellation and terminal paths', () => {
  test('holds one first frame for a non-looping source and reports a no-frame exit', async () => {
    const firstHarness = completionHarness()
    const firstFrame = timedFrame()
    const firstSession = fakeSession({ frames: [firstFrame.frame] })
    startStreamingMediaPlayback(
      mediaSource({ format: 'png', loop: false }),
      { ...request, uri: '/still.png' },
      {
        ...firstHarness.options,
        openSession: async () => firstSession.session,
      },
    )
    await firstHarness.completed.promise
    expect(firstFrame.releases()).toBe(1)
    expect(firstSession.disposals()).toBe(1)
    expect(firstSession.frameReturns()).toBe(1)
    expect(firstHarness.errors).toEqual([])

    const emptyHarness = completionHarness()
    const emptySession = fakeSession()
    startStreamingMediaPlayback(
      mediaSource({ format: 'png', loop: false }),
      { ...request, uri: '/empty.png' },
      {
        ...emptyHarness.options,
        openSession: async () => emptySession.session,
      },
    )
    await emptyHarness.completed.promise
    expect(emptyHarness.errors).toHaveLength(1)
    expect(String(emptyHarness.errors[0])).toContain('produced no media frames')
    expect(emptySession.disposals()).toBe(1)
    expect(emptySession.frameReturns()).toBe(1)
  })

  test('cancels while opening a session and cleans a session that arrives late', async () => {
    const harness = completionHarness()
    const opened = new Deferred<FfmpegMediaSession>()
    const sourceFrame = timedFrame()
    const session = fakeSession({ frames: [sourceFrame.frame] })
    const stop = startStreamingMediaPlayback(mediaSource(), request, {
      ...harness.options,
      openSession: () => opened.promise,
    })
    stop()
    opened.resolve(session.session)

    await harness.completed.promise
    expect(session.disposals()).toBe(1)
    expect(session.frameReturns()).toBe(1)
    expect(sourceFrame.releases()).toBe(1)
    expect(harness.errors).toEqual([])
  })

  test('cancels audio startup without an error or retained FFmpeg session', async () => {
    const harness = completionHarness()
    const audioStarted = new Deferred<void>()
    const sourceFrame = timedFrame()
    const audio = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    const session = fakeSession({ audio, frames: [sourceFrame.frame] })
    const stop = startStreamingMediaPlayback(mediaSource(), request, {
      ...harness.options,
      openSession: async () => session.session,
      startAudio: async ({ signal }) => {
        audioStarted.resolve()
        await new Promise<never>((_resolve, reject) => {
          const abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })
        throw new Error('unreachable')
      },
    })
    await audioStarted.promise
    stop()

    await harness.completed.promise
    expect(session.disposals()).toBe(1)
    expect(session.frameReturns()).toBe(1)
    expect(sourceFrame.releases()).toBe(1)
    expect(harness.errors).toEqual([])
  })

  test('preserves a primary playback failure when frame cleanup also fails', async () => {
    const harness = completionHarness()
    const sourceFrame = timedFrame()
    const playbackError = new Error('primary playback failure')
    let nextCalls = 0
    let frameReturns = 0
    let disposals = 0
    const frames = {
      async next() {
        nextCalls += 1
        if (nextCalls === 1) return { done: false as const, value: sourceFrame.frame }
        throw playbackError
      },
      async return() {
        frameReturns += 1
        throw new Error('frame cleanup failed')
      },
      async throw(error?: unknown) {
        throw error
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } as unknown as AsyncGenerator<TimedVideoFrame>
    const session: FfmpegMediaSession = {
      audio: undefined,
      frames,
      result: Promise.resolve({ diagnostic: '', exitCode: 1 }),
      dispose() {
        disposals += 1
      },
    }
    startStreamingMediaPlayback(mediaSource(), request, {
      ...harness.options,
      openSession: async () => session,
    })

    await harness.completed.promise
    expect(harness.errors).toEqual([playbackError])
    expect(frameReturns).toBe(1)
    expect(disposals).toBe(1)
    expect(sourceFrame.releases()).toBe(1)
  })

  test('cancels a pending remote retry delay without starting another attempt', async () => {
    const harness = completionHarness()
    const waiting = new Deferred<void>()
    let attempts = 0
    const stop = startStreamingMediaPlayback(
      mediaSource({ input: 'https://example.test/movie.mp4', kind: 'remote' }),
      request,
      {
        ...harness.options,
        openSession: async () => {
          attempts += 1
          return fakeSession({ result: { diagnostic: 'network failed', exitCode: 1 } }).session
        },
        waitForRetry: async (signal) => {
          waiting.resolve()
          await new Promise<void>((resolve) => {
            const abort = () => resolve()
            signal.addEventListener('abort', abort, { once: true })
            if (signal.aborted) abort()
          })
        },
      },
    )
    await waiting.promise
    stop()

    await harness.completed.promise
    expect(attempts).toBe(1)
    expect(harness.errors).toEqual([])
  })
})
