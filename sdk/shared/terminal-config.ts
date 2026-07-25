import appConfig from '../app.config.json'

export const PRODUCT_NAME = appConfig.name
export const PRODUCT_DESCRIPTION = appConfig.description
export const SHOW_DIAGNOSTICS = appConfig.showDiagnostics
export const BACKGROUND_COLOR = appConfig.backgroundColor
export const FOREGROUND_COLOR = appConfig.foregroundColor
export const MONITOR_OVERLAY_ENABLED = appConfig.monitorOverlay
export const CRT_EFFECTS_ENABLED = appConfig.crtEffects
export const CRT_EFFECT_DEFAULTS = {
  soundVolume: 0.3,
  chromaticAberrationShift: 3,
  processedFrameOpacity: 0.3,
  noiseVisibility: 0.3,
  scanlinesVisibility: 0.3,
  flickerVisibility: 0.3,
  sweepLineVisibility: 0.3,
} as const

export const TERMINAL_SURFACE = {
  width: 2560,
  height: 1440,
} as const

export const TERMINAL_GRID = {
  cols: TERMINAL_SURFACE.width / appConfig.fontSize,
  rows: TERMINAL_SURFACE.height / appConfig.fontSize,
  targetWidth: TERMINAL_SURFACE.width,
  targetHeight: TERMINAL_SURFACE.height,
  fontSize: appConfig.fontSize,
} as const

export const SIDECAR_PROTOCOL = {
  name: `${appConfig.bundleIdentifier}/opentui`,
  version: 5,
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

export type SidecarShutdown = {
  type: 'shutdown'
}
