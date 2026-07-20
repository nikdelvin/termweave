import {
  Route,
  createMemoryHistory,
  createRouter,
  type LocationChange,
} from '@solidjs/router/universal'
import { getTermweaveConfig, preloadPixelImages } from '@termweave/sdk'
import { createSignal, onMount, Show } from 'solid-js'

import { DEMO_ROUTE, getConnectedRoutes, HOME_ROUTE, type AppRoutePath } from './routes'
import { DemoRoute } from './routes/DemoRoute'
import { HomeRoute } from './routes/HomeRoute'

const history = createMemoryHistory()
const [routerMount, setRouterMount] = createSignal<object>({})

function preloadConnectedRouteImages(path: AppRoutePath) {
  const { terminalGrid } = getTermweaveConfig()
  void preloadPixelImages(
    getConnectedRoutes(path).map((route) => ({
      uri: route.imageUri,
      width: terminalGrid.cols,
      height: terminalGrid.rows,
    })),
  ).catch(() => {})
}

function scheduleConnectedRoutePreload(path: AppRoutePath) {
  setImmediate(() => preloadConnectedRouteImages(path))
}

function navigate(path: AppRoutePath) {
  history.set({ value: path, replace: false, scroll: false })
  setRouterMount({})
  scheduleConnectedRoutePreload(path)
}

function RouterView() {
  const TerminalRouter = createRouter({
    get: history.get,
    set: (change: LocationChange) => {
      history.set({ ...change, scroll: false })
    },
    init: history.listen,
    utils: {
      go: history.go,
    },
  })

  return (
    <TerminalRouter>
      <Route path={HOME_ROUTE.path} component={() => <HomeRoute onNavigate={navigate} />} />
      <Route path={DEMO_ROUTE.path} component={() => <DemoRoute onNavigate={navigate} />} />
    </TerminalRouter>
  )
}

export function App() {
  onMount(() => scheduleConnectedRoutePreload(history.get() as AppRoutePath))

  return (
    <Show keyed when={routerMount()}>
      <RouterView />
    </Show>
  )
}
