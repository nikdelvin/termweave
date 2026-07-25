import { MONITOR_OVERLAY_ENABLED, TERMINAL_GRID } from '../../shared/terminal-config'

export const FONT_FAMILY = '"Kreative Square"'
export const MIN_HORIZONTAL_BEZEL_PX = MONITOR_OVERLAY_ENABLED ? 64 : 0
export const MIN_VERTICAL_BEZEL_PX = MONITOR_OVERLAY_ENABLED ? 64 : 0
export const MONITOR_OVERLAY = {
  width: 3_000,
  height: 1_740,
  aperture: {
    left: 268,
    top: 201,
    width: 2_453,
    height: 1_380,
  },
} as const

const monitorScaleX = TERMINAL_GRID.targetWidth / MONITOR_OVERLAY.aperture.width
const monitorScaleY = TERMINAL_GRID.targetHeight / MONITOR_OVERLAY.aperture.height

export const MONITOR_LAYOUT = {
  width: MONITOR_OVERLAY.width * monitorScaleX,
  height: MONITOR_OVERLAY.height * monitorScaleY,
  screenLeft: MONITOR_OVERLAY.aperture.left * monitorScaleX,
  screenTop: MONITOR_OVERLAY.aperture.top * monitorScaleY,
  screenWidth: TERMINAL_GRID.targetWidth,
  screenHeight: TERMINAL_GRID.targetHeight,
  screenCenterX: MONITOR_OVERLAY.aperture.left * monitorScaleX + TERMINAL_GRID.targetWidth / 2,
  screenCenterY: MONITOR_OVERLAY.aperture.top * monitorScaleY + TERMINAL_GRID.targetHeight / 2,
} as const

export function terminalScale(containerWidth: number, containerHeight: number) {
  const availableWidth = Math.max(0, containerWidth - MIN_HORIZONTAL_BEZEL_PX * 2)
  const availableHeight = Math.max(0, containerHeight - MIN_VERTICAL_BEZEL_PX * 2)
  return Math.max(
    0,
    Math.min(
      availableWidth / TERMINAL_GRID.targetWidth,
      availableHeight / TERMINAL_GRID.targetHeight,
    ),
  )
}

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
