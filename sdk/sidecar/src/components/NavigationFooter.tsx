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
  const { backgroundColor, foregroundColor } = getTermweaveConfig()

  const activeRouteIndex = () => {
    const index = APP_ROUTES.findIndex((route) => route.path === props.activePath)
    return index < 0 ? 0 : index
  }

  const activeRouteLabel = () => APP_ROUTES[activeRouteIndex()]?.label ?? APP_ROUTES[0].label

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
      changeRoute(1)
      return
    }

    if (key.name === 'down') {
      key.preventDefault()
      changeRoute(-1)
    }
  })

  return (
    <box
      position="absolute"
      left={0}
      bottom={4}
      gap={4}
      width="100%"
      alignItems="center"
      justifyContent="center"
      flexDirection="row"
    >
      <box
        border
        borderColor={foregroundColor}
        width={142}
        height={34}
        padding={2}
        gap={2}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        backgroundColor={backgroundColor}
        zIndex={1}
      >
        <ascii_font
          text="TERMWEAVE"
          font="shade"
          color={foregroundColor}
          backgroundColor={backgroundColor}
          selectable={false}
        />
        <ascii_font
          text="BUILD TERMINAL APPS."
          font="shade"
          color={foregroundColor}
          backgroundColor={backgroundColor}
          selectable={false}
        />
        <ascii_font
          text="SHIP THEM NATIVE."
          font="shade"
          color={foregroundColor}
          backgroundColor={backgroundColor}
          selectable={false}
        />
      </box>
      <box
        border
        borderColor={foregroundColor}
        width={142}
        height={34}
        padding={2}
        gap={2}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        backgroundColor={backgroundColor}
        zIndex={1}
      >
        <ascii_font
          text={`USE THE ARROW KEYS TO CHANGE:`}
          font="shade"
          color={foregroundColor}
          backgroundColor={backgroundColor}
          selectable={false}
        />
        <ascii_font
          text={`UP/DOWN: ROUTE (${activeRouteLabel()})`}
          font="shade"
          color={foregroundColor}
          backgroundColor={backgroundColor}
          selectable={false}
        />
        <ascii_font
          text={`LEFT/RIGHT: VALUE (${count()})`}
          font="shade"
          color={foregroundColor}
          backgroundColor={backgroundColor}
          selectable={false}
        />
      </box>
    </box>
  )
}
