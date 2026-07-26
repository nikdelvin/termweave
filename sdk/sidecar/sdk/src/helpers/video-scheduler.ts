export interface IndexedVideoFrame {
  frameIndex: number
}

export interface SchedulerClock {
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
  now: () => number
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
}

interface VideoFrameSchedulerOptions<T extends IndexedVideoFrame> {
  clock?: SchedulerClock
  framesPerSecond: number
  maxQueueSize?: number
  onDiscard: (frame: T) => void
  onPresent: (frame: T) => void
  timelineOriginMs?: number
}

const defaultClock: SchedulerClock = {
  clearTimer: clearTimeout,
  now: () => performance.now(),
  setTimer: setTimeout,
}

export class VideoFrameScheduler<T extends IndexedVideoFrame> {
  readonly #clock: SchedulerClock
  readonly #frameDurationMs: number
  readonly #maxQueueSize: number
  readonly #onDiscard: (frame: T) => void
  readonly #onPresent: (frame: T) => void
  readonly #queue: T[] = []
  readonly #spaceWaiters = new Set<(accepted: boolean) => void>()

  #disposed = false
  #startedAt: number | undefined
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(options: VideoFrameSchedulerOptions<T>) {
    if (!Number.isFinite(options.framesPerSecond) || options.framesPerSecond <= 0) {
      throw new RangeError('Video scheduler FPS must be positive.')
    }

    const maxQueueSize = options.maxQueueSize ?? 3
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) {
      throw new RangeError('Video scheduler queue size must be a positive integer.')
    }

    this.#clock = options.clock ?? defaultClock
    this.#frameDurationMs = 1_000 / options.framesPerSecond
    this.#maxQueueSize = maxQueueSize
    this.#onDiscard = options.onDiscard
    this.#onPresent = options.onPresent
    if (options.timelineOriginMs !== undefined) {
      if (!Number.isFinite(options.timelineOriginMs)) {
        throw new RangeError('Video scheduler timeline origin must be finite.')
      }
      this.#startedAt = options.timelineOriginMs
    }
  }

  get queueSize() {
    return this.#queue.length
  }

  async enqueue(frame: T) {
    while (!this.#disposed && this.#queue.length >= this.#maxQueueSize) {
      const accepted = await new Promise<boolean>((resolve) => this.#spaceWaiters.add(resolve))
      if (!accepted) break
    }

    if (this.#disposed) {
      this.#onDiscard(frame)
      return false
    }

    this.#queue.push(frame)
    this.flush()
    return true
  }

  flush() {
    if (this.#disposed || this.#queue.length === 0) return
    this.#clearTimer()

    const now = this.#clock.now()
    const firstFrame = this.#queue[0]!
    this.#startedAt ??= now - firstFrame.frameIndex * this.#frameDurationMs
    const desiredFrameIndex = Math.floor((now - this.#startedAt) / this.#frameDurationMs)
    const queueWasFull = this.#queue.length >= this.#maxQueueSize
    let dueFrame: T | undefined

    while (this.#queue[0] && this.#queue[0]!.frameIndex <= desiredFrameIndex) {
      if (dueFrame) this.#onDiscard(dueFrame)
      dueFrame = this.#queue.shift()
    }

    if (dueFrame) {
      const producerIsBlockedBehindStaleFrames =
        queueWasFull && this.#queue.length === 0 && dueFrame.frameIndex < desiredFrameIndex

      if (producerIsBlockedBehindStaleFrames) this.#onDiscard(dueFrame)
      else this.#onPresent(dueFrame)
      this.#releaseSpace()
    }

    const nextFrame = this.#queue[0]
    if (!nextFrame) return

    const dueAt = this.#startedAt + nextFrame.frameIndex * this.#frameDurationMs
    this.#timer = this.#clock.setTimer(
      () => {
        this.#timer = undefined
        this.flush()
      },
      Math.max(0, dueAt - this.#clock.now()),
    )
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#clearTimer()
    for (const frame of this.#queue.splice(0)) this.#onDiscard(frame)
    for (const resolve of this.#spaceWaiters) resolve(false)
    this.#spaceWaiters.clear()
  }

  #clearTimer() {
    if (this.#timer === undefined) return
    this.#clock.clearTimer(this.#timer)
    this.#timer = undefined
  }

  #releaseSpace() {
    for (const resolve of this.#spaceWaiters) resolve(true)
    this.#spaceWaiters.clear()
  }
}

export interface AudioClockStats {
  framesPlayed: bigint
  sampleRate: number
  state: string
}

export interface AudioClockSource {
  getStats: () => AudioClockStats
}

interface MediaClockOptions {
  audio?: AudioClockSource
  clearTimer?: SchedulerClock['clearTimer']
  monotonicNow?: () => number
  onAudioFallback?: () => void
  setTimer?: SchedulerClock['setTimer']
}

const TERMINAL_AUDIO_STATES = new Set(['disposed', 'ended', 'errored'])

export class MediaPlaybackClock implements SchedulerClock {
  readonly #clearTimer: SchedulerClock['clearTimer']
  readonly #monotonicNow: () => number
  readonly #onAudioFallback: (() => void) | undefined
  readonly #setTimer: SchedulerClock['setTimer']

  #audio: AudioClockSource | undefined
  #fallbackMediaTimeMs = 0
  #fallbackStartedAt: number
  #lastAudioTimeMs = 0

  constructor(options: MediaClockOptions = {}) {
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
        if (TERMINAL_AUDIO_STATES.has(stats.state)) {
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
