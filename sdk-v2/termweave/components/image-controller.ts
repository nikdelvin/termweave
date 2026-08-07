import { loadLocalImageFrames } from './image-decoder'
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
  load?: typeof loadLocalImageFrames
  play?: typeof startFramePlayback
}

export function createImagePlaybackController({
  onError,
  onFrame,
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
    onFrame(undefined)
    onError(undefined)

    const uri = request.uri.trim()
    if (!uri) {
      onError(new Error('Image URI is required.'))
      return
    }
    if (request.maximum.width < 2 || request.maximum.height < 2) return

    const requestGeneration = generation
    const controller = new AbortController()
    abortController = controller
    void load(uri, request.maximum, request.background, controller.signal)
      .then((frames) => {
        if (disposed || controller.signal.aborted || requestGeneration !== generation) return
        abortController = undefined
        const publishFrame = (frame: AnimationFrame) => {
          if (!disposed && !controller.signal.aborted && requestGeneration === generation) {
            onFrame(frame)
          }
        }
        stopPlayback = play(frames, publishFrame, {
          onError: (error) => {
            if (!disposed && requestGeneration === generation) onError(error)
          },
        })
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
      onFrame(undefined)
    },
  }
}
