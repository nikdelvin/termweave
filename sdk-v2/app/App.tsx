import { Dynamic, useKeyboard } from '@opentui/solid'
import { getAppConfig } from '../shared/config'
import { navigate, screen } from './app-store'
import { screens } from './screens'

export function App() {
  const config = getAppConfig()

  // This callback is the template user's keyboard configuration. navigate() itself is key-agnostic.
  useKeyboard((key) => {
    if (key.ctrl || key.hyper || key.meta || key.option || key.shift || key.super) return

    const current = screen()
    if (current === '/' && key.name === 'down') {
      key.preventDefault()
      navigate('/gallery')
    } else if (current === '/' && key.name === 'up') {
      key.preventDefault()
      navigate('/plain')
    } else if (current === '/gallery' && key.name === 'up') {
      key.preventDefault()
      navigate('/')
    } else if (current === '/gallery' && key.name === 'down') {
      key.preventDefault()
      navigate('/plain')
    } else if (current === '/plain' && key.name === 'up') {
      key.preventDefault()
      navigate('/gallery')
    } else if (current === '/plain' && key.name === 'down') {
      key.preventDefault()
      navigate('/')
    }
  })

  return (
    <box width="100%" height="100%" backgroundColor={config.backgroundColor}>
      <Dynamic component={screens[screen()]} />
    </box>
  )
}
