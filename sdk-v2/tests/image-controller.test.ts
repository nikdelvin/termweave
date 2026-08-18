import { describe, expect, test } from 'bun:test'
import { createImagePlaybackController } from '../termweave/components/image-controller'
import type { AnimationFrame } from '../termweave/components/pixel-frame'

function animationFrame(value: number, delayMs: number): AnimationFrame {
  return { width: 2, height: 2, data: new Uint8Array(16).fill(value), delayMs }
}

function last<T>(values: readonly T[]) {
  return values[values.length - 1]
}

describe('image lifecycle controller', () => {
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
    const controller = createImagePlaybackController({
      onError: (error) => {
        if (error !== undefined) errors.push(error)
      },
      onFrame: (frame) => shown.push(frame),
      load: (uri, maximum, _background, signal) =>
        new Promise((resolve) => pending.push({ resolve, signal, uri, width: maximum.width })),
      play: (frames, onFrame) => {
        playbackCallbacks.push(onFrame)
        onFrame(frames[0]!)
        return () => {
          stopped += 1
        }
      },
    })

    controller.replace({
      uri: 'first.png',
      maximum: { width: 8, height: 8 },
      background: [0, 0, 0],
    })
    controller.replace({
      uri: 'second.png',
      maximum: { width: 8, height: 8 },
      background: [0, 0, 0],
    })
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
    const controller = createImagePlaybackController({
      onError: (error) => {
        if (error !== undefined) errors.push(error)
      },
      onFrame: (frame) => shown.push(frame),
      load: async (uri, _maximum, _background, signal) => {
        if (signal) signals.push(signal)
        if (uri === 'bad.png') throw new Error('decode failed')
        return [animationFrame(uri.length, 20), animationFrame(uri.length + 1, 20)]
      },
      play: (frames, onFrame) => {
        onFrame(frames[0]!)
        return () => {
          stopCount += 1
        }
      },
    })

    controller.replace({ uri: '', maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
    expect(String(last(errors))).toContain('Image URI is required')
    controller.replace({ uri: 'zero.png', maximum: { width: 0, height: 4 }, background: [0, 0, 0] })
    expect(signals).toHaveLength(0)
    controller.replace({ uri: 'bad.png', maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
    await Promise.resolve()
    await Promise.resolve()
    expect(String(last(errors))).toContain('decode failed')

    for (const uri of ['a.png', 'bb.png', 'ccc.png']) {
      controller.replace({ uri, maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
      await Promise.resolve()
    }
    expect(last(shown)?.data[0]).toBe(7)

    controller.replace({ uri: 'bad.png', maximum: { width: 4, height: 4 }, background: [0, 0, 0] })
    await Promise.resolve()
    await Promise.resolve()
    expect(last(shown)).toBeUndefined()

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

  test('starts cached frames synchronously without loading the source again', () => {
    const shown: Array<AnimationFrame | undefined> = []
    const cached = [animationFrame(42, 20)]
    let loadCount = 0
    const controller = createImagePlaybackController({
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
})
