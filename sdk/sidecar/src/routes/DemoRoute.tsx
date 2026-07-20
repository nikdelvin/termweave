import { getTermweaveConfig, PixelRenderer } from '@termweave/sdk'

import { NavigationFooter } from '../components/NavigationFooter'
import { DEMO_ROUTE, type RouteProps } from '../routes'

export function DemoRoute(props: RouteProps) {
  const { terminalGrid } = getTermweaveConfig()

  return (
    <PixelRenderer uri={DEMO_ROUTE.imageUri} width={terminalGrid.cols} height={terminalGrid.rows}>
      <NavigationFooter activePath={DEMO_ROUTE.path} onNavigate={props.onNavigate} />
    </PixelRenderer>
  )
}
