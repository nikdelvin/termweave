import appConfig from '../app.config.json'

export const PRODUCT_NAME = appConfig.name
export const PRODUCT_DESCRIPTION = appConfig.description
export const SHOW_DIAGNOSTICS = appConfig.showDiagnostics
export const THEME_COLOR = appConfig.themeColor
export const FOREGROUND_COLOR = appConfig.foregroundColor

export const TERMINAL_GRID = {
  cols: appConfig.windowWidth / appConfig.fontSize,
  rows: appConfig.windowHeight / appConfig.fontSize,
  targetWidth: appConfig.windowWidth,
  targetHeight: appConfig.windowHeight,
  fontSize: appConfig.fontSize,
} as const

export const SIDECAR_PROTOCOL = {
  name: `${appConfig.bundleIdentifier}/opentui`,
  version: 3,
} as const

export type SidecarHello = {
  type: 'hello'
  protocol: typeof SIDECAR_PROTOCOL.name
  version: typeof SIDECAR_PROTOCOL.version
  instanceId: string
  port: number
}

export type SidecarAuthenticate = {
  type: 'authenticate'
  token: string
}

export type SidecarAuthenticated = {
  type: 'authenticated'
}

export type SidecarExitRequested = {
  type: 'exit-requested'
}
