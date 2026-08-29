import type { Audio, AudioSound, AudioVoice } from '@opentui/core'
import crtNoisePath from './assets/crt-noise.mp3' with { type: 'file' }
import crtTurnOnPath from './assets/turn-on.mp3' with { type: 'file' }
import { sharedAudioEngine, type AudioEngineLease } from './media/audio'

const TURN_ON_COMPLETION_TIMEOUT_MS = 2_000
const TURN_ON_POLL_INTERVAL_MS = 10
const TURN_ON_VOLUME = 1
const CRT_NOISE_VOLUME = 0.5

interface CrtAudioState {
  audio: Audio
  lease: AudioEngineLease
  noiseSound?: AudioSound
  noiseVoice?: AudioVoice
  turnOnSound?: AudioSound
  turnOnVoice?: AudioVoice
}

export interface CrtAudioDependencies {
  acquireAudio(): AudioEngineLease
  noisePath: string
  now(): number
  sleep(milliseconds: number): Promise<unknown>
  turnOnPath: string
}

const defaultDependencies: CrtAudioDependencies = {
  acquireAudio: () => sharedAudioEngine.acquire(),
  noisePath: crtNoisePath,
  now: () => performance.now(),
  sleep: (milliseconds) => Bun.sleep(milliseconds),
  turnOnPath: crtTurnOnPath,
}

function safely(action: () => void) {
  try {
    action()
  } catch {
    // CRT ambience must never interfere with application startup or shutdown.
  }
}

export function createCrtAudio(overrides: Partial<CrtAudioDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  let activeState: CrtAudioState | undefined

  const disposeState = (state: CrtAudioState) => {
    if (state.noiseVoice !== undefined) safely(() => state.audio.stopVoice(state.noiseVoice!))
    if (state.turnOnVoice !== undefined) safely(() => state.audio.stopVoice(state.turnOnVoice!))
    if (state.noiseSound !== undefined) safely(() => state.audio.unloadSound(state.noiseSound!))
    if (state.turnOnSound !== undefined) safely(() => state.audio.unloadSound(state.turnOnSound!))
    safely(state.lease.release)
  }

  const stop = () => {
    const state = activeState
    activeState = undefined
    if (state) disposeState(state)
  }

  const waitForTurnOnSound = async (state: CrtAudioState) => {
    const deadline = dependencies.now() + TURN_ON_COMPLETION_TIMEOUT_MS
    let voiceObserved = false

    while (activeState === state) {
      const stats = state.audio.getStats()
      if (stats && stats.voicesActive > 0) voiceObserved = true
      if (stats?.voicesActive === 0 && voiceObserved) return true
      if (dependencies.now() >= deadline) return false
      await dependencies.sleep(TURN_ON_POLL_INTERVAL_MS)
    }

    return false
  }

  const start = async () => {
    if (activeState) return

    let state: CrtAudioState | undefined
    try {
      const lease = dependencies.acquireAudio()
      state = { audio: lease.audio, lease }
      activeState = state

      const turnOnSound = await state.audio.loadSoundFile(dependencies.turnOnPath)
      if (activeState !== state) {
        if (turnOnSound !== null) safely(() => state!.audio.unloadSound(turnOnSound))
        return
      }
      if (turnOnSound === null) throw new Error('OpenTUI could not load the CRT turn-on MP3')
      state.turnOnSound = turnOnSound

      const turnOnVoice = state.audio.play(turnOnSound, { volume: TURN_ON_VOLUME })
      if (turnOnVoice === null) throw new Error('OpenTUI could not play the CRT turn-on sound')
      state.turnOnVoice = turnOnVoice

      const [noiseSound, turnOnCompleted] = await Promise.all([
        state.audio.loadSoundFile(dependencies.noisePath),
        waitForTurnOnSound(state),
      ])
      if (activeState !== state) {
        if (noiseSound !== null) safely(() => state!.audio.unloadSound(noiseSound))
        return
      }
      if (noiseSound === null) throw new Error('OpenTUI could not load the CRT noise MP3')
      state.noiseSound = noiseSound

      if (!turnOnCompleted) state.audio.stopVoice(turnOnVoice)
      state.turnOnVoice = undefined
      state.audio.unloadSound(turnOnSound)
      state.turnOnSound = undefined

      const noiseVoice = state.audio.play(noiseSound, {
        loop: true,
        volume: CRT_NOISE_VOLUME,
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
