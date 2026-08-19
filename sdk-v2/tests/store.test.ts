import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appState, navigate, resetAppState, screen, setInputText } from '../app/store'
import type { ScreenKey } from '../app/screens'

beforeEach(() => {
  resetAppState()
  navigate('animation')
})

afterEach(() => {
  resetAppState()
  navigate('animation')
})

describe('global application store', () => {
  test('starts with deterministic application and navigation state', () => {
    expect(appState).toEqual({ inputText: '' })
    expect(screen()).toBe('animation')
  })

  test('updates and resets application data independently of navigation', () => {
    setInputText('persistent')
    navigate('picture')
    expect(appState).toEqual({ inputText: 'persistent' })

    resetAppState()
    expect(appState).toEqual({ inputText: '' })
    expect(screen()).toBe('picture')
  })

  test('accepts only keys from the screen registry', () => {
    type NavigateDestination = Parameters<typeof navigate>[0]
    const destination: NavigateDestination = 'picture'
    const screenKey: ScreenKey = destination
    expect(screenKey).toBe('picture')

    // @ts-expect-error ScreenKey is derived from the keys in app/screens.ts.
    const invalidDestination: NavigateDestination = 'missing'
    expect(String(invalidDestination)).toBe('missing')
  })
})
