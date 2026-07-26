import { expect, test } from 'bun:test'
import { MediaPlaybackClock, VideoFrameScheduler } from '../../sdk/src/helpers/video-scheduler'

interface TestFrame {
  frameIndex: number
}

function fakeClock() {
  let now = 0
  let scheduled: (() => void) | undefined

  return {
    clock: {
      clearTimer: () => {
        scheduled = undefined
      },
      now: () => now,
      setTimer: (callback: () => void) => {
        scheduled = callback
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
    },
    runAt(time: number) {
      now = time
      const callback = scheduled
      scheduled = undefined
      callback?.()
    },
  }
}

test('presents the newest due frame and discards older frames', async () => {
  const clock = fakeClock()
  const discarded: number[] = []
  const presented: number[] = []
  const scheduler = new VideoFrameScheduler<TestFrame>({
    clock: clock.clock,
    framesPerSecond: 10,
    onDiscard: (frame) => discarded.push(frame.frameIndex),
    onPresent: (frame) => presented.push(frame.frameIndex),
  })

  await scheduler.enqueue({ frameIndex: 0 })
  await scheduler.enqueue({ frameIndex: 1 })
  await scheduler.enqueue({ frameIndex: 2 })
  await scheduler.enqueue({ frameIndex: 3 })
  clock.runAt(250)

  expect(presented).toEqual([0, 2])
  expect(discarded).toEqual([1])
  expect(scheduler.queueSize).toBe(1)
  scheduler.dispose()
  expect(discarded).toEqual([1, 3])
})

test('unblocks the decoder and catches up without presenting a stale full queue', async () => {
  const clock = fakeClock()
  const discarded: number[] = []
  const presented: number[] = []
  const scheduler = new VideoFrameScheduler<TestFrame>({
    clock: clock.clock,
    framesPerSecond: 10,
    maxQueueSize: 3,
    onDiscard: (frame) => discarded.push(frame.frameIndex),
    onPresent: (frame) => presented.push(frame.frameIndex),
  })

  await scheduler.enqueue({ frameIndex: 0 })
  await scheduler.enqueue({ frameIndex: 1 })
  await scheduler.enqueue({ frameIndex: 2 })
  await scheduler.enqueue({ frameIndex: 3 })
  const frameFourAccepted = scheduler.enqueue({ frameIndex: 4 })
  clock.runAt(450)
  await frameFourAccepted

  expect(presented).toEqual([0, 4])
  expect(discarded).toEqual([1, 2, 3])
  expect(scheduler.queueSize).toBe(0)
  scheduler.dispose()
})

test('uses played audio samples as an absolute media timeline', () => {
  let framesPlayed = 4_800n
  const clock = new MediaPlaybackClock({
    audio: {
      getStats: () => ({
        framesPlayed,
        sampleRate: 48_000,
        state: 'playing',
      }),
    },
    monotonicNow: () => 10_000,
  })

  expect(clock.now()).toBe(100)
  framesPlayed = 12_000n
  expect(clock.now()).toBe(250)
})

test('continues monotonically from the final audio time after an audio failure', async () => {
  let wallTime = 1_000
  let state = 'playing'
  let fallbackObserved = false
  const clock = new MediaPlaybackClock({
    audio: {
      getStats: () => ({
        framesPlayed: 4_800n,
        sampleRate: 48_000,
        state,
      }),
    },
    monotonicNow: () => wallTime,
    onAudioFallback: () => {
      fallbackObserved = true
    },
  })

  expect(clock.now()).toBe(100)
  state = 'errored'
  wallTime = 1_020
  expect(clock.now()).toBe(100)
  await Promise.resolve()
  expect(fallbackObserved).toBe(true)
  wallTime = 1_070
  expect(clock.now()).toBe(150)
})
