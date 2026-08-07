import { describe, expect, test } from 'bun:test'
import {
  createGlyphAtlasMonitor,
  glyphAtlasRecyclePageThreshold,
  type AnimationFrameScheduler,
} from '../termweave/host/crt-effects/glyph-atlas'

class FakeFrameScheduler implements AnimationFrameScheduler<number> {
  private nextHandle = 1
  readonly callbacks = new Map<number, () => void>()
  maximumPending = 0

  request(callback: () => void) {
    const handle = this.nextHandle
    this.nextHandle += 1
    this.callbacks.set(handle, callback)
    this.maximumPending = Math.max(this.maximumPending, this.callbacks.size)
    return handle
  }

  cancel(handle: number) {
    this.callbacks.delete(handle)
  }

  runNext() {
    const next = this.callbacks.entries().next().value as [number, () => void] | undefined
    if (!next) return false
    this.callbacks.delete(next[0])
    next[1]()
    return true
  }
}

describe('glyph-atlas pressure monitor', () => {
  test('keeps four texture units in reserve on normal WebGL limits', () => {
    expect(glyphAtlasRecyclePageThreshold(32)).toBe(28)
    expect(glyphAtlasRecyclePageThreshold(16)).toBe(12)
    expect(glyphAtlasRecyclePageThreshold(8)).toBe(4)
    expect(glyphAtlasRecyclePageThreshold(4)).toBe(4)
    expect(() => glyphAtlasRecyclePageThreshold(0)).toThrow(RangeError)
    expect(() => glyphAtlasRecyclePageThreshold(1.5)).toThrow(RangeError)
  })

  test('coalesces pressure into one scheduled recycle and rechecks before firing', () => {
    const scheduler = new FakeFrameScheduler()
    let recycles = 0
    const monitor = createGlyphAtlasMonitor({ scheduler, onRecycle: () => (recycles += 1) })
    monitor.setMaximumPages(16)
    const pages = Array.from({ length: 12 }, () => ({}))

    for (const page of pages.slice(0, 11)) monitor.addPage(page)
    expect(scheduler.callbacks.size).toBe(0)
    monitor.addPage(pages[11]!)
    monitor.addPage({})
    expect(scheduler.callbacks.size).toBe(1)
    expect(scheduler.maximumPending).toBe(1)

    monitor.removePage(pages[0]!)
    monitor.removePage(pages[1]!)
    scheduler.runNext()
    expect(recycles).toBe(0)

    monitor.addPage(pages[0]!)
    monitor.addPage(pages[1]!)
    scheduler.runNext()
    expect(recycles).toBe(1)
  })

  test('cancels stale work on generation replacement and disposal', () => {
    const scheduler = new FakeFrameScheduler()
    let recycles = 0
    const monitor = createGlyphAtlasMonitor({ scheduler, onRecycle: () => (recycles += 1) })
    monitor.setMaximumPages(8)
    for (let page = 0; page < 4; page += 1) monitor.addPage({})
    expect(scheduler.callbacks.size).toBe(1)

    monitor.resetGeneration()
    expect(monitor.pageCount).toBe(0)
    expect(scheduler.callbacks.size).toBe(0)
    scheduler.runNext()
    expect(recycles).toBe(0)

    monitor.setMaximumPages(8)
    for (let page = 0; page < 4; page += 1) monitor.addPage({})
    monitor.dispose()
    expect(scheduler.callbacks.size).toBe(0)
    monitor.addPage({})
    expect(monitor.pageCount).toBe(0)
  })

  test('tracks replacement atlases without retaining old page objects', () => {
    const scheduler = new FakeFrameScheduler()
    const monitor = createGlyphAtlasMonitor({ scheduler, onRecycle() {} })
    monitor.setMaximumPages(16)
    monitor.addPage({})
    monitor.addPage({})
    expect(monitor.pageCount).toBe(2)
    monitor.changePage({})
    expect(monitor.pageCount).toBe(1)
  })
})
