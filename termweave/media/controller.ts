import { createDrainableAudioBody, startMediaAudio, type MediaAudioSession } from './audio'
import type { Rgb } from '../color'
import {
  isMissingAudioDiagnostic,
  isVideoToolboxDiagnostic,
  createFfmpegProcessError,
  FfmpegProcessError,
  openFfmpegMediaSession,
  type FfmpegMediaSession,
  type TimedVideoFrame,
} from './ffmpeg'
import { compositeRgbaInto, rgbaByteLength, type AnimationFrame, type Dimensions } from './frame'
import {
  getCachedLocalImageFrames,
  loadResolvedLocalImageFrames,
  MediaPlaybackClock,
  startFramePlayback,
  StreamingFrameCoordinator,
} from './playback'
import {
  createMediaAbortError,
  isAbortError,
  resolveMediaSource,
  type ResolvedMediaSource,
} from './source'

// Controller is the sole owner of request replacement, cancellation, retry, and publication.
const MAX_REMOTE_RETRIES = 3
const REMOTE_RETRY_DELAYS_MS = [100, 250, 500] as const
const DISPLAY_BUFFER_POOL_SIZE = 2

export interface MediaRequest {
  uri: string
  maximum: Dimensions
  background: Rgb
}

export interface StreamingMediaPlaybackOptions {
  ffmpegPath?: string
  onComplete?: () => void
  onError(error: unknown): void
  onFrame(frame: AnimationFrame): void
  openSession?: typeof openFfmpegMediaSession
  retryDelaysMs?: readonly number[]
  startAudio?: typeof startMediaAudio
  waitForRetry?: (signal: AbortSignal, delayMs: number) => Promise<void>
}

export interface MediaControllerOptions {
  onError(error: unknown | undefined): void
  onFrame(frame: AnimationFrame | undefined): void
  getCached?: typeof getCachedLocalImageFrames
  load?: typeof loadResolvedLocalImageFrames
  play?: typeof startFramePlayback
  resolve?: typeof resolveMediaSource
  stream?: typeof startStreamingMediaPlayback
}

const activePlaybackStops = new Set<() => void>()

function createDisplayFrame(source: TimedVideoFrame, background: Rgb, pool: Uint8Array[]) {
  const byteLength = rgbaByteLength(source)
  const data = pool.pop() ?? new Uint8Array(byteLength)
  try {
    compositeRgbaInto(source.data, data, background)
  } finally {
    source.release()
  }

  let released = false
  return {
    width: source.width,
    height: source.height,
    data,
    delayMs: 0,
    release: () => {
      if (released) return
      released = true
      if (pool.length < DISPLAY_BUFFER_POOL_SIZE) pool.push(data)
    },
  } satisfies AnimationFrame
}

async function playSession(
  source: ResolvedMediaSource,
  request: MediaRequest,
  options: StreamingMediaPlaybackOptions,
  signal: AbortSignal,
  hardwareAcceleration: boolean,
  withAudio: boolean,
) {
  let session: FfmpegMediaSession | undefined
  let audioSession: MediaAudioSession | undefined
  let coordinator: StreamingFrameCoordinator<TimedVideoFrame> | undefined
  let drainAudio = () => {}
  const displayPool: Uint8Array[] = []
  let outcome: { audioUnavailable: boolean } | undefined
  let cleanupFailed = false
  let cleanupError: unknown

  try {
    playback: {
      session = await (options.openSession ?? openFfmpegMediaSession)({
        source,
        width: request.maximum.width,
        height: request.maximum.height,
        background: request.background,
        ffmpegPath: options.ffmpegPath,
        hardwareAcceleration,
        realtime: true,
        signal,
        withAudio,
      })

      let audioFailure: unknown
      let startAudio: Promise<MediaAudioSession | undefined> = Promise.resolve(undefined)
      if (session.audio) {
        const audioPipe = createDrainableAudioBody(session.audio)
        drainAudio = audioPipe.drain
        startAudio = (options.startAudio ?? startMediaAudio)({
          body: audioPipe.body,
          signal,
          onClockFallback: () => coordinator?.flush(),
          onFailure: (error) => {
            if (!signal.aborted) console.warn(`Termweave media audio stopped: ${String(error)}`)
          },
        }).catch((error: unknown) => {
          audioFailure = error
          audioPipe.drain()
          return undefined
        })
      }

      const [firstFrame, startedAudio] = await Promise.all([session.frames.next(), startAudio])
      audioSession = startedAudio
      if (signal.aborted) {
        if (!firstFrame.done) firstFrame.value.release()
        outcome = { audioUnavailable: audioFailure !== undefined }
        break playback
      }
      if (firstFrame.done) throw createFfmpegProcessError(await session.result)
      if (audioFailure !== undefined) {
        console.warn(
          `Termweave media audio is unavailable; continuing silently: ${String(audioFailure)}`,
        )
      }

      coordinator = new StreamingFrameCoordinator<TimedVideoFrame>({
        clock: audioSession?.clock ?? new MediaPlaybackClock(),
        onPresent: (frame) =>
          options.onFrame(createDisplayFrame(frame, request.background, displayPool)),
      })
      coordinator.push(firstFrame.value)

      if (!source.loop) {
        outcome = { audioUnavailable: audioFailure !== undefined }
        break playback
      }
      for await (const frame of session.frames) coordinator.push(frame)
      const result = await session.result
      if (!signal.aborted && result.exitCode !== 0) throw createFfmpegProcessError(result)
      outcome = { audioUnavailable: audioFailure !== undefined }
    }
  } finally {
    const cleanup = async (operation: () => void | Promise<void>) => {
      try {
        await operation()
      } catch (error) {
        if (cleanupFailed) return
        cleanupFailed = true
        cleanupError = error
      }
    }

    // Release iterator readers before stopping the process, then unwind downstream owners in order.
    await cleanup(async () => {
      await session?.frames.return(undefined)
    })
    await cleanup(() => session?.dispose())
    await cleanup(() => audioSession?.dispose())
    await cleanup(() => coordinator?.dispose())
    await cleanup(() => drainAudio())
    await cleanup(async () => {
      await session?.result.catch(() => {})
    })
  }
  if (cleanupFailed) throw cleanupError
  return outcome!
}

async function waitForRetry(signal: AbortSignal, delayMs: number) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, delayMs)
    const abort = () => finish()
    function finish() {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) finish()
  })
}

async function runStreamingPlayback(
  source: ResolvedMediaSource,
  request: MediaRequest,
  options: StreamingMediaPlaybackOptions,
  signal: AbortSignal,
) {
  let hardwareAcceleration = source.format === 'mp4'
  let withAudio = source.format === 'mp4'
  let remoteFailures = 0
  const retryDelays = options.retryDelaysMs ?? REMOTE_RETRY_DELAYS_MS

  while (!signal.aborted) {
    try {
      const result = await playSession(
        source,
        request,
        options,
        signal,
        hardwareAcceleration,
        withAudio,
      )
      if (result.audioUnavailable) withAudio = false
      if (!source.loop || signal.aborted) return
      remoteFailures = 0
    } catch (error) {
      if (signal.aborted) return
      const diagnostic = error instanceof FfmpegProcessError ? error.diagnostic : String(error)
      if (withAudio && isMissingAudioDiagnostic(diagnostic)) {
        withAudio = false
        continue
      }
      if (hardwareAcceleration && isVideoToolboxDiagnostic(diagnostic)) {
        hardwareAcceleration = false
        continue
      }
      if (
        error instanceof FfmpegProcessError &&
        source.kind === 'remote' &&
        remoteFailures < Math.min(MAX_REMOTE_RETRIES, retryDelays.length)
      ) {
        const delay = retryDelays[remoteFailures]!
        remoteFailures += 1
        await (options.waitForRetry ?? waitForRetry)(signal, delay)
        continue
      }
      throw error
    }
  }
}

export function startStreamingMediaPlayback(
  source: ResolvedMediaSource,
  request: MediaRequest,
  options: StreamingMediaPlaybackOptions,
) {
  const controller = new AbortController()
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    activePlaybackStops.delete(stop)
    controller.abort(new DOMException('Media playback was cancelled.', 'AbortError'))
  }
  activePlaybackStops.add(stop)
  void runStreamingPlayback(source, request, options, controller.signal)
    .catch((error: unknown) => {
      if (!controller.signal.aborted) options.onError(error)
    })
    .finally(() => {
      activePlaybackStops.delete(stop)
      options.onComplete?.()
    })
  return stop
}

export function disposeAllStreamingMediaPlayback() {
  for (const stop of [...activePlaybackStops]) stop()
}

export function createMediaPlaybackController({
  onError,
  onFrame,
  getCached = getCachedLocalImageFrames,
  load = loadResolvedLocalImageFrames,
  play = startFramePlayback,
  resolve = resolveMediaSource,
  stream = startStreamingMediaPlayback,
}: MediaControllerOptions) {
  let abortController: AbortController | undefined
  let stopPlayback: (() => void) | undefined
  let generation = 0
  let disposed = false
  let currentFrame: AnimationFrame | undefined

  const showFrame = (frame: AnimationFrame | undefined) => {
    const previous = currentFrame
    currentFrame = frame
    onFrame(frame)
    if (previous !== frame) previous?.release?.()
  }

  const cancel = () => {
    generation += 1
    abortController?.abort(createMediaAbortError())
    abortController = undefined
    stopPlayback?.()
    stopPlayback = undefined
  }

  const replace = (request: MediaRequest) => {
    if (disposed) return
    cancel()
    onError(undefined)
    const uri = request.uri.trim()
    if (!uri) {
      showFrame(undefined)
      onError(new Error('Media URI is required.'))
      return
    }
    if (request.maximum.width < 2 || request.maximum.height < 2) return

    const requestGeneration = generation
    const publishFrame = (frame: AnimationFrame) => {
      if (!disposed && requestGeneration === generation) showFrame(frame)
      else frame.release?.()
    }
    const beginPlayback = (frames: readonly AnimationFrame[]) => {
      if (disposed || requestGeneration !== generation) return
      stopPlayback = play(frames, publishFrame, {
        onError: (error) => {
          if (!disposed && requestGeneration === generation) onError(error)
        },
      })
    }

    const cached = getCached(uri, request.maximum, request.background)
    if (cached) {
      try {
        beginPlayback(cached)
      } catch (error) {
        onError(error)
      }
      return
    }

    const controller = new AbortController()
    abortController = controller
    void resolve(uri)
      .then(async (source) => {
        if (disposed || controller.signal.aborted || requestGeneration !== generation) return
        if (source.kind === 'remote' || source.format === 'mp4') {
          abortController = undefined
          stopPlayback = stream(source, request, {
            onError: (error) => {
              if (!disposed && requestGeneration === generation) onError(error)
            },
            onFrame: publishFrame,
          })
          return
        }
        const frames = await load(source, request.maximum, request.background, controller.signal)
        if (disposed || controller.signal.aborted || requestGeneration !== generation) return
        abortController = undefined
        beginPlayback(frames)
      })
      .catch((error: unknown) => {
        if (
          disposed ||
          controller.signal.aborted ||
          requestGeneration !== generation ||
          isAbortError(error)
        ) {
          return
        }
        abortController = undefined
        onError(error)
      })
  }

  return {
    replace,
    dispose() {
      if (disposed) return
      disposed = true
      cancel()
      showFrame(undefined)
    },
  }
}
