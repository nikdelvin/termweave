import type { AppConfig } from '../shared/config'
import { terminalSurface } from '../shared/config'

export const terminalFontFamily = '"Kreative Square", monospace'

const monitorArtwork = {
  width: 3_000,
  height: 1_740,
  aperture: {
    left: 268,
    top: 201,
    width: 2_453,
    height: 1_380,
  },
} as const

const crtEffectDefaults = {
  noiseVisibility: 0.3,
  scanlinesVisibility: 0.3,
} as const

const crtReferenceRaster = {
  activeLinePositions: 480,
  drawnLines: 240,
} as const

export type PresentationLayout = Readonly<{
  terminalLeft: number
  terminalTop: number
  terminalWidth: 2560
  terminalHeight: 1440
  monitorLeft: number
  monitorTop: number
  monitorWidth: number
  monitorHeight: number
  windowInset: number
}>

export type PresentationState = Readonly<{
  layout: PresentationLayout
  monitorHidden: boolean
  effectsHidden: boolean
}>

export function monitorBezelFilter(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255
  const green = Number.parseInt(color.slice(3, 5), 16) / 255
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255
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

export function crtEffectStyleVariables() {
  const noisePeakOpacity = crtEffectDefaults.noiseVisibility * 0.1
  const activeLineHeight = terminalSurface.height / crtReferenceRaster.activeLinePositions
  const scanlinePitch = terminalSurface.height / crtReferenceRaster.drawnLines

  return {
    '--crt-noise-opacity': noisePeakOpacity * (50 / 62),
    '--crt-scanline-beam-height': `${activeLineHeight}px`,
    '--crt-scanline-pitch': `${scanlinePitch}px`,
    '--crt-scanlines-opacity': crtEffectDefaults.scanlinesVisibility,
  } as const
}

export function presentationLayout(monitorOverlay: boolean): PresentationLayout {
  const artworkScale = terminalSurface.width / monitorArtwork.aperture.width
  const monitorWidth = monitorArtwork.width * artworkScale
  const monitorHeight = monitorArtwork.height * artworkScale
  const screenLeft = monitorArtwork.aperture.left * artworkScale
  const screenTop = monitorArtwork.aperture.top * artworkScale
  const screenCenterX = screenLeft + terminalSurface.width / 2
  const screenCenterY = screenTop + (monitorArtwork.aperture.height * artworkScale) / 2

  return {
    terminalLeft: -terminalSurface.width / 2,
    terminalTop: -terminalSurface.height / 2,
    terminalWidth: terminalSurface.width,
    terminalHeight: terminalSurface.height,
    monitorLeft: -screenCenterX,
    monitorTop: -screenCenterY,
    monitorWidth,
    monitorHeight,
    windowInset: monitorOverlay ? 64 : 0,
  }
}

export function presentationState(
  config: Pick<AppConfig, 'monitorOverlay' | 'crtEffects'>,
): PresentationState {
  return {
    layout: presentationLayout(config.monitorOverlay),
    monitorHidden: !config.monitorOverlay,
    effectsHidden: !config.crtEffects,
  }
}

export function scaleStageToFit(
  containerWidth: number,
  containerHeight: number,
  layout: PresentationLayout,
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

export function createPresentation(root: HTMLElement, config: AppConfig) {
  const stage = requiredElement<HTMLElement>(root, '#display-stage')
  const terminalHost = requiredElement<HTMLElement>(root, '#terminal')
  const effectsHost = requiredElement<HTMLElement>(root, '#crt-effects')
  const monitorHost = requiredElement<HTMLElement>(root, '#monitor-overlay')
  const state = presentationState(config)
  const { layout } = state

  root.style.setProperty('--termweave-background', config.backgroundColor)
  root.style.setProperty('--termweave-foreground', config.foregroundColor)
  root.dataset.monitorOverlay = config.monitorOverlay ? 'on' : 'off'
  root.dataset.crtEffects = config.crtEffects ? 'on' : 'off'

  const bezel = monitorBezelFilter(config.backgroundColor)
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

  if (config.crtEffects) {
    for (const [property, value] of Object.entries(crtEffectStyleVariables())) {
      effectsHost.style.setProperty(property, String(value))
    }
  }

  for (const host of [terminalHost, effectsHost]) {
    host.style.left = `${layout.terminalLeft}px`
    host.style.top = `${layout.terminalTop}px`
    host.style.width = `${layout.terminalWidth}px`
    host.style.height = `${layout.terminalHeight}px`
  }

  monitorHost.style.left = `${layout.monitorLeft}px`
  monitorHost.style.top = `${layout.monitorTop}px`
  monitorHost.style.width = `${layout.monitorWidth}px`
  monitorHost.style.height = `${layout.monitorHeight}px`

  monitorHost.hidden = state.monitorHidden
  effectsHost.hidden = state.effectsHidden

  const fit = () => {
    stage.style.setProperty(
      '--termweave-stage-scale',
      String(scaleStageToFit(root.clientWidth, root.clientHeight, layout)),
    )
  }

  fit()
  const resizeObserver = new ResizeObserver(fit)
  resizeObserver.observe(root)

  return {
    terminalHost,
    fit,
    dispose() {
      resizeObserver.disconnect()
    },
  }
}
