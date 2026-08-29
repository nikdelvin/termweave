import { createSignal, type Accessor } from 'solid-js'

export interface ScreenNavigation<Screen> {
  readonly screen: Accessor<Screen>
  navigate(destination: Screen): void
}

export function createScreenNavigation<Screen>(initialScreen: Screen): ScreenNavigation<Screen> {
  const [screen, setScreen] = createSignal<Screen>(initialScreen)

  return Object.freeze({
    screen,
    navigate(destination: Screen) {
      setScreen(() => destination)
    },
  })
}
