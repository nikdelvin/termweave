import { getCurrentWindow } from '@tauri-apps/api/window'
import { Command } from '@tauri-apps/plugin-shell'
import { getAppConfig } from '../shared/config'
import { createTerminal, createTerminalSession } from './terminal'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing application root')

const config = getAppConfig()
document.title = config.name
root.style.setProperty('--termweave-background', config.backgroundColor)
root.style.setProperty('--termweave-foreground', config.foregroundColor)

const terminal = createTerminal(config)
terminal.open(root)

const command = Command.sidecar('binaries/opentui-sidecar', [], { encoding: 'raw' })
const session = createTerminalSession({
  terminal,
  command,
  appWindow: getCurrentWindow(),
})

window.addEventListener('beforeunload', () => void session.cleanup(), { once: true })
import.meta.hot?.dispose(() => void session.cleanup())

void session.start()
