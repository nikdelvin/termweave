import demoImageUri from './assets/campfire-dark.gif' with { type: 'file' }
import homeImageUri from './assets/campfire.gif' with { type: 'file' }

const ROUTE_PATHS = {
  demo: '/demo',
  home: '/',
} as const

export type AppRoutePath = (typeof ROUTE_PATHS)[keyof typeof ROUTE_PATHS]

interface RouteDefinition {
  connections: readonly AppRoutePath[]
  imageUri: string
  label: string
  path: AppRoutePath
}

export const HOME_ROUTE = {
  connections: [ROUTE_PATHS.demo],
  imageUri: homeImageUri,
  label: 'HOME',
  path: ROUTE_PATHS.home,
} as const satisfies RouteDefinition

export const DEMO_ROUTE = {
  connections: [ROUTE_PATHS.home],
  imageUri: demoImageUri,
  label: 'DEMO',
  path: ROUTE_PATHS.demo,
} as const satisfies RouteDefinition

export const APP_ROUTES = [HOME_ROUTE, DEMO_ROUTE] as const

export type AppRoute = (typeof APP_ROUTES)[number]

export function getConnectedRoutes(path: AppRoutePath): AppRoute[] {
  const route = APP_ROUTES.find((candidate) => candidate.path === path)
  if (!route) return []

  return route.connections
    .map((connectedPath) => APP_ROUTES.find((candidate) => candidate.path === connectedPath))
    .filter((connectedRoute): connectedRoute is AppRoute => connectedRoute !== undefined)
}

export interface RouteProps {
  onNavigate: (path: AppRoutePath) => void
}
