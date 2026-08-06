import { createCliRenderer, type CliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import { createReadStream } from 'node:fs'
import { getAppConfig } from '../shared/config'
import { App } from './App'

function writeDiagnostic(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
}

const rendererState: { current?: CliRenderer } = {}
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

  try {
    rendererState.current?.destroy()
  } catch (error) {
    writeDiagnostic(error)
  }
  sidecarStdin.destroy()

  queueMicrotask(() => process.exit(exitCode))
}

async function start() {
  const config = getAppConfig()
  // A distinct stdout object selects OpenTUI's callback-aware NativeSpanFeed while preserving the
  // exact sidecar byte stream and fixed terminal geometry.
  const nativeFeedStdout = {
    columns: config.terminalGrid.cols,
    rows: config.terminalGrid.rows,
    write: process.stdout.write.bind(process.stdout),
  } as NodeJS.WriteStream

  const renderer = await createCliRenderer({
    stdin: sidecarStdin,
    stdout: nativeFeedStdout,
    width: config.terminalGrid.cols,
    height: config.terminalGrid.rows,
    remote: true,
    backgroundColor: config.backgroundColor,
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

  await render(() => <App />, renderer)
}

try {
  await start()
} catch (error) {
  writeDiagnostic(error)
  shutdown(1)
}
