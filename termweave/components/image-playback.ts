import type { AnimationFrame } from './pixel-frame'

const DEFAULT_GIF_DELAY_MS = 100
const MINIMUM_GIF_DELAY_MS = 10

export interface TimerClock<Timer = ReturnType<typeof setTimeout>> {
  now(): number
  setTimer(callback: () => void, delayMs: number): Timer
  clearTimer(timer: Timer): void
}

export interface FramePlaybackOptions<Timer = ReturnType<typeof setTimeout>> {
  clock?: TimerClock<Timer>
  onError?: (error: unknown) => void
}

export function normalizeGifDelay(delay: unknown) {
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) {
    return DEFAULT_GIF_DELAY_MS
  }
  return Math.max(MINIMUM_GIF_DELAY_MS, Math.round(delay))
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
  const durations = frames.map((frame) => normalizeGifDelay(frame.delayMs))
  const cumulativeEnds: number[] = []
  let cycleDuration = 0
  for (const duration of durations) {
    cycleDuration += duration
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
    if (disposed) return
    timer = clock.setTimer(advance, Math.max(0, nextFrameAt - clock.now()))
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
