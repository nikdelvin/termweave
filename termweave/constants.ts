export const TERMINAL_SURFACE = Object.freeze({ width: 2560, height: 1440 } as const)
export const TERMINAL_FONT_SIZE = 20
export const TERMINAL_GRID = Object.freeze({
  cols: 128,
  rows: 72,
  fontSize: TERMINAL_FONT_SIZE,
  width: TERMINAL_SURFACE.width,
  height: TERMINAL_SURFACE.height,
} as const)
export const TERMINAL_FOREGROUND_COLOR = '#F59B5A'
export const TERMINAL_CURSOR_COLOR = TERMINAL_FOREGROUND_COLOR
export const TERMINAL_FONT_FAMILY = '"Kreative Square", monospace'
export const OPENTUI_ASSET_ROOT_DIRECTORY = 'opentui-assets'
export const BUNDLED_MEDIA_ROOT_DIRECTORY = 'termweave-media'
export const FFMPEG_RESOURCE_DIRECTORY = 'third-party/ffmpeg'
export const PIXEL_RENDERER_ERROR_BACKGROUND_COLOR = '#351B19'
export const PIXEL_RENDERER_ERROR_FOREGROUND_COLOR = '#E9E3D2'
