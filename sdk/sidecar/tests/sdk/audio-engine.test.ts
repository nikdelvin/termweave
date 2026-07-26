import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { Audio, AudioStreamStats } from '@opentui/core'
import { createAudioEnginePool } from '../../sdk/src/helpers/audio-engine'
import {
  VIDEO_AUDIO_BUFFER,
  waitForVideoAudioPlayback,
  withVideoAudioStartTimeout,
} from '../../sdk/src/helpers/video-audio'

describe('shared audio engine', () => {
  test('disposes the native engine only after the final lease is released', () => {
    let created = 0
    let disposed = 0
    const fakeAudio = Object.assign(new EventEmitter(), {
      dispose: () => {
        disposed += 1
      },
    }) as unknown as Audio
    const pool = createAudioEnginePool(() => {
      created += 1
      return fakeAudio
    })

    const first = pool.acquire()
    const second = pool.acquire()
    expect(created).toBe(1)
    expect(pool.referenceCount).toBe(2)

    first.release()
    first.release()
    expect(disposed).toBe(0)
    expect(pool.referenceCount).toBe(1)

    second.release()
    expect(disposed).toBe(1)
    expect(pool.referenceCount).toBe(0)
  })
})

describe('video audio startup', () => {
  test('uses the bounded local-media stream buffer', () => {
    expect(VIDEO_AUDIO_BUFFER).toEqual({
      capacityMs: 1_000,
      startupMs: 250,
      resumeMs: 500,
    })
  })

  test('times out a stream that never becomes ready', async () => {
    const pending = new Promise<never>(() => {})
    await expect(withVideoAudioStartTimeout(pending, 5)).rejects.toThrow('did not start within 5ms')
  })

  test('waits until the native stream is actually playing', async () => {
    let state = 'buffering'
    const ready = waitForVideoAudioPlayback(
      {
        getStats: () =>
          ({
            state,
          }) as AudioStreamStats,
      },
      new AbortController().signal,
    )

    await Bun.sleep(1)
    state = 'playing'
    await expect(ready).resolves.toBeUndefined()
  })
})
