import { describe, expect, test } from 'bun:test'
import {
  normalizeGifDelay,
  startFramePlayback,
  type TimerClock,
} from '../termweave/components/image-playback'
import type { AnimationFrame } from '../termweave/components/pixel-frame'

function animationFrame(value: number, delayMs: number): AnimationFrame {
  return { width: 2, height: 2, data: new Uint8Array(16).fill(value), delayMs }
}

function last<T>(values: readonly T[]) {
  return values[values.length - 1]
}

class FakeClock implements TimerClock<number> {
  time = 0
  nextId = 1
  maximumPending = 0
  readonly timers = new Map<number, { callback: () => void; due: number }>()

  now() {
    return this.time
  }

  setTimer(callback: () => void, delayMs: number) {
    const id = this.nextId
    this.nextId += 1
    this.timers.set(id, { callback, due: this.time + delayMs })
    this.maximumPending = Math.max(this.maximumPending, this.timers.size)
    return id
  }

  clearTimer(id: number) {
    this.timers.delete(id)
  }

  advanceTo(time: number) {
    this.time = time
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.due <= time)
      .sort((left, right) => left[1].due - right[1].due)
    const next = due[0]
    if (!next) return false
    this.timers.delete(next[0])
    next[1].callback()
    return true
  }
}

describe('frame delay normalization', () => {
  test('normalizes invalid delays and rounds valid delays with a 10 ms floor', () => {
    for (const delay of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, '12']) {
      expect(normalizeGifDelay(delay)).toBe(100)
    }
    expect(normalizeGifDelay(1)).toBe(10)
    expect(normalizeGifDelay(10.6)).toBe(11)
    expect(normalizeGifDelay(100.4)).toBe(100)
  })
})

describe('monotonic GIF playback', () => {
  test('loops on exact boundaries and skips expired frames after a long pause', () => {
    const clock = new FakeClock()
    const frames = [animationFrame(1, 100), animationFrame(2, 200)]
    const shown: AnimationFrame[] = []
    const dispose = startFramePlayback(frames, (frame) => shown.push(frame), { clock })

    expect(shown).toEqual([frames[0]])
    clock.advanceTo(99)
    expect(shown).toEqual([frames[0]])
    clock.advanceTo(100)
    expect(shown).toEqual([frames[0], frames[1]])
    clock.advanceTo(300)
    expect(shown).toEqual([frames[0], frames[1], frames[0]])
    clock.advanceTo(850)
    expect(last(shown)).toBe(frames[1])
    expect(clock.maximumPending).toBe(1)
    expect(clock.timers.size).toBe(1)

    dispose()
    expect(clock.timers.size).toBe(0)
    clock.advanceTo(2000)
    expect(last(shown)).toBe(frames[1])
  })

  test('keeps still images timer-free and clears scheduling failures', () => {
    const stillClock = new FakeClock()
    const shown: AnimationFrame[] = []
    startFramePlayback([animationFrame(1, 0)], (frame) => shown.push(frame), {
      clock: stillClock,
    })
    expect(shown).toHaveLength(1)
    expect(stillClock.timers.size).toBe(0)

    const failingClock = new FakeClock()
    const errors: unknown[] = []
    startFramePlayback([animationFrame(1, 10), animationFrame(2, 10)], () => {}, {
      clock: failingClock,
      onError: (error) => errors.push(error),
    })
    failingClock.time = Number.NaN
    const scheduled = [...failingClock.timers.entries()][0]!
    failingClock.timers.delete(scheduled[0])
    const callback = scheduled[1].callback
    callback()
    expect(errors).toHaveLength(1)
    expect(failingClock.timers.size).toBe(0)
  })
})
