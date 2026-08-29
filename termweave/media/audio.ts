import { setupAudio, type Audio, type AudioStream, type AudioStreamBody } from '@opentui/core'
import { MediaPlaybackClock } from './playback'

// Audio owns shared engine leases, FFmpeg pipe consumption/draining, and native stream lifecycle.
const AUDIO_START_TIMEOUT_MS = 3_000
const AUDIO_READY_POLL_MS = 5
const AUDIO_BUFFER = {
  capacityMs: 1_000,
  startupMs: 250,
  resumeMs: 500,
} as const

export interface AudioEngineLease {
  audio: Audio
  release(): void
}

export interface MediaAudioSession {
  clock: MediaPlaybackClock
  dispose(): void
}

interface StartMediaAudioOptions {
  acquireAudioEngine?: () => AudioEngineLease
  body: AudioStreamBody
  onClockFallback?: () => void
  onFailure?: (error: unknown) => void
  signal: AbortSignal
  startTimeout?: (pending: Promise<AudioStream>) => Promise<AudioStream>
  volume?: number
  waitUntilPlaying?: (stream: Pick<AudioStream, 'getStats'>, signal: AbortSignal) => Promise<void>
}

function ignoreAudioError() {}

export function createAudioEnginePool(
  createAudio: () => Audio = () => setupAudio({ autoStart: true }),
) {
  let audio: Audio | undefined
  let references = 0
  return {
    acquire(): AudioEngineLease {
      audio ??= createAudio()
      if (references === 0) audio.on('error', ignoreAudioError)
      references += 1
      const leasedAudio = audio
      let released = false
      return {
        audio: leasedAudio,
        release: () => {
          if (released) return
          released = true
          references -= 1
          if (references > 0 || audio !== leasedAudio) return
          audio = undefined
          leasedAudio.off('error', ignoreAudioError)
          leasedAudio.dispose()
        },
      }
    },
  }
}

export const sharedAudioEngine = createAudioEnginePool()

export function createDrainableAudioBody(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let state: 'idle' | 'consuming' | 'abandoned' | 'draining' | 'done' = 'idle'
  let drainRequested = false
  let drainCompletion: Promise<void> | undefined
  let resolveDrain: (() => void) | undefined
  let lockReleased = false

  const releaseLock = () => {
    if (lockReleased) return
    lockReleased = true
    reader.releaseLock()
  }
  const finish = () => {
    state = 'done'
    releaseLock()
    resolveDrain?.()
    resolveDrain = undefined
  }
  const ensureDrainCompletion = () => {
    drainCompletion ??= new Promise<void>((resolve) => {
      resolveDrain = resolve
    })
    return drainCompletion
  }
  const startDrain = () => {
    if (state === 'draining' || state === 'done') return
    state = 'draining'
    void (async () => {
      try {
        while (!(await reader.read()).done) {
          // Discard audio only when no playback consumer owns the descriptor.
        }
      } catch {
        // FFmpeg may close the descriptor while the fallback drain is active.
      } finally {
        finish()
      }
    })()
  }

  const drain = () => {
    drainRequested = true
    if (state === 'done') return Promise.resolve()
    const completion = ensureDrainCompletion()
    if (state === 'idle' || state === 'abandoned') startDrain()
    return completion
  }

  const body: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      if (state !== 'idle') throw new Error('The FFmpeg audio pipe can be consumed only once.')
      state = 'consuming'
      let completed = false
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) {
            completed = true
            finish()
            return
          }
          yield result.value
        }
      } finally {
        if (!completed && state === 'consuming') {
          state = 'abandoned'
          if (drainRequested) startDrain()
        }
      }
    },
  }
  return { body, drain }
}

async function withTimeout<T>(pending: Promise<T>, timeoutMs = AUDIO_START_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Media audio did not start in time.')), timeoutMs)
      timer.unref?.()
    })
    return await Promise.race([pending, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForPlayback(stream: Pick<AudioStream, 'getStats'>, signal: AbortSignal) {
  while (!signal.aborted) {
    const stats = stream.getStats()
    if (stats.state === 'playing') return
    if (stats.state === 'ended' || stats.state === 'errored' || stats.state === 'disposed') {
      throw new Error(`Media audio entered the ${stats.state} state before playback started.`)
    }
    await Bun.sleep(AUDIO_READY_POLL_MS)
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Media audio startup was cancelled.', 'AbortError')
}

async function withAbort<T>(pending: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Media audio startup was cancelled.', 'AbortError')
  }
  let handleAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    handleAbort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Media audio startup was cancelled.', 'AbortError'),
      )
    signal.addEventListener('abort', handleAbort, { once: true })
  })
  try {
    return await Promise.race([pending, aborted])
  } finally {
    if (handleAbort) signal.removeEventListener('abort', handleAbort)
  }
}

export async function startMediaAudio(options: StartMediaAudioOptions): Promise<MediaAudioSession> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(options.signal.reason)
  options.signal.addEventListener('abort', forwardAbort, { once: true })
  if (options.signal.aborted) forwardAbort()

  let lease: AudioEngineLease | undefined
  let stream: AudioStream | undefined
  let startingStream: AudioStream | undefined
  let startingStreamDisposed = false
  const disposeStartingStream = () => {
    if (!startingStream || startingStreamDisposed) return
    startingStreamDisposed = true
    startingStream.dispose()
  }
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new DOMException('Media audio startup was cancelled.', 'AbortError')
    }
    lease = (options.acquireAudioEngine ?? (() => sharedAudioEngine.acquire()))()
    const startTimeout = options.startTimeout ?? withTimeout
    const waitUntilPlaying = options.waitUntilPlaying ?? waitForPlayback
    stream = await startTimeout(
      withAbort(
        (async () => {
          const opened = await lease!.audio.playStream(options.body, {
            buffer: AUDIO_BUFFER,
            format: 'flac',
            signal: controller.signal,
            volume: options.volume ?? 1,
          })
          startingStream = opened
          try {
            await waitUntilPlaying(opened, controller.signal)
            return opened
          } catch (error) {
            disposeStartingStream()
            throw error
          }
        })(),
        controller.signal,
      ),
    )
    startingStream = undefined
  } catch (error) {
    controller.abort()
    options.signal.removeEventListener('abort', forwardAbort)
    disposeStartingStream()
    lease?.release()
    throw error
  }

  const activeStream = stream
  const activeLease = lease
  let disposed = false
  const clock = new MediaPlaybackClock({
    audio: activeStream,
    onAudioFallback: options.onClockFallback,
  })
  const release = (failure?: unknown) => {
    if (disposed) return
    disposed = true
    activeStream.off('error', handleError)
    activeStream.off('ended', handleEnded)
    options.signal.removeEventListener('abort', handleAbort)
    options.signal.removeEventListener('abort', forwardAbort)
    clock.detachAudio()
    controller.abort()
    activeStream.dispose()
    activeLease.release()
    if (failure !== undefined && !options.signal.aborted) options.onFailure?.(failure)
  }
  const handleAbort = () => release()
  const handleError = (error: Error) => release(error)
  const handleEnded = () => release()
  activeStream.on('error', handleError)
  activeStream.on('ended', handleEnded)
  options.signal.addEventListener('abort', handleAbort, { once: true })
  if (options.signal.aborted) release()

  return {
    clock,
    dispose: release,
  }
}
