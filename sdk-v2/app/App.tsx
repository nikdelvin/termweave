import { Dynamic, useKeyboard } from '@opentui/solid'
import { getTermweaveConfig, PixelRenderer } from '#termweave'
import { Show } from 'solid-js'
import { navigate, screen } from './store'
import { screenMedia, screens } from './screens'

export function App() {
  const config = getTermweaveConfig()
  const mediaUri = () => screenMedia[screen()]
  const CurrentScreen = () => <Dynamic component={screens[screen()]} />

  // This callback is the template user's keyboard configuration. navigate() itself is key-agnostic.
  useKeyboard((key) => {
    if (key.ctrl || key.hyper || key.meta || key.option || key.shift || key.super) return

    const current = screen()
    if (current === 'animation' && key.name === 'down') {
      key.preventDefault()
      navigate('picture')
    } else if (current === 'animation' && key.name === 'up') {
      key.preventDefault()
      navigate('plain')
    } else if (current === 'picture' && key.name === 'up') {
      key.preventDefault()
      navigate('animation')
    } else if (current === 'picture' && key.name === 'down') {
      key.preventDefault()
      navigate('plain')
    } else if (current === 'plain' && key.name === 'up') {
      key.preventDefault()
      navigate('picture')
    } else if (current === 'plain' && key.name === 'down') {
      key.preventDefault()
      navigate('animation')
    }
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
