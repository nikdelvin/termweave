export interface AudioClockStats {
  framesPlayed: bigint
  sampleRate: number
  state: string
}

export interface AudioClockSource {
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

export interface CoordinatedVideoFrame {
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
