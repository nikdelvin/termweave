import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { MONITOR_OVERLAY_ENABLED, SIDECAR_PROTOCOL, TERMINAL_GRID } from '../shared/terminal-config'
import { diagnostic } from './diagnostics'
import { FONT_FAMILY } from './runtime/monitor-layout'
import { createSidecarClient } from './runtime/sidecar-client'
import type { FrontendRuntime } from './runtime/sidecar-protocol'
import { createTerminalDisplay } from './runtime/terminal-display'
import './styles.css'

const appWebview = getCurrentWebview()
const appWindow = getCurrentWindow()

let cleanupPromise: Promise<void> | undefined
let client: ReturnType<typeof createSidecarClient> | undefined
let disposed = false
let exitRequested = false
let unlistenWindowCloseRequested: (() => void) | undefined
let windowClosePromise: Promise<void> | undefined
let windowRevealed = false

diagnostic('frontend', 'main module evaluating', {
  grid: `${TERMINAL_GRID.cols}x${TERMINAL_GRID.rows}`,
  sidecarProtocol: SIDECAR_PROTOCOL,
  fontFamily: FONT_FAMILY,
  monitorOverlay: MONITOR_OVERLAY_ENABLED,
  windowLabel: appWindow.label,
  webviewLabel: appWebview.label,
})

const display = createTerminalDisplay()

async function revealAppWindow(reason: string) {
  if (windowRevealed || disposed) return

  diagnostic('tauri', 'revealing initialized window', { reason })
  await appWindow.setFullscreen(true)
  await appWindow.show()
  windowRevealed = true
  display.fit()
  diagnostic('tauri', 'initialized window revealed', { reason })
}

async function closeWindowForSidecarExit() {
  if (exitRequested || disposed) return

  exitRequested = true
  diagnostic('frontend', 'sidecar requested application exit')
  try {
    await appWindow.close()
  } catch (error) {
    exitRequested = false
    diagnostic('tauri', 'failed to close window after sidecar exit request', error, 'error')
  }
}

function cleanup(reason: string) {
  if (cleanupPromise) return cleanupPromise

  diagnostic('frontend', 'cleanup started', { reason })
  disposed = true
  display.dispose()
  cleanupPromise = (client?.stop(reason) ?? Promise.resolve()).then(() => {
    diagnostic('frontend', 'cleanup completed', { reason })
  })
  return cleanupPromise
}

window.addEventListener('beforeunload', () => void cleanup('window unloading'), { once: true })
import.meta.hot?.dispose(() => {
  unlistenWindowCloseRequested?.()
  void cleanup('hot reload')
})

void (async () => {
  diagnostic('bootstrap', 'started')

  let runtime: FrontendRuntime
  try {
    runtime = await invoke<FrontendRuntime>('frontend_runtime')
    const { sidecarToken: _sidecarToken, ...safeRuntime } = runtime
    diagnostic('tauri', 'frontend runtime received', {
      ...safeRuntime,
      sidecarTokenPresent: _sidecarToken.length > 0,
    })
  } catch (error) {
    diagnostic('tauri', 'native backend diagnostics failed', error, 'error')
    throw error
  }
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
        await cleanup('window close requested')
      } finally {
        unlistenWindowCloseRequested?.()
        unlistenWindowCloseRequested = undefined
      }

      try {
        await appWindow.close()
      } catch (error) {
        diagnostic('tauri', 'failed to close window after cleanup', error, 'error')
        windowClosePromise = undefined
      }
    })()
  })
  diagnostic('tauri', 'window close interceptor installed')

  diagnostic('font', 'loading', { query: `16px ${FONT_FAMILY}` })
  const loadedFonts = await document.fonts.load(`16px ${FONT_FAMILY}`)
  diagnostic('font', 'load completed', {
    matches: loadedFonts.length,
    status: document.fonts.status,
    check: document.fonts.check(`16px ${FONT_FAMILY}`),
    registeredFaces: Array.from(document.fonts).map((face) => ({
      family: face.family,
      status: face.status,
      style: face.style,
      weight: face.weight,
    })),
  })
  if (disposed) return

  await display.open()
  if (disposed) return
  await client.start()
  if (disposed) return
  diagnostic('bootstrap', 'waiting for first OpenTUI frame')
  await display.firstFrame
  await revealAppWindow('first OpenTUI frame parsed')
  display.scheduleFocus()
  diagnostic('bootstrap', 'completed')
})().catch(async (error) => {
  diagnostic('bootstrap', 'fatal startup error', error, 'error')
  display.stopLoadingIndicator()
  await display.showStartupError(error)

  try {
    await revealAppWindow('fatal startup error')
  } catch (revealError) {
    diagnostic('tauri', 'failed to reveal startup error', revealError, 'error')
  }
})
