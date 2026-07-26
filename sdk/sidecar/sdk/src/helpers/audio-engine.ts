import { setupAudio, type Audio } from '@opentui/core'

export interface AudioEngineLease {
  audio: Audio
  release: () => void
}

export function createAudioEnginePool(
  createAudio: () => Audio = () => setupAudio({ autoStart: true }),
) {
  let audio: Audio | undefined
  let references = 0

  return {
    acquire(): AudioEngineLease {
      audio ??= createAudio()
      if (references === 0) audio.on('error', ignoreAudioError)
      references += 1

      const leasedAudio = audio
      let released = false
      return {
        audio: leasedAudio,
        release: () => {
          if (released) return
          released = true
          references -= 1
          if (references > 0 || audio !== leasedAudio) return

          audio = undefined
          leasedAudio.off('error', ignoreAudioError)
          leasedAudio.dispose()
        },
      }
    },

    get referenceCount() {
      return references
    },
  }
}

function ignoreAudioError() {}

export const sharedAudioEngine = createAudioEnginePool()
