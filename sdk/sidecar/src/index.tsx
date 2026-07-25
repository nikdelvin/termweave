import { createCliRenderer } from '@opentui/core'
import { render } from '@opentui/solid'
import { BACKGROUND_COLOR, FOREGROUND_COLOR, TERMINAL_GRID } from '../../shared/terminal-config'
import { App } from './App'
import { readSidecarRuntimeConfig } from './runtime/config'
import { createCrtAudio } from './runtime/crt-audio'
import { createSidecarDiagnostics, serializeError } from './runtime/diagnostics'
import { createTerminalOutput } from './runtime/terminal-output'
import { createTerminalServer } from './runtime/terminal-server'

const startedAt = performance.now()
const runtime = readSidecarRuntimeConfig()
const diagnostics = createSidecarDiagnostics(runtime.diagnosticsEnabled, startedAt)
const { log } = diagnostics
const terminal = createTerminalOutput({
  cols: TERMINAL_GRID.cols,
  diagnosticsEnabled: runtime.diagnosticsEnabled,
  log,
  rows: TERMINAL_GRID.rows,
})
const crtAudio = createCrtAudio(log)

diagnostics.setSender((line) => terminal.sendDiagnostic(line))
log('process started', {
  pid: process.pid,
  platform: process.platform,
  arch: process.arch,
  execPath: process.execPath,
  cwd: process.cwd(),
  argv: process.argv,
  grid: `${TERMINAL_GRID.cols}x${TERMINAL_GRID.rows}`,
  instanceId: runtime.instanceId,
  port: runtime.port,
})

process.on('exit', (code) => {
  crtAudio.stop()
  log('process exiting', { code })
})
process.on('warning', (warning) => {
  log('process warning', serializeError(warning))
})
void crtAudio.start()

log('terminal streams created', {
  inputIsTTY: (terminal.input as typeof terminal.input & { isTTY?: boolean }).isTTY,
  outputIsTTY: (terminal.output as typeof terminal.output & { isTTY?: boolean }).isTTY,
  columns: (terminal.output as typeof terminal.output & { columns?: number }).columns,
  rows: (terminal.output as typeof terminal.output & { rows?: number }).rows,
})

let requestHostExit = () => {}
log('creating OpenTUI renderer')
const rendererStartedAt = performance.now()
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
}).catch((error: unknown) => {
  log('OpenTUI renderer creation failed', serializeError(error))
  throw error
})

log('OpenTUI renderer created', {
  elapsedMs: performance.now() - rendererStartedAt,
  width: renderer.width,
  height: renderer.height,
  screenMode: renderer.screenMode,
})

terminal.enableFrameBoundaries()
renderer.setFrameCallback(terminal.waitForReady)
renderer.on('frame', ({ frameId }: { frameId: number }) => {
  terminal.flushFrame('OpenTUI refresh', frameId)
})

log('mounting Solid application')
process.env.TERMWEAVE_BACKGROUND_COLOR = BACKGROUND_COLOR
process.env.TERMWEAVE_FOREGROUND_COLOR = FOREGROUND_COLOR
process.env.TERMWEAVE_TERMINAL_COLS = String(TERMINAL_GRID.cols)
process.env.TERMWEAVE_TERMINAL_ROWS = String(TERMINAL_GRID.rows)
render(() => <App />, renderer)
log('Solid application mounted; waiting for renderer idle')
void renderer.idle().then(() => {
  log('renderer idle after initial frame', terminal.getStats())
})

let shuttingDown = false
let terminalServer: ReturnType<typeof createTerminalServer> | undefined

function shutdownSidecar(reason: string, exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  log('sidecar shutdown started', { reason, exitCode })

  crtAudio.stop()
  terminalServer?.stop()
  try {
    renderer.destroy()
  } catch (error) {
    log('failed to destroy renderer during shutdown', serializeError(error))
  }

  queueMicrotask(() => process.exit(exitCode))
}

terminalServer = createTerminalServer({
  clientToken: runtime.clientToken,
  diagnosticsEnabled: runtime.diagnosticsEnabled,
  instanceId: runtime.instanceId,
  log,
  onShutdownRequested: shutdownSidecar,
  port: runtime.port,
  renderer,
  terminal,
})
requestHostExit = terminalServer.requestHostExit

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => shutdownSidecar(`received ${signal}`))
}

const ownerProcessId = process.ppid
const ownerProcessWatchdog = setInterval(() => {
  if (process.ppid === ownerProcessId) return
  shutdownSidecar(`owner process ${ownerProcessId} exited`)
}, 500)
ownerProcessWatchdog.unref()
