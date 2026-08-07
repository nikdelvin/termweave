export const GLYPH_ATLAS_PAGE_RESERVE = 4

export function glyphAtlasRecyclePageThreshold(maximumPages: number) {
  if (!Number.isInteger(maximumPages) || maximumPages < 1) {
    throw new RangeError('Glyph atlas maximum page count must be a positive integer.')
  }

  return maximumPages > GLYPH_ATLAS_PAGE_RESERVE
    ? maximumPages - GLYPH_ATLAS_PAGE_RESERVE
    : maximumPages
}

export interface AnimationFrameScheduler<Handle = unknown> {
  request(callback: () => void): Handle
  cancel(handle: Handle): void
}

interface GlyphAtlasMonitorOptions<Handle> {
  onRecycle(): void
  scheduler: AnimationFrameScheduler<Handle>
}

export interface GlyphAtlasMonitor {
  readonly pageCount: number
  addPage(page: object): void
  changePage(page: object): void
  removePage(page: object): void
  setMaximumPages(maximumPages: number): void
  resetGeneration(): void
  dispose(): void
}

/** Coalesces atlas pressure into at most one addon-recreation request per animation frame. */
export function createGlyphAtlasMonitor<Handle>({
  onRecycle,
  scheduler,
}: GlyphAtlasMonitorOptions<Handle>): GlyphAtlasMonitor {
  const pages = new Set<object>()
  let disposed = false
  let generation = 0
  let maximumPages: number | undefined
  let scheduled: Handle | undefined

  const cancelScheduled = () => {
    if (scheduled === undefined) return
    scheduler.cancel(scheduled)
    scheduled = undefined
  }

  const scheduleIfNeeded = () => {
    if (
      disposed ||
      scheduled !== undefined ||
      maximumPages === undefined ||
      pages.size < glyphAtlasRecyclePageThreshold(maximumPages)
    ) {
      return
    }

    const scheduledGeneration = generation
    scheduled = scheduler.request(() => {
      scheduled = undefined
      if (
        disposed ||
        generation !== scheduledGeneration ||
        maximumPages === undefined ||
        pages.size < glyphAtlasRecyclePageThreshold(maximumPages)
      ) {
        return
      }
      onRecycle()
    })
  }

  return {
    get pageCount() {
      return pages.size
    },
    addPage(page) {
      if (disposed) return
      pages.add(page)
      scheduleIfNeeded()
    },
    changePage(page) {
      if (disposed) return
      pages.clear()
      pages.add(page)
      scheduleIfNeeded()
    },
    removePage(page) {
      pages.delete(page)
    },
    setMaximumPages(value) {
      if (disposed) return
      maximumPages = value
      glyphAtlasRecyclePageThreshold(value)
      scheduleIfNeeded()
    },
    resetGeneration() {
      if (disposed) return
      generation += 1
      cancelScheduled()
      pages.clear()
      maximumPages = undefined
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelScheduled()
      pages.clear()
      maximumPages = undefined
    },
  }
}

export const browserAnimationFrameScheduler: AnimationFrameScheduler<
  number | ReturnType<typeof setTimeout>
> = {
  request(callback) {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      return globalThis.requestAnimationFrame(() => callback())
    }
    return globalThis.setTimeout(callback, 0)
  },
  cancel(handle) {
    if (typeof handle === 'number' && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(handle)
    } else {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
    }
  },
}
