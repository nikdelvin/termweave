import { getCurrentWindow } from '@tauri-apps/api/window'
import { Command } from '@tauri-apps/plugin-shell'
import { getAppConfig } from '../config'
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from '../constants'
import {
  activateCrtRenderer,
  type CrtRendererController,
  type CrtRendererStatus,
} from './crt-effects/crt-renderer'
import { createMonitorPresentation } from './monitor-presentation'
import { createSidecarSession } from './sidecar-session'
import { createXtermTerminal } from './xterm-terminal'

type SidecarSession = ReturnType<typeof createSidecarSession>

function renderRendererStatus(
  rendererStatusHost: HTMLElement,
  rendererStatusMessage: HTMLElement,
  status: CrtRendererStatus,
) {
  const failureMessage = status.kind === 'fallback' ? status.message : undefined
  rendererStatusHost.hidden = failureMessage === undefined
  rendererStatusMessage.textContent = failureMessage
    ? `CRT POSTPROCESSOR INACTIVE — ${failureMessage} The default renderer is active.`
    : ''
}

export async function startWebviewHost(): Promise<{ cleanup(): Promise<void> }> {
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('Missing application root')

  const config = getAppConfig()
  document.title = config.name
  const presentation = createMonitorPresentation(root, config)
  const terminal = createXtermTerminal(config)
  let disposed = false
  let renderer: CrtRendererController | undefined
  let rendererStatusSubscription: { dispose(): void } | undefined
  let session: SidecarSession | undefined
  let cleanupPromise: Promise<void> | undefined
  const handleBeforeUnload = () => void cleanup()

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    disposed = true
    window.removeEventListener('beforeunload', handleBeforeUnload)
    presentation.dispose()
    rendererStatusSubscription?.dispose()
    rendererStatusSubscription = undefined
    renderer?.dispose()

    if (session) {
      cleanupPromise = session.cleanup()
    } else {
      terminal.dispose()
      cleanupPromise = Promise.resolve()
    }
    return cleanupPromise
  }

  window.addEventListener('beforeunload', handleBeforeUnload, { once: true })
  import.meta.hot?.dispose(() => void cleanup())

  try {
    try {
      await document.fonts.load(`${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`)
    } catch {}
    if (disposed) return { cleanup }

    terminal.open(presentation.terminalHost)
    renderer = activateCrtRenderer(terminal, config)
    renderRendererStatus(presentation.rendererStatusHost, presentation.rendererStatusMessage, renderer.status)
    rendererStatusSubscription = renderer.onStatusChange((status) =>
      renderRendererStatus(presentation.rendererStatusHost, presentation.rendererStatusMessage, status),
    )

    const command = Command.sidecar('binaries/opentui-sidecar', [], {
      encoding: 'raw',
      env: { DEBUG: '' },
    })
    session = createSidecarSession({
      terminal,
      command,
      appWindow: getCurrentWindow(),
    })
    await session.start()
    return { cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
