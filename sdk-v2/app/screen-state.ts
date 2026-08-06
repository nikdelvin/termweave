import type { KeyEvent } from '@opentui/core'

export const HOME_SCREEN = '/'
export const GALLERY_SCREEN = '/gallery'
export const PLAIN_SCREEN = '/plain'

export type ScreenId = typeof HOME_SCREEN | typeof GALLERY_SCREEN | typeof PLAIN_SCREEN

const screens = [HOME_SCREEN, GALLERY_SCREEN, PLAIN_SCREEN] as const

type VerticalKey = Pick<
  KeyEvent,
  'ctrl' | 'hyper' | 'meta' | 'name' | 'option' | 'sequence' | 'shift' | 'super'
>

const verticalSequences: Readonly<Record<'down' | 'up', readonly string[]>> = {
  up: ['\u001b[A', '\u001bOA'],
  down: ['\u001b[B', '\u001bOB'],
}

export function screenForVerticalKey(current: ScreenId, key: VerticalKey): ScreenId | undefined {
  if (key.ctrl || key.hyper || key.meta || key.option || key.shift || key.super) return undefined

  const direction =
    key.name === 'up' && verticalSequences.up.includes(key.sequence)
      ? -1
      : key.name === 'down' && verticalSequences.down.includes(key.sequence)
        ? 1
        : undefined

  if (direction === undefined) return undefined

  const currentIndex = screens.indexOf(current)
  return screens[(currentIndex + direction + screens.length) % screens.length]
}
