import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createComputed, createRoot } from 'solid-js'
import { navigate, screen } from '../app/app-store'
import type { ScreenKey } from '../app/screens'

beforeEach(() => navigate('/'))
afterEach(() => navigate('/'))

describe('global application store', () => {
  test('starts on the home screen', () => {
    expect(screen()).toBe('/')
  })

  test('updates the global accessor synchronously', () => {
    navigate('/gallery')
    expect(screen()).toBe('/gallery')
  })

  test('does not notify dependents when navigating to the active screen', () => {
    navigate('/plain')
    let updates = 0
    const dispose = createRoot((disposeRoot) => {
      createComputed(() => {
        screen()
        updates += 1
      })
      return disposeRoot
    })

    expect(updates).toBe(1)
    navigate('/plain')
    expect(updates).toBe(1)
    dispose()
  })

  test('accepts only keys from the screen registry', () => {
    type NavigateDestination = Parameters<typeof navigate>[0]
    const destination: NavigateDestination = '/gallery'
    const screenKey: ScreenKey = destination
    expect(screenKey).toBe('/gallery')

    // @ts-expect-error ScreenKey is derived from the keys in app/screens.ts.
    const invalidDestination: NavigateDestination = '/missing'
    expect(String(invalidDestination)).toBe('/missing')
  })
})
