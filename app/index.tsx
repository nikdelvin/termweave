/** @jsxImportSource @opentui/react */
import { createCliRenderer, type CliRenderer } from '@opentui/core'
import { createRoot } from '@opentui/react'
import { createReadStream } from 'node:fs'
import process from 'node:process'
import { App } from './App'
import { TERMINAL_GRID } from '../termweave/constants'
import { createCrtAudio } from '../termweave/crt-audio'
import { getAppConfig } from '../termweave/config'
import { errorMessage } from '../termweave/error-message'

function writeDiagnostic(error: unknown) {
  process.stderr.write(`${errorMessage(error)}\n`)
}

async function main() {
  const rendererState: { current?: CliRenderer } = {}
  const crtAudio = createCrtAudio()
  const sidecarStdin = createReadStream('/dev/fd/0', {
    autoClose: true,
  }) as unknown as NodeJS.ReadStream
  let shuttingDown = false
  let parentWatch: ReturnType<typeof setInterval> | undefined

  function shutdown(exitCode = 0) {
    if (shuttingDown) return
    shuttingDown = true

    if (parentWatch !== undefined) clearInterval(parentWatch)
    crtAudio.stop()

    try {
      rendererState.current?.destroy()
    } catch (error) {
      writeDiagnostic(error)
    }
    sidecarStdin.destroy()

    queueMicrotask(() => process.exit(exitCode))
  }

  sidecarStdin.on('end', () => shutdown())
  sidecarStdin.on('close', () => shutdown())
  parentWatch = setInterval(() => {
    if (process.ppid === 1) shutdown()
  }, 1_000)

  try {
    const config = getAppConfig()
    const nativeFeedStdout = {
      columns: TERMINAL_GRID.cols,
      rows: TERMINAL_GRID.rows,
      write: process.stdout.write.bind(process.stdout),
    } as NodeJS.WriteStream

    const renderer = await createCliRenderer({
      stdin: sidecarStdin,
      stdout: nativeFeedStdout,
      width: TERMINAL_GRID.cols,
      height: TERMINAL_GRID.rows,
      remote: true,
      backgroundColor: config.themeColor,
      screenMode: 'alternate-screen',
      consoleMode: 'disabled',
      openConsoleOnError: false,
      exitOnCtrlC: true,
      exitSignals: [],
      useKittyKeyboard: null,
      useMouse: false,
      enableMouseMovement: false,
      onDestroy: () => {
        if (rendererState.current) shutdown()
      },
    })
    rendererState.current = renderer

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => shutdown())
    }
    process.once('exit', crtAudio.stop)

    createRoot(renderer).render(<App />)
    void crtAudio.start()
  } catch (error) {
    writeDiagnostic(error)
    shutdown(1)
  }
}

void main()
