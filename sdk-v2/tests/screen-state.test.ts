import { describe, expect, test } from 'bun:test'
import {
  GALLERY_SCREEN,
  HOME_SCREEN,
  PLAIN_SCREEN,
  screenForVerticalKey,
} from '../app/screen-state'

const key = (
  name: string,
  sequence: string,
  overrides: Partial<Parameters<typeof screenForVerticalKey>[1]> = {},
) => ({
  ctrl: false,
  hyper: false,
  meta: false,
  name,
  option: false,
  sequence,
  shift: false,
  super: false,
  ...overrides,
})

describe('native screen state', () => {
  test('cycles all three screens with exact plain CSI and SS3 vertical arrows', () => {
    expect(screenForVerticalKey(HOME_SCREEN, key('down', '\u001b[B'))).toBe(GALLERY_SCREEN)
    expect(screenForVerticalKey(GALLERY_SCREEN, key('down', '\u001bOB'))).toBe(PLAIN_SCREEN)
    expect(screenForVerticalKey(PLAIN_SCREEN, key('down', '\u001b[B'))).toBe(HOME_SCREEN)

    expect(screenForVerticalKey(HOME_SCREEN, key('up', '\u001b[A'))).toBe(PLAIN_SCREEN)
    expect(screenForVerticalKey(PLAIN_SCREEN, key('up', '\u001bOA'))).toBe(GALLERY_SCREEN)
    expect(screenForVerticalKey(GALLERY_SCREEN, key('up', '\u001b[A'))).toBe(HOME_SCREEN)
  })

  test('rejects modified, mismatched, horizontal, tab, and ordinary input', () => {
    for (const modifier of ['ctrl', 'hyper', 'meta', 'option', 'shift', 'super'] as const) {
      expect(
        screenForVerticalKey(HOME_SCREEN, key('down', '\u001b[B', { [modifier]: true })),
      ).toBeUndefined()
    }

    expect(screenForVerticalKey(HOME_SCREEN, key('up', '\u001b[B'))).toBeUndefined()
    expect(screenForVerticalKey(HOME_SCREEN, key('left', '\u001b[D'))).toBeUndefined()
    expect(screenForVerticalKey(HOME_SCREEN, key('tab', '\t'))).toBeUndefined()
    expect(screenForVerticalKey(HOME_SCREEN, key('a', 'a'))).toBeUndefined()
  })
})
