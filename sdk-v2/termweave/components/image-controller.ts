import { getCachedLocalImageFrames, loadLocalImageFrames } from './image-decoder'
import { startFramePlayback } from './image-playback'
import { createImageAbortError, isAbortError } from './image-source'
import type { AnimationFrame, Dimensions, Rgb } from './pixel-frame'
import { startStreamingMediaPlayback, usesStreamingMediaPipeline } from './streaming-media'

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
  stream?: typeof startStreamingMediaPlayback
}

export function createImagePlaybackController({
  onError,
  onFrame,
  getCached = getCachedLocalImageFrames,
  load = loadLocalImageFrames,
  play = startFramePlayback,
  stream = startStreamingMediaPlayback,
}: ImageControllerOptions) {
  let abortController: AbortController | undefined
  let stopPlayback: (() => void) | undefined
  let generation = 0
  let disposed = false
  let currentFrame: AnimationFrame | undefined

  const showFrame = (frame: AnimationFrame | undefined) => {
    const previous = currentFrame
    currentFrame = frame
    onFrame(frame)
    if (previous !== frame) previous?.release?.()
  }

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
      showFrame(undefined)
      onError(new Error('Image URI is required.'))
      return
    }
    if (request.maximum.width < 2 || request.maximum.height < 2) return

    const requestGeneration = generation
    const publishFrame = (frame: AnimationFrame) => {
      if (!disposed && requestGeneration === generation) showFrame(frame)
      else frame.release?.()
    }

    if (usesStreamingMediaPipeline(uri)) {
      stopPlayback = stream(request, {
        onError: (error) => {
          if (!disposed && requestGeneration === generation) onError(error)
        },
        onFrame: publishFrame,
      })
      return
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
        onError(error)
      })
  }

  return {
    replace,
    dispose() {
      if (disposed) return
      disposed = true
      cancel()
      showFrame(undefined)
    },
  }
}
