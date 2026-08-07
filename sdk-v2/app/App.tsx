import { Dynamic, useKeyboard } from '@opentui/solid'
import { getTermweaveConfig } from '#termweave'
import { navigate, screen } from './store'
import { screens } from './screens'

export function App() {
  const config = getTermweaveConfig()

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
      <Dynamic component={screens[screen()]} />
    </box>
  )
}
