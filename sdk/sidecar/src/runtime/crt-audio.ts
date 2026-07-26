import type { Audio, AudioSound, AudioVoice } from '@opentui/core'
import { CRT_EFFECT_DEFAULTS, CRT_EFFECTS_ENABLED } from '../../../shared/terminal-config'
import { sharedAudioEngine, type AudioEngineLease } from '../../sdk/src/helpers/audio-engine'
import crtNoisePath from '../assets/crt-noise.mp3' with { type: 'file' }
import crtTurnOnPath from '../assets/turn-on.mp3' with { type: 'file' }

const TURN_ON_COMPLETION_TIMEOUT_MS = 2_000
const TURN_ON_POLL_INTERVAL_MS = 10
const TURN_ON_VOLUME = 1

interface CrtAudioState {
  audio: Audio
  lease: AudioEngineLease
  noiseSound?: AudioSound
  noiseVoice?: AudioVoice
  turnOnSound?: AudioSound
  turnOnVoice?: AudioVoice
}

export function createCrtAudio() {
  let activeState: CrtAudioState | undefined

  const disposeState = (state: CrtAudioState) => {
    if (state.noiseVoice !== undefined) state.audio.stopVoice(state.noiseVoice)
    if (state.turnOnVoice !== undefined) state.audio.stopVoice(state.turnOnVoice)
    if (state.noiseSound !== undefined) state.audio.unloadSound(state.noiseSound)
    if (state.turnOnSound !== undefined) state.audio.unloadSound(state.turnOnSound)
    state.lease.release()
  }

  const stop = () => {
    const state = activeState
    activeState = undefined
    if (state) disposeState(state)
  }

  const waitForTurnOnSound = async (state: CrtAudioState) => {
    const deadline = performance.now() + TURN_ON_COMPLETION_TIMEOUT_MS
    let voiceObserved = false

    while (activeState === state) {
      const stats = state.audio.getStats()
      if (stats && stats.voicesActive > 0) voiceObserved = true
      if (stats?.voicesActive === 0 && voiceObserved) return true
      if (performance.now() >= deadline) return false
      await Bun.sleep(TURN_ON_POLL_INTERVAL_MS)
    }

    return false
  }

  const start = async () => {
    if (activeState) return
    if (!CRT_EFFECTS_ENABLED) return

    let state: CrtAudioState | undefined
    try {
      const lease = sharedAudioEngine.acquire()
      state = { audio: lease.audio, lease }
      activeState = state

      const turnOnSound = await state.audio.loadSoundFile(crtTurnOnPath)
      if (activeState !== state) return
      if (turnOnSound === null) throw new Error('OpenTUI could not load the CRT turn-on MP3')
      state.turnOnSound = turnOnSound

      const turnOnVoice = state.audio.play(turnOnSound, { volume: TURN_ON_VOLUME })
      if (turnOnVoice === null) throw new Error('OpenTUI could not play the CRT turn-on sound')
      state.turnOnVoice = turnOnVoice

      const [noiseSound, turnOnCompleted] = await Promise.all([
        state.audio.loadSoundFile(crtNoisePath),
        waitForTurnOnSound(state),
      ])
      if (activeState !== state) return
      if (noiseSound === null) throw new Error('OpenTUI could not load the CRT noise MP3')
      state.noiseSound = noiseSound

      if (!turnOnCompleted) {
        state.audio.stopVoice(turnOnVoice)
      }
      state.turnOnVoice = undefined
      state.audio.unloadSound(turnOnSound)
      state.turnOnSound = undefined

      const noiseVoice = state.audio.play(noiseSound, {
        loop: true,
        volume: CRT_EFFECT_DEFAULTS.soundVolume,
      })
      if (noiseVoice === null) throw new Error('OpenTUI could not start the CRT noise loop')
      state.noiseVoice = noiseVoice
    } catch {
      if (state && activeState === state) stop()
      else if (state) disposeState(state)
    }
  }

  return { start, stop }
}
