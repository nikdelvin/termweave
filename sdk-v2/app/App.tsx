import { useKeyboard } from '@opentui/solid'
import { createSignal, Match, Switch } from 'solid-js'
import { getAppConfig } from '../shared/config'
import { GalleryScreen } from './screens/GalleryScreen'
import { HomeScreen } from './screens/HomeScreen'
import { PlainScreen } from './screens/PlainScreen'
import {
  GALLERY_SCREEN,
  HOME_SCREEN,
  PLAIN_SCREEN,
  screenForVerticalKey,
  type ScreenId,
} from './screen-state'

export interface AppProps {
  initialScreen?: ScreenId
}

export function App(props: AppProps) {
  const config = getAppConfig()
  const [screen, setScreen] = createSignal<ScreenId>(props.initialScreen ?? HOME_SCREEN)
  const navigate = (next: ScreenId) => setScreen(next)

  useKeyboard((key) => {
    const destination = screenForVerticalKey(screen(), key)
    if (destination === undefined) return
    key.preventDefault()
    navigate(destination)
  })

  return (
    <box width="100%" height="100%" backgroundColor={config.backgroundColor}>
      <Switch>
        <Match when={screen() === HOME_SCREEN}>
          <HomeScreen />
        </Match>
        <Match when={screen() === GALLERY_SCREEN}>
          <GalleryScreen />
        </Match>
        <Match when={screen() === PLAIN_SCREEN}>
          <PlainScreen />
        </Match>
      </Switch>
    </box>
  )
}
