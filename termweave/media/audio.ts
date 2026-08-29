import { setupAudio, type Audio, type AudioStream, type AudioStreamBody } from '@opentui/core'
import { MediaPlaybackClock } from './playback'

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
  body: AudioStreamBody
  onClockFallback?: () => void
  onFailure?: (error: unknown) => void
  signal: AbortSignal
  volume?: number
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

export async function startMediaAudio(options: StartMediaAudioOptions): Promise<MediaAudioSession> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(options.signal.reason)
  options.signal.addEventListener('abort', forwardAbort, { once: true })
  if (options.signal.aborted) forwardAbort()

  let lease: AudioEngineLease | undefined
  let stream: AudioStream | undefined
  try {
    lease = sharedAudioEngine.acquire()
    stream = await withTimeout(
      (async () => {
        const opened = await lease!.audio.playStream(options.body, {
          buffer: AUDIO_BUFFER,
          format: 'flac',
          signal: controller.signal,
          volume: options.volume ?? 1,
        })
        await waitForPlayback(opened, controller.signal)
        return opened
      })(),
    )
  } catch (error) {
    controller.abort()
    options.signal.removeEventListener('abort', forwardAbort)
    stream?.dispose()
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
