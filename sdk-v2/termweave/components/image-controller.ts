import { getCachedLocalImageFrames, loadLocalImageFrames } from './image-decoder'
import { startFramePlayback } from './image-playback'
import { createImageAbortError, isAbortError } from './image-source'
import type { AnimationFrame, Dimensions, Rgb } from './pixel-frame'

export interface ImageRequest {
  uri: string
  maximum: Dimensions
  background: Rgb
}

export interface ImageControllerOptions {
  onError(error: unknown | undefined): void
  onFrame(frame: AnimationFrame | undefined): void
  getCached?: typeof getCachedLocalImageFrames
  load?: typeof loadLocalImageFrames
  play?: typeof startFramePlayback
}

export function createImagePlaybackController({
  onError,
  onFrame,
  getCached = getCachedLocalImageFrames,
  load = loadLocalImageFrames,
  play = startFramePlayback,
}: ImageControllerOptions) {
  let abortController: AbortController | undefined
  let stopPlayback: (() => void) | undefined
  let generation = 0
  let disposed = false

  const cancel = () => {
    generation += 1
    abortController?.abort(createImageAbortError())
    abortController = undefined
    stopPlayback?.()
    stopPlayback = undefined
  }

  const replace = (request: ImageRequest) => {
    if (disposed) return
    cancel()
    onError(undefined)

    const uri = request.uri.trim()
    if (!uri) {
      onFrame(undefined)
      onError(new Error('Image URI is required.'))
      return
    }
    if (request.maximum.width < 2 || request.maximum.height < 2) return

    const requestGeneration = generation
    const publishFrame = (frame: AnimationFrame) => {
      if (!disposed && requestGeneration === generation) onFrame(frame)
    }
    const beginPlayback = (frames: readonly AnimationFrame[]) => {
      if (disposed || requestGeneration !== generation) return
      stopPlayback = play(frames, publishFrame, {
        onError: (error) => {
          if (!disposed && requestGeneration === generation) onError(error)
        },
      })
    }

    const cached = getCached(uri, request.maximum, request.background)
    if (cached) {
      try {
        beginPlayback(cached)
      } catch (error) {
        onFrame(undefined)
        onError(error)
      }
      return
    }

    const controller = new AbortController()
    abortController = controller
    void load(uri, request.maximum, request.background, controller.signal)
      .then((frames) => {
        if (disposed || controller.signal.aborted || requestGeneration !== generation) return
        abortController = undefined
        beginPlayback(frames)
      })
      .catch((error: unknown) => {
        if (
          disposed ||
          controller.signal.aborted ||
          requestGeneration !== generation ||
          isAbortError(error)
        ) {
          return
        }
        abortController = undefined
        onFrame(undefined)
        onError(error)
      })
  }

  return {
    replace,
    dispose() {
      if (disposed) return
      disposed = true
      cancel()
      onFrame(undefined)
    },
  }
}
