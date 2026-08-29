import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Rgb } from '../color'
import { createFfmpegProcessError, openFfmpegMediaSession } from './ffmpeg'
import { compositeRgbaInto, rgbaByteLength, type AnimationFrame, type Dimensions } from './frame'
import { resolveLocalImagePath, throwIfMediaAborted, type ResolvedMediaSource } from './source'

// Playback owns clocks, queues, finite-frame collection, and the stat-keyed LRU cache.
interface AudioClockStats {
  framesPlayed: bigint
  sampleRate: number
  state: string
}

interface AudioClockSource {
  getStats(): AudioClockStats
}

export interface PlaybackClock {
  clearTimer(timer: ReturnType<typeof setTimeout>): void
  now(): number
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
}

interface MediaPlaybackClockOptions {
  audio?: AudioClockSource
  clearTimer?: PlaybackClock['clearTimer']
  monotonicNow?: () => number
  onAudioFallback?: () => void
  setTimer?: PlaybackClock['setTimer']
}

const terminalAudioStates = new Set(['disposed', 'ended', 'errored'])

export class MediaPlaybackClock implements PlaybackClock {
  readonly #clearTimer: PlaybackClock['clearTimer']
  readonly #monotonicNow: () => number
  readonly #onAudioFallback: (() => void) | undefined
  readonly #setTimer: PlaybackClock['setTimer']
  #audio: AudioClockSource | undefined
  #fallbackMediaTimeMs = 0
  #fallbackStartedAt: number
  #lastAudioTimeMs = 0

  constructor(options: MediaPlaybackClockOptions = {}) {
    this.#audio = options.audio
    this.#clearTimer = options.clearTimer ?? clearTimeout
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.#onAudioFallback = options.onAudioFallback
    this.#setTimer = options.setTimer ?? setTimeout
    this.#fallbackStartedAt = this.#monotonicNow()
  }

  clearTimer(timer: ReturnType<typeof setTimeout>) {
    this.#clearTimer(timer)
  }

  detachAudio() {
    if (!this.#audio) return
    this.#audio = undefined
    this.#fallbackMediaTimeMs = this.#lastAudioTimeMs
    this.#fallbackStartedAt = this.#monotonicNow()
    if (this.#onAudioFallback) queueMicrotask(this.#onAudioFallback)
  }

  now() {
    const audio = this.#audio
    if (audio) {
      try {
        const stats = audio.getStats()
        if (terminalAudioStates.has(stats.state)) {
          this.detachAudio()
        } else if (stats.sampleRate > 0) {
          const audioTimeMs = (Number(stats.framesPlayed) * 1_000) / stats.sampleRate
          this.#lastAudioTimeMs = Math.max(this.#lastAudioTimeMs, audioTimeMs)
          return this.#lastAudioTimeMs
        } else {
          return this.#lastAudioTimeMs
        }
      } catch {
        this.detachAudio()
      }
    }
    return this.#fallbackMediaTimeMs + (this.#monotonicNow() - this.#fallbackStartedAt)
  }

  setTimer(callback: () => void, delayMs: number) {
    return this.#setTimer(callback, delayMs)
  }
}

interface CoordinatedVideoFrame {
  ptsMs: number
  release(): void
}

interface StreamingFrameCoordinatorOptions<T extends CoordinatedVideoFrame> {
  clock: PlaybackClock
  maxLateMs?: number
  maxQueueSize?: number
  onPresent(frame: T): void
}

export class StreamingFrameCoordinator<T extends CoordinatedVideoFrame> {
  readonly #clock: PlaybackClock
  readonly #maxLateMs: number
  readonly #maxQueueSize: number
  readonly #onPresent: (frame: T) => void
  readonly #queue: T[] = []
  #disposed = false
  #droppedFrames = 0
  #presentedFrames = 0
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(options: StreamingFrameCoordinatorOptions<T>) {
    const maxQueueSize = options.maxQueueSize ?? 2
    if (!Number.isSafeInteger(maxQueueSize) || maxQueueSize < 1) {
      throw new RangeError('Media frame queue size must be a positive integer.')
    }
    const maxLateMs = options.maxLateMs ?? 50
    if (!Number.isFinite(maxLateMs) || maxLateMs < 0) {
      throw new RangeError('Media frame lateness must be a non-negative duration.')
    }
    this.#clock = options.clock
    this.#maxLateMs = maxLateMs
    this.#maxQueueSize = maxQueueSize
    this.#onPresent = options.onPresent
  }

  get stats() {
    return {
      droppedFrames: this.#droppedFrames,
      presentedFrames: this.#presentedFrames,
      queueSize: this.#queue.length,
    }
  }

  push(frame: T) {
    if (this.#disposed) {
      frame.release()
      return false
    }
    if (!Number.isFinite(frame.ptsMs) || frame.ptsMs < 0) {
      frame.release()
      throw new Error('Decoded media frame timestamp must be finite and non-negative.')
    }

    const now = this.#clock.now()
    if (frame.ptsMs < now - this.#maxLateMs) {
      this.#discard(frame)
      return true
    }

    this.#queue.push(frame)
    this.#queue.sort((left, right) => left.ptsMs - right.ptsMs)
    while (this.#queue.length > this.#maxQueueSize) {
      this.#discard(this.#queue.pop()!)
    }
    this.flush()
    return true
  }

  flush() {
    if (this.#disposed || this.#queue.length === 0) return
    this.#clearTimer()
    const now = this.#clock.now()
    let due: T | undefined
    while (this.#queue[0] && this.#queue[0]!.ptsMs <= now + 1) {
      if (due) this.#discard(due)
      due = this.#queue.shift()
    }
    if (due) {
      this.#presentedFrames += 1
      this.#onPresent(due)
    }

    const next = this.#queue[0]
    if (!next) return
    this.#timer = this.#clock.setTimer(
      () => {
        this.#timer = undefined
        this.flush()
      },
      Math.max(0, next.ptsMs - this.#clock.now()),
    )
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#clearTimer()
    for (const frame of this.#queue.splice(0)) this.#discard(frame)
  }

  #clearTimer() {
    if (this.#timer === undefined) return
    this.#clock.clearTimer(this.#timer)
    this.#timer = undefined
  }

  #discard(frame: T) {
    this.#droppedFrames += 1
    frame.release()
  }
}

const DEFAULT_GIF_DELAY_MS = 100
const MINIMUM_GIF_DELAY_MS = 10
const MAX_FRAME_CACHE_BYTES = 64 * 1024 * 1024

interface FrameCacheEntry {
  byteLength: number
  frames: readonly AnimationFrame[]
}

const frameCache = new Map<string, FrameCacheEntry>()
let frameCacheByteLength = 0

export interface TimerClock<Timer = ReturnType<typeof setTimeout>> {
  now(): number
  setTimer(callback: () => void, delayMs: number): Timer
  clearTimer(timer: Timer): void
}

interface FramePlaybackOptions<Timer = ReturnType<typeof setTimeout>> {
  clock?: TimerClock<Timer>
  onError?: (error: unknown) => void
}

function frameCacheKeyForPath(path: string, maximum: Dimensions, background: Rgb) {
  path = resolve(path)
  const stats = statSync(path, { bigint: true })
  if (!stats.isFile()) throw new Error('The image source is not a file.')
  const version = [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':')
  return `${path}\0${version}\0${maximum.width}x${maximum.height}\0${background.join(',')}`
}

function frameCacheKey(uri: string, maximum: Dimensions, background: Rgb) {
  return frameCacheKeyForPath(resolveLocalImagePath(uri), maximum, background)
}

function resolvedFrameCacheKey(source: ResolvedMediaSource, maximum: Dimensions, background: Rgb) {
  if (source.kind === 'remote') return undefined
  return frameCacheKeyForPath(source.input, maximum, background)
}

function cachedFrames(key: string) {
  const entry = frameCache.get(key)
  if (!entry) return undefined
  frameCache.delete(key)
  frameCache.set(key, entry)
  return entry.frames
}

function rememberFrames(key: string, frames: readonly AnimationFrame[]) {
  let byteLength = 0
  for (const frame of frames) {
    byteLength += frame.data.byteLength
    if (!Number.isSafeInteger(byteLength) || byteLength > MAX_FRAME_CACHE_BYTES) return
  }
  const existing = frameCache.get(key)
  if (existing) {
    frameCacheByteLength -= existing.byteLength
    frameCache.delete(key)
  }
  while (frameCacheByteLength + byteLength > MAX_FRAME_CACHE_BYTES) {
    const oldestKey = frameCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = frameCache.get(oldestKey)!
    frameCache.delete(oldestKey)
    frameCacheByteLength -= oldest.byteLength
  }
  frameCache.set(key, { byteLength, frames })
  frameCacheByteLength += byteLength
}

export function getCachedLocalImageFrames(uri: string, maximum: Dimensions, background: Rgb) {
  try {
    return cachedFrames(frameCacheKey(uri, maximum, background))
  } catch {
    return undefined
  }
}

export function normalizeGifDelay(delay: unknown) {
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) {
    return DEFAULT_GIF_DELAY_MS
  }
  return Math.max(MINIMUM_GIF_DELAY_MS, Math.round(delay))
}

export function parseFfmpegDuration(diagnostic: string) {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(diagnostic)
  if (!match) return undefined
  const milliseconds = (Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])) * 1_000
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined
}

export async function loadResolvedLocalImageFrames(
  source: ResolvedMediaSource,
  maximum: Dimensions,
  background: Rgb,
  signal?: AbortSignal,
  ffmpegPath?: string,
) {
  if (source.kind === 'remote' || source.format === 'mp4') {
    throw new Error('Finite image loading requires a local or bundled PNG, JPEG, or GIF source.')
  }
  throwIfMediaAborted(signal)
  let cacheKey: string | undefined
  try {
    cacheKey = resolvedFrameCacheKey(source, maximum, background)
  } catch {
    // Missing and changed sources continue through FFmpeg for an actionable error.
  }
  if (cacheKey) {
    const cached = cachedFrames(cacheKey)
    if (cached) return cached
  }
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()

  const frames: Array<AnimationFrame & { ptsMs: number }> = []
  let session: Awaited<ReturnType<typeof openFfmpegMediaSession>> | undefined
  try {
    session = await openFfmpegMediaSession({
      source,
      width: maximum.width,
      height: maximum.height,
      background,
      ffmpegPath,
      hardwareAcceleration: false,
      realtime: false,
      signal: controller.signal,
      withAudio: false,
    })
    for await (const frame of session.frames) {
      throwIfMediaAborted(signal)
      const data = new Uint8Array(rgbaByteLength(frame))
      try {
        compositeRgbaInto(frame.data, data, background)
      } finally {
        frame.release()
      }
      frames.push({
        width: frame.width,
        height: frame.height,
        data,
        delayMs: 0,
        ptsMs: frame.ptsMs,
      })
    }
    const result = await session.result
    throwIfMediaAborted(signal)
    if (result.exitCode !== 0) throw createFfmpegProcessError(result)
    if (frames.length === 0) throw createFfmpegProcessError(result)

    if (source.format === 'gif') {
      const duration = parseFfmpegDuration(result.diagnostic)
      for (let index = 0; index < frames.length; index += 1) {
        const nextTimestamp = frames[index + 1]?.ptsMs ?? duration
        const previousDelay = index > 0 ? frames[index - 1]!.delayMs : DEFAULT_GIF_DELAY_MS
        frames[index]!.delayMs = normalizeGifDelay(
          nextTimestamp === undefined ? previousDelay : nextTimestamp - frames[index]!.ptsMs,
        )
      }
    }
    const decoded = frames.map(({ data, delayMs, height, width }) => ({
      data,
      delayMs,
      height,
      width,
    }))
    if (cacheKey) {
      try {
        if (resolvedFrameCacheKey(source, maximum, background) === cacheKey) {
          rememberFrames(cacheKey, decoded)
        }
      } catch {
        // A source changed during decoding; publish the result without retaining it.
      }
    }
    return decoded
  } finally {
    signal?.removeEventListener('abort', abort)
    controller.abort()
    session?.dispose()
    await session?.result.catch(() => {})
  }
}

const systemClock: TimerClock = {
  now: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
}

export function startFramePlayback<Timer = ReturnType<typeof setTimeout>>(
  frames: readonly AnimationFrame[],
  onFrame: (frame: AnimationFrame) => void,
  options: FramePlaybackOptions<Timer> = {},
) {
  if (frames.length === 0) throw new Error('Animation playback requires at least one frame.')
  const clock = options.clock ?? (systemClock as TimerClock<Timer>)
  const cumulativeEnds: number[] = []
  let cycleDuration = 0
  for (const frame of frames) {
    cycleDuration += normalizeGifDelay(frame.delayMs)
    if (!Number.isSafeInteger(cycleDuration)) {
      throw new Error('The GIF animation duration is too large to schedule safely.')
    }
    cumulativeEnds.push(cycleDuration)
  }

  let disposed = false
  let timer: Timer | undefined
  let currentIndex = 0
  const origin = clock.now()
  if (!Number.isFinite(origin)) throw new Error('The animation clock returned an invalid time.')
  onFrame(frames[0]!)

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (timer !== undefined) clock.clearTimer(timer)
    timer = undefined
  }
  if (frames.length === 1) return dispose

  const schedule = (nextFrameAt: number) => {
    if (!disposed) timer = clock.setTimer(advance, Math.max(0, nextFrameAt - clock.now()))
  }
  const locateFrame = (now: number) => {
    const elapsed = Math.max(0, now - origin)
    const cycle = Math.floor(elapsed / cycleDuration)
    const withinCycle = elapsed - cycle * cycleDuration
    let index = cumulativeEnds.findIndex((end) => end > withinCycle)
    if (index < 0) index = 0
    return {
      index,
      nextFrameAt: origin + cycle * cycleDuration + cumulativeEnds[index]!,
    }
  }
  function advance() {
    timer = undefined
    if (disposed) return
    try {
      const now = clock.now()
      if (!Number.isFinite(now)) throw new Error('The animation clock returned an invalid time.')
      const next = locateFrame(now)
      if (next.index !== currentIndex) {
        currentIndex = next.index
        onFrame(frames[currentIndex]!)
      }
      schedule(next.nextFrameAt)
    } catch (error) {
      dispose()
      options.onError?.(error)
    }
  }

  schedule(origin + cumulativeEnds[0]!)
  return dispose
}
