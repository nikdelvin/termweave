import { createCliRenderer, type CliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import type { JSX } from 'solid-js'
import { createReadStream } from 'node:fs'
import { getAppConfig } from './config'
import { TERMINAL_GRID } from './constants'
import { disposeAllStreamingMediaPlayback } from './components/streaming-media'
import { createCrtAudio } from './crt-audio'

function writeDiagnostic(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
}

export async function startTermweaveSidecar(root: () => JSX.Element) {
  const rendererState: { current?: CliRenderer } = {}
  const crtAudio = createCrtAudio()
  // The macOS sidecar owns a duplicate of fd 0. Bun's process.stdin wrapper can reach EOF when
  // OpenTUI becomes quiescent after a static native-media frame, even while Tauri's pipe remains
  // open. Giving the renderer its own descriptor keeps raw input alive for the sidecar lifetime.
  const sidecarStdin = createReadStream('/dev/fd/0', {
    autoClose: true,
  }) as unknown as NodeJS.ReadStream
  let shuttingDown = false

  function shutdown(exitCode = 0) {
    if (shuttingDown) return
    shuttingDown = true

    crtAudio.stop()
    disposeAllStreamingMediaPlayback()

    try {
      rendererState.current?.destroy()
    } catch (error) {
      writeDiagnostic(error)
    }
    sidecarStdin.destroy()

    queueMicrotask(() => process.exit(exitCode))
  }

  try {
    const config = getAppConfig()
    // A distinct stdout object selects OpenTUI's callback-aware NativeSpanFeed while preserving the
    // exact sidecar byte stream and fixed terminal geometry.
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

    await render(root, renderer)
    void crtAudio.start()
  } catch (error) {
    writeDiagnostic(error)
    shutdown(1)
  }
}
