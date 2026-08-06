import { describe, expect, test } from 'bun:test'
import { Terminal } from '@xterm/xterm'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { getAppConfig } from '../shared/config'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

describe('real sidecar stdin parsing', () => {
  test('keeps counters and typing responsive across every media and plain-screen transition', async () => {
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
    const config = getAppConfig()
    const terminal = new Terminal({
      cols: config.terminalGrid.cols,
      rows: config.terminalGrid.rows,
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
        await waitForScreen(`TYPED: ${typed}`)
      }
    }

    try {
      await waitForScreen('HOME SCREEN')
      await typeText('home-start')
      await waitForScreen('home-start')

      await write('\u001b[C')
      await waitForScreen('VALUE: 1')

      await write('\u001bOB')
      await waitForScreen('GALLERY SCREEN')
      expect(screenText()).not.toContain('HOME SCREEN')

      await typeText('native')
      await write('\u001bOC')
      await waitForScreen('VALUE: 1')
      await typeText('-pipe', 'native')
      await waitForScreen('native-pipe')

      // PNG -> plain through CSI Down.
      await write('\u001b[B')
      await waitForScreen('PLAIN SCREEN')
      expect(screenText()).not.toContain('GALLERY SCREEN')
      expect(screenText()).not.toContain('HOME SCREEN')

      await typeText('plain-down')
      await write('\u001b[D')
      await waitForScreen('VALUE: -1')

      // Plain -> PNG through SS3 Up.
      await write('\u001bOA')
      await waitForScreen('GALLERY SCREEN')
      expect(screenText()).not.toContain('PLAIN SCREEN')
      await typeText('gallery-again')
      await write('\u001b[C')
      await waitForScreen('VALUE: 1')

      // PNG -> GIF through CSI Up.
      await write('\u001b[A')
      await waitForScreen('HOME SCREEN')
      expect(screenText()).not.toContain('GALLERY SCREEN')

      await write('\u001b[C')
      await waitForScreen('VALUE: 1')
      await typeText('home-again')
      await waitForScreen('home-again')

      // GIF -> plain through SS3 Up, then plain -> GIF through SS3 Down.
      await write('\u001bOA')
      await waitForScreen('PLAIN SCREEN')
      expect(screenText()).not.toContain('HOME SCREEN')
      await typeText('plain-up')
      await write('\u001bOC')
      await waitForScreen('VALUE: 1')

      await write('\u001bOB')
      await waitForScreen('HOME SCREEN')
      expect(screenText()).not.toContain('PLAIN SCREEN')
      await typeText('home-final')

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
