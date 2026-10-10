import type { AppConfig } from '../config'
import { normalizeRgb, parseHexRgb } from '../color'
import { TERMINAL_FONT_FAMILY, TERMINAL_FOREGROUND_COLOR, TERMINAL_SURFACE } from '../constants'

const MONITOR_ARTWORK_GEOMETRY = {
  width: 3_000,
  height: 1_740,
  aperturePadding: {
    left: 268,
    right: 278,
    top: 201,
    bottom: 159,
  },
  terminalFrame: {
    width: 2_464,
    height: 1_386,
  },
} as const

export type MonitorLayout = Readonly<{
  terminalLeft: number
  terminalTop: number
  terminalWidth: typeof TERMINAL_SURFACE.width
  terminalHeight: typeof TERMINAL_SURFACE.height
  monitorLeft: number
  monitorTop: number
  monitorWidth: number
  monitorHeight: number
  windowInset: number
}>

export function monitorBezelFilter(color: string) {
  const [red, green, blue] = normalizeRgb(parseHexRgb(color))
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum
  const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
  const saturation = maximum === 0 ? 0 : delta / maximum
  let hueRotation = 0

  if (delta > 0) {
    let hue: number
    if (maximum === red) hue = ((green - blue) / delta) % 6
    else if (maximum === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4

    const targetHue = (((hue * 60) % 360) + 360) % 360
    hueRotation = (targetHue - 37.5 + 360) % 360
  }

  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    brightness: round(0.27 + luma * 1.6),
    contrast: round(1 + (1 - luma) * 0.1),
    hueRotation: round(hueRotation),
    saturation: round(1 + saturation * 0.1),
    sepia: round(saturation),
  }
}

export function calculateMonitorLayout(): MonitorLayout {
  const { aperturePadding, terminalFrame } = MONITOR_ARTWORK_GEOMETRY
  const apertureCenterX =
    aperturePadding.left +
    (MONITOR_ARTWORK_GEOMETRY.width - aperturePadding.left - aperturePadding.right) / 2
  const apertureCenterY =
    aperturePadding.top +
    (MONITOR_ARTWORK_GEOMETRY.height - aperturePadding.top - aperturePadding.bottom) / 2
  const artworkScale = TERMINAL_SURFACE.width / terminalFrame.width
  const monitorWidth = MONITOR_ARTWORK_GEOMETRY.width * artworkScale
  const monitorHeight = MONITOR_ARTWORK_GEOMETRY.height * artworkScale
  const screenCenterX = apertureCenterX * artworkScale
  const screenCenterY = apertureCenterY * artworkScale

  return {
    terminalLeft: -TERMINAL_SURFACE.width / 2,
    terminalTop: -TERMINAL_SURFACE.height / 2,
    terminalWidth: TERMINAL_SURFACE.width,
    terminalHeight: TERMINAL_SURFACE.height,
    monitorLeft: -screenCenterX,
    monitorTop: -screenCenterY,
    monitorWidth,
    monitorHeight,
    windowInset: 64,
  }
}

export function calculateStageScale(
  containerWidth: number,
  containerHeight: number,
  layout: MonitorLayout,
) {
  const availableWidth = Math.max(0, containerWidth - layout.windowInset * 2)
  const availableHeight = Math.max(0, containerHeight - layout.windowInset * 2)
  return Math.min(availableWidth / layout.terminalWidth, availableHeight / layout.terminalHeight)
}

function requiredElement<T extends Element>(root: ParentNode, selector: string) {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector} element`)
  return element
}

export function createMonitorPresentation(root: HTMLElement, config: AppConfig) {
  const stage = requiredElement<HTMLElement>(root, '#display-stage')
  const terminalHost = requiredElement<HTMLElement>(root, '#terminal')
  const effectsHost = requiredElement<HTMLElement>(root, '#crt-effects')
  const monitorHost = requiredElement<HTMLElement>(root, '#monitor-overlay')
  const rendererStatusHost = requiredElement<HTMLElement>(root, '#renderer-status')
  const rendererStatusMessage = requiredElement<HTMLElement>(root, '#renderer-status-message')
  const layout = calculateMonitorLayout()

  const styleRoots = new Set([root, root.ownerDocument?.documentElement].filter(Boolean))
  for (const styleRoot of styleRoots) {
    styleRoot!.style.setProperty('--termweave-theme-color', config.themeColor)
    styleRoot!.style.setProperty('--termweave-terminal-foreground', TERMINAL_FOREGROUND_COLOR)
    styleRoot!.style.setProperty('--termweave-terminal-font', TERMINAL_FONT_FAMILY)
  }

  const bezel = monitorBezelFilter(config.themeColor)
  const monitorStyles = {
    '--monitor-bezel-brightness': bezel.brightness,
    '--monitor-bezel-contrast': bezel.contrast,
    '--monitor-bezel-sepia': bezel.sepia,
    '--monitor-bezel-saturation': bezel.saturation,
    '--monitor-bezel-hue': `${bezel.hueRotation}deg`,
  }
  for (const [property, value] of Object.entries(monitorStyles)) {
    monitorHost.style.setProperty(property, String(value))
  }

  for (const host of [terminalHost, effectsHost, rendererStatusHost]) {
    host.style.left = `${layout.terminalLeft}px`
    host.style.top = `${layout.terminalTop}px`
    host.style.width = `${layout.terminalWidth}px`
    host.style.height = `${layout.terminalHeight}px`
  }

  monitorHost.style.left = `${layout.monitorLeft}px`
  monitorHost.style.top = `${layout.monitorTop}px`
  monitorHost.style.width = `${layout.monitorWidth}px`
  monitorHost.style.height = `${layout.monitorHeight}px`

  const fit = () => {
    stage.style.setProperty(
      '--termweave-stage-scale',
      String(calculateStageScale(root.clientWidth, root.clientHeight, layout)),
    )
  }

  fit()
  const resizeObserver = new ResizeObserver(fit)
  resizeObserver.observe(root)

  return {
    terminalHost,
    rendererStatusHost,
    rendererStatusMessage,
    dispose() {
      resizeObserver.disconnect()
    },
  }
}
