import { describe, expect, test } from 'bun:test'
import { Terminal } from '@xterm/xterm'
import { parseAppConfig } from '../termweave/config'
import { createXtermOptions } from '../termweave/host/xterm-terminal'
import { validAppConfig } from './fixtures'

describe('fixed xterm configuration', () => {
  test('uses the fixed grid, foreground, cursor, and non-scrolling terminal options', () => {
    const options = createXtermOptions(parseAppConfig(validAppConfig()))
    expect(options).toMatchObject({
      cols: 128,
      rows: 72,
      fontFamily: '"Kreative Square", monospace',
      fontSize: 20,
      letterSpacing: 0,
      lineHeight: 1,
      scrollback: 0,
      cursorBlink: false,
      convertEol: false,
      customGlyphs: true,
      theme: {
        background: '#010416',
        foreground: '#F59B5A',
        cursor: '#F59B5A',
      },
    })
  })

  test('xterm accepts UTF-8 and escape sequences split across byte chunks', async () => {
    const terminal = new Terminal({ cols: 20, rows: 2 })
    const encoded = new TextEncoder().encode('café\u001b[31m red\u001b[0m')

    terminal.write(encoded.slice(0, 4))
    terminal.write(encoded.slice(4, 9))
    await new Promise<void>((resolve) => terminal.write(encoded.slice(9), resolve))

    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('café red')
    terminal.dispose()
  })
})
