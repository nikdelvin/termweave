import type { AudioStream, AudioStreamStats } from '@opentui/core'
import { sharedAudioEngine, type AudioEngineLease } from './audio-engine'
import { MediaPlaybackClock } from './video-scheduler'
import { streamVideoAudio } from './video-stream'

export const VIDEO_AUDIO_START_TIMEOUT_MS = 2_000
const VIDEO_AUDIO_READY_POLL_MS = 5
export const VIDEO_AUDIO_BUFFER = {
  capacityMs: 1_000,
  startupMs: 250,
  resumeMs: 500,
} as const

interface StartVideoAudioOptions {
  ffmpegPath?: string
  onClockFallback?: () => void
  onFailure?: (error: unknown) => void
  signal: AbortSignal
  uri: string
  volume?: number
}

export interface VideoAudioSession {
  clock: MediaPlaybackClock
  dispose: () => void
  getStats: () => AudioStreamStats
}

export async function withVideoAudioStartTimeout<T>(
  pending: Promise<T>,
  timeoutMs = VIDEO_AUDIO_START_TIMEOUT_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Video audio did not start within ${timeoutMs}ms.`))
      }, timeoutMs)
      timer.unref?.()
    })
    return await Promise.race([pending, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function waitForVideoAudioPlayback(
  stream: Pick<AudioStream, 'getStats'>,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    const stats = stream.getStats()
    if (stats.state === 'playing') return
    if (stats.state === 'ended' || stats.state === 'errored' || stats.state === 'disposed') {
      throw new Error(`Video audio entered the ${stats.state} state before playback started.`)
    }
    await Bun.sleep(VIDEO_AUDIO_READY_POLL_MS)
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Video audio startup was aborted.', 'AbortError')
}

export async function startVideoAudio(options: StartVideoAudioOptions): Promise<VideoAudioSession> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  options.signal.addEventListener('abort', forwardAbort, { once: true })
  if (options.signal.aborted) controller.abort()

  let lease: AudioEngineLease | undefined
  let stream: AudioStream | undefined
  let startupFailure: unknown
  let handleStartupEnded: (() => void) | undefined
  let handleStartupError: ((error: Error) => void) | undefined
  try {
    lease = sharedAudioEngine.acquire()
    const pendingStream = (async () => {
      const openedStream = await lease.audio.playStream(
        streamVideoAudio({
          ffmpegPath: options.ffmpegPath,
          signal: controller.signal,
          uri: options.uri,
        }),
        {
          buffer: VIDEO_AUDIO_BUFFER,
          format: 'flac',
          signal: controller.signal,
          volume: options.volume ?? 1,
        },
      )
      stream = openedStream
      handleStartupError = (error) => {
        startupFailure ??= error
      }
      handleStartupEnded = () => {
        startupFailure ??= new Error('Video audio playback ended during startup.')
      }
      openedStream.on('error', handleStartupError)
      openedStream.on('ended', handleStartupEnded)
      await waitForVideoAudioPlayback(openedStream, controller.signal)
      if (startupFailure !== undefined) throw startupFailure
      return openedStream
    })()
    stream = await withVideoAudioStartTimeout(pendingStream)
  } catch (error) {
    controller.abort()
    options.signal.removeEventListener('abort', forwardAbort)
    if (handleStartupError) stream?.off('error', handleStartupError)
    if (handleStartupEnded) stream?.off('ended', handleStartupEnded)
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
  const handleEnded = () => release(new Error('Video audio playback ended unexpectedly.'))

  activeStream.on('error', handleError)
  activeStream.on('ended', handleEnded)
  if (handleStartupError) activeStream.off('error', handleStartupError)
  if (handleStartupEnded) activeStream.off('ended', handleStartupEnded)
  options.signal.addEventListener('abort', handleAbort, { once: true })
  if (startupFailure !== undefined) {
    release(startupFailure)
    throw startupFailure
  }
  if (options.signal.aborted) release()

  return {
    clock,
    dispose: release,
    getStats: () => activeStream.getStats(),
  }
}
