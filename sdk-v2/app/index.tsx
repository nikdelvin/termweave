import { createCliRenderer, type CliRenderer } from '@opentui/core'
import { render, useKeyboard } from '@opentui/solid'
import { createSignal } from 'solid-js'
import { getAppConfig } from '../shared/config'

function App() {
  const config = getAppConfig()
  const [count, setCount] = createSignal(0)

  useKeyboard((key) => {
    const isLeft = key.sequence === '\u001b[D' || key.sequence === '\u001bOD'
    const isRight = key.sequence === '\u001b[C' || key.sequence === '\u001bOC'

    if (key.name === 'left' && isLeft) {
      key.preventDefault()
      setCount((value) => value - 1)
    } else if (key.name === 'right' && isRight) {
      key.preventDefault()
      setCount((value) => value + 1)
    }
  })

  return (
    <box
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      gap={1}
      backgroundColor={config.backgroundColor}
    >
      <text fg={config.foregroundColor}>Termweave SDK v2</text>
      <text fg={config.foregroundColor}>Use left and right arrows to change the value.</text>
      <text fg={config.foregroundColor}>Value: {count()}</text>
    </box>
  )
}

function writeDiagnostic(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
}

const rendererState: { current?: CliRenderer } = {}
let shuttingDown = false

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  try {
    rendererState.current?.destroy()
  } catch (error) {
    writeDiagnostic(error)
  }

  queueMicrotask(() => process.exit(exitCode))
}

async function start() {
  const config = getAppConfig()

  const renderer = await createCliRenderer({
    stdin: process.stdin,
    stdout: process.stdout,
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
