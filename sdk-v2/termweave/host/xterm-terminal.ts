import { Terminal, type ITerminalInitOnlyOptions, type ITerminalOptions } from '@xterm/xterm'
import type { AppConfig } from '../config'
import {
  TERMINAL_CURSOR_COLOR,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_FOREGROUND_COLOR,
  TERMINAL_GRID,
} from '../constants'

export function createXtermOptions(
  config: Pick<AppConfig, 'themeColor'>,
): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    cols: TERMINAL_GRID.cols,
    rows: TERMINAL_GRID.rows,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: TERMINAL_FONT_SIZE,
    letterSpacing: 0,
    lineHeight: 1,
    scrollback: 0,
    cursorBlink: false,
    convertEol: false,
    customGlyphs: true,
    theme: {
      background: config.themeColor,
      foreground: TERMINAL_FOREGROUND_COLOR,
      cursor: TERMINAL_CURSOR_COLOR,
    },
  }
}

export function createXtermTerminal(config: Pick<AppConfig, 'themeColor'>) {
  const terminal = new Terminal(createXtermOptions(config))
  terminal.attachCustomWheelEventHandler((event) => {
    event.preventDefault()
    event.stopPropagation()
    return false
  })
  return terminal
}
