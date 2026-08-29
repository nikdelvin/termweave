import { describe, expect, test } from 'bun:test'
import { parseAppConfig } from '../termweave/config'
import { startWebviewHost, type WebviewHostDependencies } from '../termweave/host/webview-host'
import { validAppConfig } from './fixtures'

function hostFixture(options: { assetFailure?: Error } = {}) {
  const events: string[] = []
  const root = {} as HTMLElement
  const rendererStatusHost = { hidden: true } as HTMLElement
  const rendererStatusMessage = { textContent: '' } as HTMLElement
  const hostDocument = {
    title: '',
    querySelector(selector: string) {
      return selector === '#app' ? root : null
    },
  } as unknown as Document
  const terminal = {
    open(host: HTMLElement) {
      expect(host).toBe(root)
      events.push('terminal:open')
    },
    dispose() {
      events.push('terminal:dispose')
    },
  }
  let statusHandler: (status: { kind: 'active' } | { kind: 'fallback'; message: string }) => void
  const renderer = {
    status: { kind: 'active' } as const,
    onStatusChange(handler: typeof statusHandler) {
      events.push('renderer:subscribe')
      statusHandler = handler
      return { dispose: () => events.push('renderer:unsubscribe') }
    },
    dispose() {
      events.push('renderer:dispose')
    },
  }
  const session = {
    async start() {
      events.push('session:start')
    },
    async cleanup() {
      events.push('session:cleanup')
    },
    inputIdle: () => Promise.resolve(),
  }

  const dependencies = {
    document: hostDocument,
    browserWindow: {
      addEventListener(type: string) {
        events.push(`window:${type}`)
      },
    },
    getConfig: () => parseAppConfig(validAppConfig()),
    createMonitorPresentation() {
      events.push('presentation:create')
      return {
        terminalHost: root,
        rendererStatusHost,
        rendererStatusMessage,
        fit() {},
        dispose() {
          events.push('presentation:dispose')
        },
      }
    },
    createXtermTerminal() {
      events.push('terminal:create')
      return terminal
    },
    activateRenderer() {
      events.push('renderer:activate')
      return renderer
    },
    createSession() {
      events.push('session:create')
      return session
    },
    getDesktopWindow() {
      events.push('window:get')
      return {}
    },
    async resolveOpenTuiAssetRoot() {
      events.push('asset-root:resolve')
      if (options.assetFailure) throw options.assetFailure
      return '/resources/opentui-assets'
    },
    async resolveBundledMediaRoot() {
      events.push('media-root:resolve')
      return '/resources/termweave-media'
    },
    createCommand(assetRoot: string, mediaRoot: string) {
      expect(assetRoot).toBe('/resources/opentui-assets')
      expect(mediaRoot).toBe('/resources/termweave-media')
      events.push('command:create')
      return {}
    },
    async loadFont() {
      events.push('font:load')
    },
  } as unknown as Partial<WebviewHostDependencies>

  return {
    dependencies,
    events,
    rendererStatusHost,
    rendererStatusMessage,
    publishFallback(message: string) {
      statusHandler!({ kind: 'fallback', message })
    },
  }
}

describe('WebView host orchestration', () => {
  test('subscribes to renderer status before creating and starting the sidecar session', async () => {
    const fixture = hostFixture()
    const host = await startWebviewHost(fixture.dependencies)

    expect(fixture.events).toEqual([
      'presentation:create',
      'terminal:create',
      'window:beforeunload',
      'font:load',
      'terminal:open',
      'renderer:activate',
      'renderer:subscribe',
      'asset-root:resolve',
      'media-root:resolve',
      'command:create',
      'window:get',
      'session:create',
      'session:start',
    ])

    fixture.publishFallback('context lost')
    expect(fixture.rendererStatusHost.hidden).toBe(false)
    expect(fixture.rendererStatusMessage.textContent).toContain('context lost')
    expect(fixture.rendererStatusMessage.textContent).toContain('default renderer is active')

    const firstCleanup = host.cleanup()
    const secondCleanup = host.cleanup()
    expect(secondCleanup).toBe(firstCleanup)
    await firstCleanup
    expect(fixture.events.slice(-4)).toEqual([
      'presentation:dispose',
      'renderer:unsubscribe',
      'renderer:dispose',
      'session:cleanup',
    ])
  })

  test('cleans partial host state before surfacing an unrecoverable startup failure', async () => {
    const fixture = hostFixture({ assetFailure: new Error('resources unavailable') })
    await expect(startWebviewHost(fixture.dependencies)).rejects.toThrow('resources unavailable')
    expect(fixture.events.slice(-4)).toEqual([
      'presentation:dispose',
      'renderer:unsubscribe',
      'renderer:dispose',
      'terminal:dispose',
    ])
  })
})
