import { describe, expect, test } from 'bun:test'
import { createComputed, createRoot } from 'solid-js'
import { createScreenNavigation } from '#termweave'

describe('SDK screen navigation', () => {
  test('exposes a frozen key-agnostic accessor and action', () => {
    const navigation = createScreenNavigation<'first' | 'second'>('first')
    expect(Object.isFrozen(navigation)).toBe(true)
    expect(navigation.screen()).toBe('first')
    navigation.navigate('second')
    expect(navigation.screen()).toBe('second')
  })

  test('does not notify dependents when navigating to the active screen', () => {
    const navigation = createScreenNavigation<'first' | 'second'>('first')
    let updates = 0
    const dispose = createRoot((disposeRoot) => {
      createComputed(() => {
        navigation.screen()
        updates += 1
      })
      return disposeRoot
    })

    expect(updates).toBe(1)
    navigation.navigate('first')
    expect(updates).toBe(1)
    dispose()
  })
})
