import { describe, expect, test } from 'bun:test'
import {
  MediaPlaybackClock,
  StreamingFrameCoordinator,
  type PlaybackClock,
} from '../termweave/components/media-playback'

interface TestFrame {
  ptsMs: number
  release(): void
}

function fakeClock() {
  let now = 0
  let scheduled: (() => void) | undefined
  const clock: PlaybackClock = {
    clearTimer: () => {
      scheduled = undefined
    },
    now: () => now,
    setTimer: (callback) => {
      scheduled = callback
      return 1 as unknown as ReturnType<typeof setTimeout>
    },
  }
  return {
    clock,
    runAt(time: number) {
      now = time
      const callback = scheduled
      scheduled = undefined
      callback?.()
    },
  }
}

function frame(ptsMs: number, released: number[]): TestFrame {
  return { ptsMs, release: () => released.push(ptsMs) }
}

describe('bounded variable-rate frame coordination', () => {
  test('presents source timestamps, drops late frames, and never blocks the producer', () => {
    const timer = fakeClock()
    const released: number[] = []
    const presented: number[] = []
    const coordinator = new StreamingFrameCoordinator<TestFrame>({
      clock: timer.clock,
      onPresent: (value) => presented.push(value.ptsMs),
    })

    for (const pts of [0, 16.667, 33.333, 41.667, 83.333]) {
      expect(coordinator.push(frame(pts, released))).toBe(true)
    }
    expect(coordinator.stats.queueSize).toBeLessThanOrEqual(2)
    timer.runAt(42)
    expect(presented).toEqual([0, 33.333])
    expect(released).toContain(16.667)
    expect(released).toContain(41.667)
    expect(released).toContain(83.333)

    timer.runAt(200)
    coordinator.push(frame(100, released))
    expect(released).toContain(100)
    coordinator.dispose()
    expect(coordinator.stats.queueSize).toBe(0)
  })

  test('preserves the next presentation deadline while a faster producer overflows the queue', () => {
    const timer = fakeClock()
    const released: number[] = []
    const presented: number[] = []
    const coordinator = new StreamingFrameCoordinator<TestFrame>({
      clock: timer.clock,
      onPresent: (value) => presented.push(value.ptsMs),
    })

    coordinator.push(frame(100, released))
    coordinator.push(frame(140, released))
    for (const pts of [180, 220, 260, 300]) coordinator.push(frame(pts, released))

    expect(coordinator.stats.queueSize).toBe(2)
    expect(released).toEqual([180, 220, 260, 300])
    timer.runAt(100)
    expect(presented).toEqual([100])
    timer.runAt(140)
    expect(presented).toEqual([100, 140])
    coordinator.dispose()
  })
})

describe('audio-primary media clock', () => {
  test('uses played samples and continues monotonically after audio failure', async () => {
    let wallTime = 1_000
    let framesPlayed = 4_800n
    let state = 'playing'
    let fallback = false
    const clock = new MediaPlaybackClock({
      audio: {
        getStats: () => ({ framesPlayed, sampleRate: 48_000, state }),
      },
      monotonicNow: () => wallTime,
      onAudioFallback: () => {
        fallback = true
      },
    })

    expect(clock.now()).toBe(100)
    framesPlayed = 12_000n
    expect(clock.now()).toBe(250)
    state = 'errored'
    wallTime = 1_020
    expect(clock.now()).toBe(250)
    await Promise.resolve()
    expect(fallback).toBe(true)
    wallTime = 1_070
    expect(clock.now()).toBe(300)
  })
})
