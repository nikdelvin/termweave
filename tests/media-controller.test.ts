import { describe, expect, test } from 'bun:test'
import { createMediaPlaybackController } from '../termweave/media/controller'
import type { AnimationFrame } from '../termweave/media/frame'
import type { MediaFormat, ResolvedMediaSource } from '../termweave/media/source'

function animationFrame(value: number, delayMs: number): AnimationFrame {
  return { width: 2, height: 2, data: new Uint8Array(16).fill(value), delayMs }
}

function last<T>(values: readonly T[]) {
  return values[values.length - 1]
}

function localSource(uri: string, format: MediaFormat = 'png'): ResolvedMediaSource {
  return { format, input: uri, kind: 'local', loop: format === 'gif', uri }
}

describe('media lifecycle controller', () => {
  test('keeps the current frame while replacing loads and suppresses stale completions', async () => {
    const pending: Array<{
      resolve: (frames: AnimationFrame[]) => void
      signal: AbortSignal | undefined
      uri: string
      width: number
    }> = []
    const shown: Array<AnimationFrame | undefined> = []
    const errors: unknown[] = []
    const playbackCallbacks: Array<(frame: AnimationFrame) => void> = []
    let stopped = 0
    const controller = createMediaPlaybackController({
      onError: (error) => {
        if (error !== undefined) errors.push(error)
      },
      onFrame: (frame) => shown.push(frame),
      load: (source, maximum, _background, signal) =>
        new Promise((resolve) =>
          pending.push({ resolve, signal, uri: source.uri, width: maximum.width }),
        ),
      play: (frames, onFrame) => {
        playbackCallbacks.push(onFrame)
        onFrame(frames[0]!)
        return () => {
          stopped += 1
        }
      },
      resolve: async (uri) => localSource(uri),
    })

    controller.replace({
      uri: 'first.png',
      maximum: { width: 8, height: 8 },
      background: [0, 0, 0],
    })
    await Promise.resolve()
    controller.replace({
      uri: 'second.png',
      maximum: { width: 8, height: 8 },
      background: [0, 0, 0],
    })
    await Promise.resolve()
    expect(pending[0]!.signal?.aborted).toBe(true)
    pending[0]!.resolve([animationFrame(1, 10)])
    await Promise.resolve()
    expect(playbackCallbacks).toHaveLength(0)

    pending[1]!.resolve([animationFrame(2, 10)])
    await Promise.resolve()
    expect(last(shown)?.data[0]).toBe(2)

    controller.replace({
      uri: 'second.png',
      maximum: { width: 4, height: 8 },
      background: [0, 0, 0],
    })
    await Promise.resolve()
    expect(stopped).toBe(1)
    expect(pending[2]).toMatchObject({ uri: 'second.png', width: 4 })
    playbackCallbacks[0]!(animationFrame(9, 10))
    expect(last(shown)?.data[0]).toBe(2)
    expect(errors).toEqual([])

    pending[2]!.resolve([animationFrame(3, 10)])
    await Promise.resolve()
    expect(last(shown)?.data[0]).toBe(3)
  })

  test('handles empty and zero-sized states, failures, repeated changes, and disposal cleanup', async () => {
    const signals: AbortSignal[] = []
    const errors: unknown[] = []
    const shown: Array<AnimationFrame | undefined> = []
    let stopCount = 0
    const controller = createMediaPlaybackController({
      onError: (error) => {
        if (error !== undefined) errors.push(error)
      },
      onFrame: (frame) => shown.push(frame),
      load: async (source, _maximum, _background, signal) => {
        if (signal) signals.push(signal)
        if (source.uri === 'bad.png') throw new Error('decode failed')
        return [animationFrame(source.uri.length, 20), animationFrame(source.uri.length + 1, 20)]
      },
      resolve: async (uri) => localSource(uri),
      play: (frames, onFrame) => {
        onFrame(frames[0]!)
        return () => {
          stopCount += 1
        }
      },
    })

    controller.replace({ uri: '', maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
    expect(String(last(errors))).toContain('Media URI is required')
    controller.replace({ uri: 'zero.png', maximum: { width: 0, height: 4 }, background: [0, 0, 0] })
    expect(signals).toHaveLength(0)
    controller.replace({ uri: 'bad.png', maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
    await Bun.sleep(0)
    expect(String(last(errors))).toContain('decode failed')

    for (const uri of ['a.png', 'bb.png', 'ccc.png']) {
      controller.replace({ uri, maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
      await Bun.sleep(0)
    }
    expect(last(shown)?.data[0]).toBe(7)

    controller.replace({ uri: 'bad.png', maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
    await Bun.sleep(0)
    expect(last(shown)?.data[0]).toBe(7)

    controller.dispose()
    expect(last(signals)?.aborted).toBe(false)
    expect(stopCount).toBeGreaterThan(0)
    expect(last(shown)).toBeUndefined()

    const count = signals.length
    controller.replace({
      uri: 'ignored.png',
      maximum: { width: 4, height: 4 },
      background: [0, 0, 0],
    })
    expect(signals).toHaveLength(count)
  })

  test('routes streaming sources through an abortable generation and keeps the last good frame', async () => {
    const shown: Array<AnimationFrame | undefined> = []
    const errors: unknown[] = []
    const streams: Array<{
      onError(error: unknown): void
      onFrame(frame: AnimationFrame): void
      stopped: boolean
      uri: string
    }> = []
    const controller = createMediaPlaybackController({
      onError: (error) => {
        if (error !== undefined) errors.push(error)
      },
      onFrame: (frame) => shown.push(frame),
      resolve: async (uri) =>
        uri.startsWith('https:')
          ? { format: 'mp4', input: uri, kind: 'remote', loop: true, uri }
          : { format: 'mp4', input: uri, kind: 'bundled', loop: true, uri },
      stream: (source, _request, options) => {
        const entry = { ...options, stopped: false, uri: source.uri }
        streams.push(entry)
        return () => {
          entry.stopped = true
        }
      },
    })

    controller.replace({
      uri: 'https://example.test/video.mp4',
      maximum: { width: 8, height: 8 },
      background: [0, 0, 0],
    })
    await Promise.resolve()
    const first = animationFrame(4, 0)
    streams[0]!.onFrame(first)
    expect(last(shown)).toBe(first)

    controller.replace({
      uri: 'media:clips/next.mp4',
      maximum: { width: 8, height: 8 },
      background: [0, 0, 0],
    })
    await Promise.resolve()
    expect(streams[0]!.stopped).toBe(true)
    streams[0]!.onError(new Error('stale'))
    streams[1]!.onError(new Error('new failed'))
    expect(last(shown)).toBe(first)
    expect(String(last(errors))).toContain('new failed')

    controller.dispose()
    expect(streams[1]!.stopped).toBe(true)
    expect(last(shown)).toBeUndefined()
  })

  test('starts cached frames synchronously without loading the source again', () => {
    const shown: Array<AnimationFrame | undefined> = []
    const cached = [animationFrame(42, 20)]
    let loadCount = 0
    const controller = createMediaPlaybackController({
      onError: () => {},
      onFrame: (frame) => shown.push(frame),
      getCached: (uri) => (uri === 'cached.png' ? cached : undefined),
      load: async () => {
        loadCount += 1
        return [animationFrame(1, 20)]
      },
      play: (frames, onFrame) => {
        onFrame(frames[0]!)
        return () => {}
      },
    })

    controller.replace({
      uri: 'cached.png',
      maximum: { width: 4, height: 4 },
      background: [0, 0, 0],
    })

    expect(last(shown)).toBe(cached[0])
    expect(loadCount).toBe(0)
    controller.dispose()
  })

  test('collects bundled GIFs as finite frames instead of streaming them', async () => {
    const shown: Array<AnimationFrame | undefined> = []
    let loadCount = 0
    let streamCount = 0
    const controller = createMediaPlaybackController({
      onError: () => {},
      onFrame: (frame) => shown.push(frame),
      resolve: async (uri) => ({
        format: 'gif',
        input: '/bundle/demo.gif',
        kind: 'bundled',
        loop: true,
        uri,
      }),
      load: async () => {
        loadCount += 1
        return [animationFrame(7, 150)]
      },
      play: (frames, onFrame) => {
        onFrame(frames[0]!)
        return () => {}
      },
      stream: () => {
        streamCount += 1
        return () => {}
      },
    })

    controller.replace({
      uri: 'media:demo.gif',
      maximum: { width: 4, height: 4 },
      background: [0, 0, 0],
    })
    await Bun.sleep(0)
    expect(loadCount).toBe(1)
    expect(streamCount).toBe(0)
    expect(last(shown)?.data[0]).toBe(7)
    controller.dispose()
  })
})
