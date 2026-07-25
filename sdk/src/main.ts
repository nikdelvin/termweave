import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { FONT_FAMILY } from './runtime/monitor-layout'
import { createSidecarClient } from './runtime/sidecar-client'
import type { FrontendRuntime } from './runtime/sidecar-protocol'
import { createTerminalDisplay } from './runtime/terminal-display'
import './styles.css'

const appWindow = getCurrentWindow()

let cleanupPromise: Promise<void> | undefined
let client: ReturnType<typeof createSidecarClient> | undefined
let disposed = false
let exitRequested = false
let unlistenWindowCloseRequested: (() => void) | undefined
let windowClosePromise: Promise<void> | undefined
let windowRevealed = false

const display = createTerminalDisplay()

async function revealAppWindow() {
  if (windowRevealed || disposed) return

  await appWindow.setFullscreen(true)
  await appWindow.show()
  windowRevealed = true
  display.fit()
}

async function closeWindowForSidecarExit() {
  if (exitRequested || disposed) return

  exitRequested = true
  try {
    await appWindow.close()
  } catch {
    exitRequested = false
  }
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise

  disposed = true
  display.dispose()
  cleanupPromise = client?.stop() ?? Promise.resolve()
  return cleanupPromise
}

window.addEventListener('beforeunload', () => void cleanup(), { once: true })
import.meta.hot?.dispose(() => {
  unlistenWindowCloseRequested?.()
  void cleanup()
})

void (async () => {
  const runtime = await invoke<FrontendRuntime>('frontend_runtime')
  if (disposed) return

  client = createSidecarClient(runtime, {
    onExitRequested: () => void closeWindowForSidecarExit(),
    onFrame: display.writeFrame,
    onRecovered: display.scheduleFocus,
    onRecoveryError: display.writeRecoveryError,
    subscribeInput: display.subscribeInput,
  })
  display.setInputSender(client.sendInput)

  unlistenWindowCloseRequested = await appWindow.onCloseRequested((event) => {
    event.preventDefault()
    if (windowClosePromise) return

    exitRequested = true
    windowClosePromise = (async () => {
      try {
        await cleanup()
      } finally {
        unlistenWindowCloseRequested?.()
        unlistenWindowCloseRequested = undefined
      }

      try {
        await appWindow.close()
      } catch {
        windowClosePromise = undefined
      }
    })()
  })

  await document.fonts.load(`16px ${FONT_FAMILY}`)
  if (disposed) return

  await display.open()
  if (disposed) return
  await client.start()
  if (disposed) return
  await display.firstFrame
  await revealAppWindow()
  display.scheduleFocus()
})().catch(async (error) => {
  display.stopLoadingIndicator()
  await display.showStartupError(error)
  await revealAppWindow().catch(() => undefined)
})
