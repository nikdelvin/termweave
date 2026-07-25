import { createCliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import { BACKGROUND_COLOR, FOREGROUND_COLOR, TERMINAL_GRID } from '../../shared/terminal-config'
import { App } from './App'
import { readSidecarRuntimeConfig } from './runtime/config'
import { createCrtAudio } from './runtime/crt-audio'
import { createTerminalOutput } from './runtime/terminal-output'
import { createTerminalServer } from './runtime/terminal-server'

const runtime = readSidecarRuntimeConfig()
const terminal = createTerminalOutput({
  cols: TERMINAL_GRID.cols,
  rows: TERMINAL_GRID.rows,
})
const crtAudio = createCrtAudio()

process.on('exit', crtAudio.stop)
void crtAudio.start()

let requestHostExit = () => {}
const renderer = await createCliRenderer({
  stdin: terminal.input as unknown as NodeJS.ReadStream,
  stdout: terminal.output as unknown as NodeJS.WriteStream,
  width: TERMINAL_GRID.cols,
  height: TERMINAL_GRID.rows,
  backgroundColor: BACKGROUND_COLOR,
  screenMode: 'alternate-screen',
  consoleMode: 'disabled',
  exitOnCtrlC: false,
  exitSignals: [],
  useKittyKeyboard: null,
  useMouse: false,
  enableMouseMovement: false,
  onDestroy: () => {
    crtAudio.stop()
    requestHostExit()
  },
})

terminal.enableFrameBoundaries()
renderer.setFrameCallback(terminal.waitForReady)
renderer.on('frame', terminal.flushFrame)

process.env.TERMWEAVE_BACKGROUND_COLOR = BACKGROUND_COLOR
process.env.TERMWEAVE_FOREGROUND_COLOR = FOREGROUND_COLOR
process.env.TERMWEAVE_TERMINAL_COLS = String(TERMINAL_GRID.cols)
process.env.TERMWEAVE_TERMINAL_ROWS = String(TERMINAL_GRID.rows)
render(() => <App />, renderer)

let shuttingDown = false
let terminalServer: ReturnType<typeof createTerminalServer> | undefined

function shutdownSidecar(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  crtAudio.stop()
  terminalServer?.stop()
  try {
    renderer.destroy()
  } catch {
    // Continue process shutdown if the renderer is already unavailable.
  }

  queueMicrotask(() => process.exit(exitCode))
}

terminalServer = createTerminalServer({
  clientToken: runtime.clientToken,
  instanceId: runtime.instanceId,
  onShutdownRequested: shutdownSidecar,
  port: runtime.port,
  renderer,
  terminal,
})
requestHostExit = terminalServer.requestHostExit

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => shutdownSidecar())
}

const ownerProcessId = process.ppid
const ownerProcessWatchdog = setInterval(() => {
  if (process.ppid === ownerProcessId) return
  shutdownSidecar()
}, 500)
ownerProcessWatchdog.unref()
