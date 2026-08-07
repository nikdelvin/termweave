import '@xterm/xterm/css/xterm.css'
import './webview-styles.css'
import './crt-effects/crt-styles.css'
import { startWebviewHost } from './webview-host'

void startWebviewHost().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const status = document.querySelector<HTMLElement>('#renderer-status')
  const statusMessage = document.querySelector<HTMLElement>('#renderer-status-message')
  if (status && statusMessage) {
    status.hidden = false
    statusMessage.textContent = `TERMWEAVE HOST FAILED — ${message}`
  } else {
    console.error(error)
  }
})
