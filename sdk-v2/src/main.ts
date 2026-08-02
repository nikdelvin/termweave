import { getCurrentWindow } from '@tauri-apps/api/window'
import { Command } from '@tauri-apps/plugin-shell'
import { getAppConfig } from '../shared/config'
import { createPresentation, terminalFontFamily } from './presentation'
import { createTerminal, createTerminalSession, enableWebglRenderer } from './terminal'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing application root')

const config = getAppConfig()
document.title = config.name
const presentation = createPresentation(root, config)
const terminal = createTerminal(config)
let disposed = false
let renderer: ReturnType<typeof enableWebglRenderer> | undefined
let session: ReturnType<typeof createTerminalSession> | undefined
let cleanupPromise: Promise<void> | undefined

function cleanup() {
  if (cleanupPromise) return cleanupPromise
  disposed = true
  presentation.dispose()
  renderer?.dispose()

  if (session) {
    cleanupPromise = session.cleanup()
  } else {
    terminal.dispose()
    cleanupPromise = Promise.resolve()
  }
  return cleanupPromise
}

window.addEventListener('beforeunload', () => void cleanup(), { once: true })
import.meta.hot?.dispose(() => void cleanup())

void (async () => {
  try {
    await document.fonts.load(`${config.terminalGrid.fontSize}px ${terminalFontFamily}`)
  } catch {
    // The bundled font is preferred, but a font-loading failure must not hide the application.
  }
  if (disposed) return

  terminal.open(presentation.terminalHost)
  renderer = enableWebglRenderer(terminal)

  const command = Command.sidecar('binaries/opentui-sidecar', [], { encoding: 'raw' })
  session = createTerminalSession({
    terminal,
    command,
    appWindow: getCurrentWindow(),
  })
  await session.start()
})()
