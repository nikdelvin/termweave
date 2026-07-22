import { useKeyboard } from '@opentui/solid'
import { getTermweaveConfig } from '@termweave/sdk'
import { createSignal } from 'solid-js'

import { APP_ROUTES, type AppRoutePath } from '../routes'

export interface NavigationFooterProps {
  activePath: AppRoutePath
  onNavigate: (path: AppRoutePath) => void
}

const [count, setCount] = createSignal(0)

export function NavigationFooter(props: NavigationFooterProps) {
  const { foregroundColor, themeColor } = getTermweaveConfig()

  const activeRouteIndex = () => {
    const index = APP_ROUTES.findIndex((route) => route.path === props.activePath)
    return index < 0 ? 0 : index
  }

  const routeList = () =>
    APP_ROUTES.map((route, index) =>
      index === activeRouteIndex() ? `[${route.label}]` : route.label,
    ).join('  ')

  const changeRoute = (offset: number) => {
    const index = (activeRouteIndex() + offset + APP_ROUTES.length) % APP_ROUTES.length
    const route = APP_ROUTES[index]
    if (route) props.onNavigate(route.path)
  }

  useKeyboard((key) => {
    if (key.name === 'left') {
      key.preventDefault()
      setCount((value) => value - 1)
      return
    }

    if (key.name === 'right') {
      key.preventDefault()
      setCount((value) => value + 1)
      return
    }

    if (key.name === 'up') {
      key.preventDefault()
      changeRoute(-1)
      return
    }

    if (key.name === 'down') {
      key.preventDefault()
      changeRoute(1)
    }
  })

  return (
    <box
      position="absolute"
      left={0}
      bottom={1}
      gap={1}
      width="100%"
      alignItems="center"
      justifyContent="center"
      flexDirection="row"
    >
      <box
        border
        title=" TERMWEAVE "
        width="auto"
        height={7}
        padding={1}
        gap={1}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        backgroundColor={themeColor}
        zIndex={1}
      >
        <text fg={foregroundColor}>A config-driven Tauri and OpenTUI builder</text>
        <text fg={foregroundColor}>for native desktop terminal apps.</text>
      </box>
      <box
        border
        title=" SOLID ROUTER + SIGNAL "
        width="auto"
        height={7}
        padding={1}
        gap={1}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        backgroundColor={themeColor}
        zIndex={1}
      >
        <text fg={foregroundColor}>Up/Down changes route | [↑/↓] {routeList()}</text>
        <text fg={foregroundColor}>Left/Right changes value | [&lt;] {count()} [&gt;]</text>
      </box>
    </box>
  )
}
