import { describe, expect, test } from 'bun:test'
import { Terminal } from '@xterm/xterm'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { ScreenKey } from '../app/screens'
import { TERMINAL_GRID } from '../termweave/constants'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

describe('real sidecar stdin parsing', () => {
  test('keeps typing responsive across every media-screen transition', async () => {
    const child = spawn(
      process.execPath,
      ['--preload', '@opentui/solid/preload', 'app/index.tsx'],
      {
        cwd: projectRoot,
        env: { ...process.env, DEBUG: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const stderrDecoder = new TextDecoder()
    let stderr = ''
    let exitCode: number | undefined
    const exited = new Promise<void>((resolve) => {
      child.once('exit', (code) => {
        exitCode = code ?? 1
        resolve()
      })
    })
    const terminal = new Terminal({
      cols: TERMINAL_GRID.cols,
      rows: TERMINAL_GRID.rows,
      scrollback: 0,
    })
    let inputWrite = Promise.resolve()
    const write = (data: string) => {
      inputWrite = inputWrite.then(async () => {
        await new Promise<void>((resolve, reject) => {
          child.stdin.write(data, (error) => {
            if (error) reject(error)
            else resolve()
          })
        })
      })
      return inputWrite
    }
    const inputSubscription = terminal.onData((data) => {
      void write(data)
    })

    const collectText = async (
      stream: NodeJS.ReadableStream,
      decoder: TextDecoder,
      append: (text: string) => void,
    ) => {
      for await (const value of stream) {
        append(decoder.decode(value as Uint8Array, { stream: true }))
      }
      append(decoder.decode())
    }
    const stdoutTask = (async () => {
      for await (const value of child.stdout) {
        await new Promise<void>((resolve) => terminal.write(value as Uint8Array, resolve))
      }
    })()
    const stderrTask = collectText(child.stderr, stderrDecoder, (text) => {
      stderr += text
    })

    const screenText = () => {
      const lines: string[] = []
      for (let row = 0; row < terminal.rows; row += 1) {
        lines.push(terminal.buffer.active.getLine(row)?.translateToString(true) ?? '')
      }
      return lines.join('\n')
    }
    const waitForScreen = async (marker: string) => {
      const deadline = performance.now() + 10_000
      while (performance.now() < deadline) {
        if (screenText().includes(marker)) return
        if (exitCode !== undefined) {
          throw new Error(`Sidecar exited with ${exitCode} while waiting for ${marker}: ${stderr}`)
        }
        await Bun.sleep(20)
      }
      throw new Error(
        `Timed out waiting for ${JSON.stringify(marker)} (exit ${String(exitCode)}): ${stderr}\n${screenText()}`,
      )
    }
    const typeText = async (value: string, initialValue = '') => {
      let typed = initialValue
      for (const character of value) {
        typed += character
        await write(character)
        await waitForScreen(`┃ ${typed}`)
      }
    }
    const screenMarker = (screen: ScreenKey) => `SCREEN ID: ${screen}`

    try {
      await waitForScreen(screenMarker('animation'))
      await typeText('a')

      await write('\u001bOC')
      await waitForScreen(screenMarker('picture'))
      expect(screenText()).not.toContain(screenMarker('animation'))

      await typeText('b', 'a')
      await typeText('c', 'ab')

      // PNG -> remote video through CSI Right.
      await write('\u001b[C')
      await waitForScreen(screenMarker('video'))
      expect(screenText()).not.toContain(screenMarker('picture'))
      expect(screenText()).not.toContain(screenMarker('animation'))

      await typeText('d', 'abc')

      // Remote video -> PNG through SS3 Left.
      await write('\u001bOD')
      await waitForScreen(screenMarker('picture'))
      expect(screenText()).not.toContain(screenMarker('video'))
      await typeText('e', 'abcd')

      // PNG -> GIF through CSI Left.
      await write('\u001b[D')
      await waitForScreen(screenMarker('animation'))
      expect(screenText()).not.toContain(screenMarker('picture'))

      await typeText('f', 'abcde')

      // GIF -> remote video through SS3 Left, then remote video -> GIF through SS3 Right.
      await write('\u001bOD')
      await waitForScreen(screenMarker('video'))
      expect(screenText()).not.toContain(screenMarker('animation'))
      await typeText('g', 'abcdef')

      await write('\u001bOC')
      await waitForScreen(screenMarker('animation'))
      expect(screenText()).not.toContain(screenMarker('video'))
      await typeText('h', 'abcdefg')

      expect(stderr).toBe('')
    } finally {
      child.kill('SIGTERM')
      const didExit = await Promise.race([
        exited.then(() => true),
        Bun.sleep(1_000).then(() => false),
      ])
      if (!didExit) child.kill('SIGKILL')
      await exited
      await Promise.all([stdoutTask, stderrTask])
      inputSubscription.dispose()
      terminal.dispose()
    }
  }, 30_000)
})
