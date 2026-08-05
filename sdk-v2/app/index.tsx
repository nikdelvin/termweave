import { createCliRenderer, type CliRenderer } from '@opentui/core'
import { render, useKeyboard } from '@opentui/solid'
import { createSignal } from 'solid-js'
import { PixelRenderer } from '#termweave'
import campfireUri from './assets/campfire.gif' with { type: 'file' }
import { getAppConfig } from '../shared/config'

function App() {
  const config = getAppConfig()
  const cols = config.terminalGrid.cols
  const rows = config.terminalGrid.rows
  const centerX = Math.floor(cols / 2)
  const centerY = Math.floor(rows / 2)
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
    <box width="100%" height="100%" backgroundColor={config.backgroundColor}>
      <PixelRenderer uri={campfireUri} width="100%" height="100%">
        <box
          position="absolute"
          top={0}
          left={0}
          width={cols}
          height={rows}
          border
          borderStyle="heavy"
          borderColor="#FFFFFF"
        />
        <box
          position="absolute"
          top={3}
          left={6}
          width={cols - 12}
          height={rows - 6}
          border
          borderStyle="heavy"
          borderColor="#FFFFFF"
        />
        <box
          position="absolute"
          top={8}
          left={14}
          width={cols - 28}
          height={rows - 16}
          border
          borderStyle="heavy"
          borderColor="#FFFFFF"
        />

        <text position="absolute" top={1} left={4} fg="#FFFFFF">
          TOP LEFT
        </text>
        <text position="absolute" top={1} left={cols - 13} fg="#FFFFFF">
          TOP RIGHT
        </text>
        <text position="absolute" top={rows - 2} left={4} fg="#FFFFFF">
          BOTTOM LEFT
        </text>
        <text position="absolute" top={rows - 2} left={cols - 16} fg="#FFFFFF">
          BOTTOM RIGHT
        </text>

        <text position="absolute" top={centerY - 1} left={centerX - 1} fg="#FFFFFF">
          ┃
        </text>
        <text position="absolute" top={centerY} left={centerX - 7} fg="#FFFFFF">
          ━━━━━━╋━━━━━━
        </text>
        <text position="absolute" top={centerY + 1} left={centerX - 1} fg="#FFFFFF">
          ┃
        </text>
        <text position="absolute" top={centerY + 3} left={centerX - 8} fg="#FFFFFF">
          CENTER REFERENCE
        </text>
        <text position="absolute" top={centerY + 5} left={centerX - 15} fg="#FFFFFF">
          USE LEFT / RIGHT ARROWS TO CHANGE
        </text>
        <text position="absolute" top={centerY + 7} left={centerX - 4} fg="#FFFFFF">
          VALUE: {count()}
        </text>

        <text position="absolute" top={5} left={centerX - 15} fg="#FFFFFF">
          WHITE PHOSPHOR / RGB EDGE TEST
        </text>
        <text position="absolute" top={rows - 6} left={centerX - 14} fg="#ff5050">
          RED
        </text>
        <text position="absolute" top={rows - 6} left={centerX - 5} fg="#50ff50">
          GREEN
        </text>
        <text position="absolute" top={rows - 6} left={centerX + 7} fg="#5050ff">
          BLUE
        </text>
      </PixelRenderer>
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
  // A distinct stdout object selects OpenTUI's callback-aware NativeSpanFeed while preserving the
  // exact sidecar byte stream and fixed terminal geometry.
  const nativeFeedStdout = {
    columns: config.terminalGrid.cols,
    rows: config.terminalGrid.rows,
    write: process.stdout.write.bind(process.stdout),
  } as NodeJS.WriteStream

  const renderer = await createCliRenderer({
    stdin: process.stdin,
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
