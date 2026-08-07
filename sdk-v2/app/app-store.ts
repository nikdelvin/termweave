import { createSignal, type Accessor } from 'solid-js'
import type { ScreenKey } from './screens'

const [activeScreen, setScreen] = createSignal<ScreenKey>('/')

export const screen: Accessor<ScreenKey> = activeScreen

export function navigate(destination: ScreenKey) {
  setScreen(destination)
}
