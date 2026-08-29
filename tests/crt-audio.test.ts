import { describe, expect, test } from 'bun:test'
import type { Audio, AudioPlayOptions } from '@opentui/core'
import { createCrtAudio } from '../termweave/crt-audio'
import { deferred } from './support/deferred'

describe('CRT audio', () => {
  test('plays turn-on once before looping noise at 0.5 volume', async () => {
    const events: string[] = []
    const plays: Array<{ sound: number; options?: AudioPlayOptions }> = []
    let voicesActive = 1
    const audio = {
      async loadSoundFile(path: string) {
        events.push(`load:${path}`)
        return path === 'turn-on.mp3' ? 1 : 2
      },
      play(sound: number, options?: AudioPlayOptions) {
        events.push(`play:${sound}`)
        plays.push({ sound, options })
        return sound + 10
      },
      getStats() {
        events.push(`stats:${voicesActive}`)
        return { voicesActive }
      },
      stopVoice(voice: number) {
        events.push(`stop:${voice}`)
        return true
      },
      unloadSound(sound: number) {
        events.push(`unload:${sound}`)
        return true
      },
    } as unknown as Audio
    const crtAudio = createCrtAudio({
      acquireAudio: () => ({
        audio,
        release: () => events.push('release'),
      }),
      noisePath: 'crt-noise.mp3',
      now: () => 0,
      sleep: async () => {
        events.push('sleep')
        voicesActive = 0
      },
      turnOnPath: 'turn-on.mp3',
    })

    await crtAudio.start()

    expect(plays).toEqual([
      { sound: 1, options: { volume: 1 } },
      { sound: 2, options: { loop: true, volume: 0.5 } },
    ])
    expect(events.indexOf('play:2')).toBeGreaterThan(events.indexOf('stats:0'))
    expect(events).toContain('unload:1')

    crtAudio.stop()
    crtAudio.stop()
    expect(events.slice(-3)).toEqual(['stop:12', 'unload:2', 'release'])
  })

  test('cancels startup without playing noise and releases the engine once', async () => {
    const turnOnLoad = deferred<number | null>()
    const played: number[] = []
    const unloaded: number[] = []
    let released = 0
    const audio = {
      loadSoundFile: () => turnOnLoad.promise,
      play(sound: number) {
        played.push(sound)
        return sound + 10
      },
      unloadSound(sound: number) {
        unloaded.push(sound)
        return true
      },
      stopVoice: () => true,
      getStats: () => ({ voicesActive: 0 }),
    } as unknown as Audio
    const crtAudio = createCrtAudio({
      acquireAudio: () => ({
        audio,
        release: () => {
          released += 1
        },
      }),
      noisePath: 'crt-noise.mp3',
      turnOnPath: 'turn-on.mp3',
    })

    const startup = crtAudio.start()
    crtAudio.stop()
    turnOnLoad.resolve(1)
    await startup

    expect(played).toEqual([])
    expect(unloaded).toEqual([1])
    expect(released).toBe(1)
  })

  test('contains native audio failures and permits a later retry', async () => {
    let acquired = 0
    let released = 0
    const audio = {
      loadSoundFile: async () => null,
    } as unknown as Audio
    const crtAudio = createCrtAudio({
      acquireAudio: () => {
        acquired += 1
        return {
          audio,
          release: () => {
            released += 1
          },
        }
      },
    })

    await expect(crtAudio.start()).resolves.toBeUndefined()
    await expect(crtAudio.start()).resolves.toBeUndefined()
    expect(acquired).toBe(2)
    expect(released).toBe(2)
  })
})
