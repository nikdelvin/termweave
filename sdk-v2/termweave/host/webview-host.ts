import { join, resourceDir } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Command } from '@tauri-apps/plugin-shell'
import { getAppConfig, type AppConfig } from '../config'
import {
  OPENTUI_ASSET_ROOT_DIRECTORY,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
} from '../constants'
import {
  activateCrtRenderer,
  type CrtRendererController,
  type CrtRendererStatus,
} from './crt-effects/crt-renderer'
import { createMonitorPresentation } from './monitor-presentation'
import { createSidecarSession, type DesktopWindow, type SidecarCommand } from './sidecar-session'
import { createXtermTerminal } from './xterm-terminal'

type MonitorPresentation = ReturnType<typeof createMonitorPresentation>
type XtermTerminal = ReturnType<typeof createXtermTerminal>
type SidecarSession = ReturnType<typeof createSidecarSession>

export interface WebviewHostDependencies {
  readonly document: Document
  readonly browserWindow: Pick<Window, 'addEventListener'>
  readonly getConfig: () => AppConfig
  readonly createMonitorPresentation: (root: HTMLElement, config: AppConfig) => MonitorPresentation
  readonly createXtermTerminal: (config: AppConfig) => XtermTerminal
  readonly activateRenderer: (terminal: XtermTerminal, config: AppConfig) => CrtRendererController
  readonly createSession: typeof createSidecarSession
  readonly getDesktopWindow: () => DesktopWindow
  readonly resolveOpenTuiAssetRoot: () => Promise<string>
  readonly createCommand: (openTuiAssetRoot: string) => SidecarCommand
  readonly loadFont: (font: string) => Promise<unknown>
}

function resolveDependencies(overrides: Partial<WebviewHostDependencies>): WebviewHostDependencies {
  const hostDocument = overrides.document ?? document
  return {
    document: hostDocument,
    browserWindow: overrides.browserWindow ?? window,
    getConfig: overrides.getConfig ?? getAppConfig,
    createMonitorPresentation: overrides.createMonitorPresentation ?? createMonitorPresentation,
    createXtermTerminal: overrides.createXtermTerminal ?? createXtermTerminal,
    activateRenderer: overrides.activateRenderer ?? activateCrtRenderer,
    createSession: overrides.createSession ?? createSidecarSession,
    getDesktopWindow: overrides.getDesktopWindow ?? getCurrentWindow,
    resolveOpenTuiAssetRoot:
      overrides.resolveOpenTuiAssetRoot ??
      (async () => join(await resourceDir(), OPENTUI_ASSET_ROOT_DIRECTORY)),
    createCommand:
      overrides.createCommand ??
      ((openTuiAssetRoot) =>
        Command.sidecar('binaries/opentui-sidecar', [], {
          encoding: 'raw',
          env: { DEBUG: '', OTUI_ASSET_ROOT: openTuiAssetRoot },
        })),
    loadFont: overrides.loadFont ?? ((font) => hostDocument.fonts.load(font)),
  }
}

function renderRendererStatus(presentation: MonitorPresentation, status: CrtRendererStatus) {
  const failureMessage = status.kind === 'fallback' ? status.message : undefined
  presentation.rendererStatusHost.hidden = failureMessage === undefined
  presentation.rendererStatusMessage.textContent = failureMessage
    ? `CRT POSTPROCESSOR INACTIVE — ${failureMessage} The default renderer is active.`
    : ''
}

export async function startWebviewHost(
  overrides: Partial<WebviewHostDependencies> = {},
): Promise<{ cleanup(): Promise<void> }> {
  const dependencies = resolveDependencies(overrides)
  const root = dependencies.document.querySelector<HTMLElement>('#app')
  if (!root) throw new Error('Missing application root')

  const config = dependencies.getConfig()
  dependencies.document.title = config.name
  const presentation = dependencies.createMonitorPresentation(root, config)
  const terminal = dependencies.createXtermTerminal(config)
  let disposed = false
  let renderer: CrtRendererController | undefined
  let rendererStatusSubscription: { dispose(): void } | undefined
  let session: SidecarSession | undefined
  let cleanupPromise: Promise<void> | undefined

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    disposed = true
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

  dependencies.browserWindow.addEventListener('beforeunload', () => void cleanup(), { once: true })
  import.meta.hot?.dispose(() => void cleanup())

  try {
    try {
      await dependencies.loadFont(`${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`)
    } catch {
      // The bundled font is preferred, but a font-loading failure must not hide the application.
    }
    if (disposed) return { cleanup }

    terminal.open(presentation.terminalHost)
    renderer = dependencies.activateRenderer(terminal, config)
    renderRendererStatus(presentation, renderer.status)
    rendererStatusSubscription = renderer.onStatusChange((status) =>
      renderRendererStatus(presentation, status),
    )

    const openTuiAssetRoot = await dependencies.resolveOpenTuiAssetRoot()
    if (disposed) return { cleanup }
    const command = dependencies.createCommand(openTuiAssetRoot)
    session = dependencies.createSession({
      terminal,
      command,
      appWindow: dependencies.getDesktopWindow(),
    })
    await session.start()
    return { cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
