import { describe, expect, test } from 'bun:test'
import { errorMessage } from '../termweave/error-message'

describe('error message normalization', () => {
  test('uses the message from Error instances', () => {
    expect(errorMessage(new Error('failed'))).toBe('failed')
  })

  test('stringifies non-Error failures', () => {
    expect(errorMessage('failed')).toBe('failed')
    expect(errorMessage(42)).toBe('42')
  })
})
