import { getTermweaveConfig, PixelRenderer } from '@termweave/sdk'

import { NavigationFooter } from '../components/NavigationFooter'
import { HOME_ROUTE, type RouteProps } from '../routes'

export function HomeRoute(props: RouteProps) {
  const { terminalGrid } = getTermweaveConfig()

  return (
    <PixelRenderer uri={HOME_ROUTE.imageUri} width={terminalGrid.cols} height={terminalGrid.rows}>
      <NavigationFooter activePath={HOME_ROUTE.path} onNavigate={props.onNavigate} />
    </PixelRenderer>
  )
}
