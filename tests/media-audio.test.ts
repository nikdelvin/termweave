import { describe, expect, test } from 'bun:test'
import type { Audio, AudioStream } from '@opentui/core'
import {
  createAudioEnginePool,
  createDrainableAudioBody,
  startMediaAudio,
  type AudioEngineLease,
} from '../termweave/media/audio'
import { Deferred } from './support/deferred'

class FakeAudioStream {
  readonly listeners = new Map<string, Set<(...arguments_: never[]) => void>>()
  disposeCount = 0
  framesPlayed = 4_800n
  sampleRate = 48_000
  state = 'playing'

  getStats() {
    return {
      framesPlayed: this.framesPlayed,
      sampleRate: this.sampleRate,
      state: this.state,
    }
  }

  on(event: string, listener: (...arguments_: never[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: string, listener: (...arguments_: never[]) => void) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, ...arguments_: never[]) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...arguments_)
  }

  dispose() {
    this.disposeCount += 1
    this.state = 'disposed'
  }
}

class FakeAudioEngine {
  readonly listeners = new Map<string, Set<(...arguments_: never[]) => void>>()
  disposeCount = 0
  playStream: (...arguments_: never[]) => Promise<AudioStream> = async () =>
    new FakeAudioStream() as unknown as AudioStream

  on(event: string, listener: (...arguments_: never[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: string, listener: (...arguments_: never[]) => void) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  dispose() {
    this.disposeCount += 1
  }
}

const emptyBody = {
  [Symbol.asyncIterator]() {
    return {
      async next() {
        return { done: true as const, value: undefined }
      },
    }
  },
}

function audioLease(
  stream: FakeAudioStream,
  playStream: () => Promise<AudioStream> = async () => stream as unknown as AudioStream,
) {
  const audio = new FakeAudioEngine()
  audio.playStream = playStream as (...arguments_: never[]) => Promise<AudioStream>
  let releases = 0
  const acquire = (): AudioEngineLease => ({
    audio: audio as unknown as Audio,
    release() {
      releases += 1
    },
  })
  return { acquire, audio, releases: () => releases }
}

describe('shared media audio engine leases', () => {
  test('shares one engine and disposes it only after idempotent final release', () => {
    const engines: FakeAudioEngine[] = []
    const pool = createAudioEnginePool(() => {
      const engine = new FakeAudioEngine()
      engines.push(engine)
      return engine as unknown as Audio
    })
    const first = pool.acquire()
    const second = pool.acquire()

    expect(engines).toHaveLength(1)
    expect(engines[0]!.listeners.get('error')?.size).toBe(1)
    first.release()
    first.release()
    expect(engines[0]!.disposeCount).toBe(0)
    second.release()
    second.release()
    expect(engines[0]!.listeners.get('error')?.size).toBe(0)
    expect(engines[0]!.disposeCount).toBe(1)

    pool.acquire().release()
    expect(engines).toHaveLength(2)
    expect(engines[1]!.disposeCount).toBe(1)
  })
})

describe('drainable FFmpeg audio bodies', () => {
  test('enforces one consumer and drains the unread tail after initialization fails', async () => {
    const read = [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)]
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of read) controller.enqueue(chunk)
        controller.close()
      },
    })
    const { body, drain } = createDrainableAudioBody(source)
    const iterator = body[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toEqual(Uint8Array.of(1))
    await iterator.return?.()

    await expect(Array.fromAsync(body)).rejects.toThrow('consumed only once')
    await drain()
    await drain()
    expect(source.locked).toBe(false)
  })

  test('contains FFmpeg pipe closure while draining and releases the reader lock', async () => {
    const source = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('descriptor closed')
      },
    })
    const { drain } = createDrainableAudioBody(source)
    await expect(drain()).resolves.toBeUndefined()
    expect(source.locked).toBe(false)
  })
})

describe('media audio startup and terminal lifecycle', () => {
  test('starts playback, exposes the audio-primary clock, and disposes once with fallback', async () => {
    const stream = new FakeAudioStream()
    const lease = audioLease(stream)
    let fallbacks = 0
    const session = await startMediaAudio({
      acquireAudioEngine: lease.acquire,
      body: emptyBody,
      onClockFallback: () => {
        fallbacks += 1
      },
      signal: new AbortController().signal,
    })

    expect(session.clock.now()).toBe(100)
    session.dispose()
    session.dispose()
    await Promise.resolve()
    expect(fallbacks).toBe(1)
    expect(stream.disposeCount).toBe(1)
    expect(lease.releases()).toBe(1)
    expect(stream.listeners.get('error')?.size).toBe(0)
    expect(stream.listeners.get('ended')?.size).toBe(0)
  })

  test('rejects pre-aborted and mid-start cancellation without leaking a late stream', async () => {
    const preAborted = new AbortController()
    preAborted.abort()
    let acquires = 0
    await expect(
      startMediaAudio({
        acquireAudioEngine: () => {
          acquires += 1
          throw new Error('must not acquire')
        },
        body: emptyBody,
        signal: preAborted.signal,
      }),
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(acquires).toBe(0)

    const stream = new FakeAudioStream()
    const opened = new Deferred<AudioStream>()
    const lease = audioLease(stream, () => opened.promise)
    const controller = new AbortController()
    const starting = startMediaAudio({
      acquireAudioEngine: lease.acquire,
      body: emptyBody,
      signal: controller.signal,
    })
    controller.abort()
    await expect(starting).rejects.toHaveProperty('name', 'AbortError')
    expect(lease.releases()).toBe(1)

    opened.resolve(stream as unknown as AudioStream)
    await Promise.resolve()
    await Promise.resolve()
    expect(stream.disposeCount).toBe(1)
  })

  test('cleans up startup timeout and terminal state failures, including late opens', async () => {
    const lateStream = new FakeAudioStream()
    const opened = new Deferred<AudioStream>()
    const timedLease = audioLease(lateStream, () => opened.promise)
    const timedOut = startMediaAudio({
      acquireAudioEngine: timedLease.acquire,
      body: emptyBody,
      signal: new AbortController().signal,
      startTimeout: async (pending) => {
        void pending.catch(() => {})
        throw new Error('Media audio did not start in time.')
      },
    })
    await expect(timedOut).rejects.toThrow('did not start in time')
    expect(timedLease.releases()).toBe(1)
    opened.resolve(lateStream as unknown as AudioStream)
    await Promise.resolve()
    await Promise.resolve()
    expect(lateStream.disposeCount).toBe(1)

    const endedStream = new FakeAudioStream()
    endedStream.state = 'ended'
    const endedLease = audioLease(endedStream)
    await expect(
      startMediaAudio({
        acquireAudioEngine: endedLease.acquire,
        body: emptyBody,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('ended state before playback')
    expect(endedStream.disposeCount).toBe(1)
    expect(endedLease.releases()).toBe(1)
  })

  test('contains error and ended events and reports only active errors as failures', async () => {
    const errorStream = new FakeAudioStream()
    const errorLease = audioLease(errorStream)
    const failures: unknown[] = []
    const errorSession = await startMediaAudio({
      acquireAudioEngine: errorLease.acquire,
      body: emptyBody,
      onFailure: (error) => failures.push(error),
      signal: new AbortController().signal,
    })
    errorStream.emit('error', new Error('device failed') as never)
    errorSession.dispose()
    expect(failures.map(String)).toEqual(['Error: device failed'])
    expect(errorStream.disposeCount).toBe(1)
    expect(errorLease.releases()).toBe(1)

    const endedStream = new FakeAudioStream()
    const endedLease = audioLease(endedStream)
    const endedSession = await startMediaAudio({
      acquireAudioEngine: endedLease.acquire,
      body: emptyBody,
      onFailure: (error) => failures.push(error),
      signal: new AbortController().signal,
    })
    endedStream.emit('ended')
    endedSession.dispose()
    expect(failures).toHaveLength(1)
    expect(endedStream.disposeCount).toBe(1)
    expect(endedLease.releases()).toBe(1)
  })
})
