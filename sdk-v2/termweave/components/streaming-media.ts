import { applyCrtPalette } from '../host/crt-effects/crt-palette'
import { startMediaAudio, type MediaAudioSession } from './media-audio'
import {
  isMissingAudioDiagnostic,
  isVideoToolboxDiagnostic,
  openFfmpegMediaSession,
  type FfmpegMediaSession,
  type TimedVideoFrame,
} from './media-process'
import { MediaPlaybackClock, StreamingFrameCoordinator } from './media-playback'
import { resolveMediaSource, type ResolvedMediaSource } from './image-source'
import { rgbaByteLength, type AnimationFrame, type Dimensions, type Rgb } from './pixel-frame'

const MAX_REMOTE_RETRIES = 3
const REMOTE_RETRY_DELAYS_MS = [100, 250, 500] as const
const DISPLAY_BUFFER_POOL_SIZE = 2

export interface StreamingMediaRequest {
  background: Rgb
  maximum: Dimensions
  uri: string
}

export interface StreamingMediaPlaybackOptions {
  ffmpegPath?: string
  onError(error: unknown): void
  onFrame(frame: AnimationFrame): void
}

class MediaAttemptError extends Error {
  constructor(
    message: string,
    readonly diagnostic: string,
  ) {
    super(message)
  }
}

const activePlaybackStops = new Set<() => void>()

export function usesStreamingMediaPipeline(uri: string) {
  const value = uri.trim()
  if (/^(?:https?|media):/i.test(value)) return true
  let path = value
  if (value.startsWith('file:')) {
    try {
      path = new URL(value).pathname
    } catch {
      return false
    }
  }
  return /\.mp4(?:$|[?#])/i.test(path)
}

function createDisplayFrame(
  source: TimedVideoFrame,
  background: Rgb,
  pool: Uint8Array[],
): AnimationFrame {
  const byteLength = rgbaByteLength(source)
  const data = pool.pop() ?? new Uint8Array(byteLength)
  try {
    for (let offset = 0; offset < byteLength; offset += 4) {
      const alpha = source.data[offset + 3]! / 255
      data[offset] = Math.round(source.data[offset]! * alpha + background[0] * (1 - alpha))
      data[offset + 1] = Math.round(source.data[offset + 1]! * alpha + background[1] * (1 - alpha))
      data[offset + 2] = Math.round(source.data[offset + 2]! * alpha + background[2] * (1 - alpha))
      data[offset + 3] = 255
    }
    applyCrtPalette(data)
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
  }
}

function createDrainableAudioBody(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let state: 'idle' | 'consuming' | 'draining' | 'done' = 'idle'
  let drainRequested = false

  const drain = () => {
    drainRequested = true
    if (state !== 'idle') return
    state = 'draining'
    void (async () => {
      try {
        while (!(await reader.read()).done) {
          // Discard audio only after playback initialization has failed.
        }
      } catch {
        // FFmpeg may close the descriptor while the fallback drain is active.
      } finally {
        state = 'done'
        reader.releaseLock()
      }
    })()
  }

  const body: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      if (state !== 'idle') throw new Error('The FFmpeg audio pipe can be consumed only once.')
      state = 'consuming'
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) {
            state = 'done'
            return
          }
          yield result.value
        }
      } finally {
        if (state !== 'done') state = 'idle'
        if (state === 'done') reader.releaseLock()
        else if (drainRequested) drain()
      }
    },
  }
  return { body, drain }
}

function processFailure(result: { diagnostic: string; exitCode: number }) {
  const message =
    result.diagnostic ||
    (result.exitCode === 0
      ? 'FFmpeg produced no media frames.'
      : `FFmpeg media playback failed with exit code ${result.exitCode}.`)
  return new MediaAttemptError(message, result.diagnostic)
}

async function playSession(
  source: ResolvedMediaSource,
  request: StreamingMediaRequest,
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

  try {
    session = await openFfmpegMediaSession({
      source,
      width: request.maximum.width,
      height: request.maximum.height,
      background: request.background,
      ffmpegPath: options.ffmpegPath,
      hardwareAcceleration,
      signal,
      withAudio,
    })

    let audioFailure: unknown
    let startAudio: Promise<MediaAudioSession | undefined> = Promise.resolve(undefined)
    if (session.audio) {
      const audioPipe = createDrainableAudioBody(session.audio)
      drainAudio = audioPipe.drain
      startAudio = startMediaAudio({
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
    if (firstFrame.done) {
      const result = await session.result
      throw processFailure(result)
    }
    if (audioFailure !== undefined && !signal.aborted) {
      console.warn(
        `Termweave media audio is unavailable; continuing silently: ${String(audioFailure)}`,
      )
    }

    const clock = audioSession?.clock ?? new MediaPlaybackClock()
    coordinator = new StreamingFrameCoordinator<TimedVideoFrame>({
      clock,
      onPresent: (frame) =>
        options.onFrame(createDisplayFrame(frame, request.background, displayPool)),
    })
    coordinator.push(firstFrame.value)

    if (!source.loop) {
      session.dispose()
      return { audioUnavailable: audioFailure !== undefined }
    }

    for await (const frame of session.frames) coordinator.push(frame)
    const result = await session.result
    if (!signal.aborted && result.exitCode !== 0) throw processFailure(result)
    return { audioUnavailable: audioFailure !== undefined }
  } finally {
    coordinator?.dispose()
    audioSession?.dispose()
    drainAudio()
    session?.dispose()
    await session?.result.catch(() => {})
  }
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
  request: StreamingMediaRequest,
  options: StreamingMediaPlaybackOptions,
  signal: AbortSignal,
) {
  const source = await resolveMediaSource(request.uri)
  if (source.pipeline !== 'ffmpeg') {
    throw new Error('The resolved source does not require streaming media playback.')
  }

  let hardwareAcceleration = source.format === 'mp4'
  let withAudio = source.format === 'mp4'
  let remoteFailures = 0

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
      const diagnostic = error instanceof MediaAttemptError ? error.diagnostic : String(error)
      if (withAudio && isMissingAudioDiagnostic(diagnostic)) {
        withAudio = false
        continue
      }
      if (hardwareAcceleration && isVideoToolboxDiagnostic(diagnostic)) {
        hardwareAcceleration = false
        continue
      }
      if (
        error instanceof MediaAttemptError &&
        source.kind === 'remote' &&
        remoteFailures < MAX_REMOTE_RETRIES
      ) {
        const delay = REMOTE_RETRY_DELAYS_MS[remoteFailures]!
        remoteFailures += 1
        await waitForRetry(signal, delay)
        continue
      }
      throw error
    }
  }
}

export function startStreamingMediaPlayback(
  request: StreamingMediaRequest,
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

  void runStreamingPlayback(request, options, controller.signal)
    .catch((error: unknown) => {
      if (!controller.signal.aborted) options.onError(error)
    })
    .finally(() => activePlaybackStops.delete(stop))
  return stop
}

export function disposeAllStreamingMediaPlayback() {
  for (const stop of [...activePlaybackStops]) stop()
}
