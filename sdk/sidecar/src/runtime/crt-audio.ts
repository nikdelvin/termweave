import { setupAudio, type Audio } from '@opentui/core'
import { CRT_EFFECT_DEFAULTS, CRT_EFFECTS_ENABLED } from '../../../shared/terminal-config'
import crtNoisePath from '../assets/crt-noise.mp3' with { type: 'file' }
import crtTurnOnPath from '../assets/turn-on.mp3' with { type: 'file' }

const TURN_ON_COMPLETION_TIMEOUT_MS = 2_000
const TURN_ON_POLL_INTERVAL_MS = 10
const TURN_ON_VOLUME = 1

export function createCrtAudio() {
  let activeAudio: Audio | undefined

  const stop = () => {
    const audio = activeAudio
    activeAudio = undefined
    audio?.dispose()
  }

  const waitForTurnOnSound = async (audio: Audio) => {
    const deadline = performance.now() + TURN_ON_COMPLETION_TIMEOUT_MS
    let voiceObserved = false

    while (activeAudio === audio) {
      const stats = audio.getStats()
      if (stats && stats.voicesActive > 0) voiceObserved = true
      if (stats?.voicesActive === 0 && voiceObserved) return true
      if (performance.now() >= deadline) return false
      await Bun.sleep(TURN_ON_POLL_INTERVAL_MS)
    }

    return false
  }

  const start = async () => {
    if (activeAudio) return
    if (!CRT_EFFECTS_ENABLED) return

    let audio: Audio | undefined
    try {
      audio = setupAudio({ autoStart: true })
      activeAudio = audio
      audio.on('error', () => {})

      const turnOnSound = await audio.loadSoundFile(crtTurnOnPath)
      if (activeAudio !== audio) return
      if (turnOnSound === null) throw new Error('OpenTUI could not load the CRT turn-on MP3')

      const turnOnVoice = audio.play(turnOnSound, { volume: TURN_ON_VOLUME })
      if (turnOnVoice === null) throw new Error('OpenTUI could not play the CRT turn-on sound')

      const [noiseSound, turnOnCompleted] = await Promise.all([
        audio.loadSoundFile(crtNoisePath),
        waitForTurnOnSound(audio),
      ])
      if (activeAudio !== audio) return
      if (noiseSound === null) throw new Error('OpenTUI could not load the CRT noise MP3')

      if (!turnOnCompleted) {
        audio.stopVoice(turnOnVoice)
      }
      audio.unloadSound(turnOnSound)

      const noiseVoice = audio.play(noiseSound, {
        loop: true,
        volume: CRT_EFFECT_DEFAULTS.soundVolume,
      })
      if (noiseVoice === null) throw new Error('OpenTUI could not start the CRT noise loop')
    } catch {
      if (activeAudio === audio) stop()
      else audio?.dispose()
    }
  }

  return { start, stop }
}
