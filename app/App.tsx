import { Dynamic, useKeyboard } from '@opentui/solid'
import { getTermweaveConfig, PixelRenderer } from '#termweave'
import { Show } from 'solid-js'
import { navigate, screen } from './store'
import { screenMedia, screens } from './screens'

const screenOrder = Object.keys(screens) as (keyof typeof screens)[]

export function App() {
  const config = getTermweaveConfig()
  const mediaUri = () => screenMedia[screen()]
  const CurrentScreen = () => <Dynamic component={screens[screen()]} />

  // This callback is the template user's keyboard configuration. navigate() itself is key-agnostic.
  useKeyboard((key) => {
    if (key.ctrl || key.hyper || key.meta || key.option || key.shift || key.super) return

    const delta = key.name === 'left' ? -1 : key.name === 'right' ? 1 : 0
    if (delta === 0) return

    key.preventDefault()
    const currentIndex = screenOrder.indexOf(screen())
    const nextIndex = (currentIndex + delta + screenOrder.length) % screenOrder.length
    navigate(screenOrder[nextIndex]!)
  })

  return (
    <box width="100%" height="100%" backgroundColor={config.themeColor}>
      <Show when={mediaUri()} fallback={<CurrentScreen />}>
        {(uri) => (
          <PixelRenderer uri={uri()} width="100%" height="100%">
            <CurrentScreen />
          </PixelRenderer>
        )}
      </Show>
    </box>
  )
}
