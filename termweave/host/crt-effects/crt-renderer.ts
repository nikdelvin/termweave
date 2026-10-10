import { WebglAddon } from '@xterm/addon-webgl'
import type { IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm'
import { errorMessage } from '../../error-message'
import {
  CrtPostprocessor,
  discoverActivatedWebglCanvas,
  type CrtPostprocessorOptions,
} from './crt-postprocessor'

export interface WebglAddonPort extends ITerminalAddon {
  onContextLoss(handler: () => void): IDisposable
}

export type WebglAddonFactory = () => WebglAddonPort
type CrtPostprocessorPort = Pick<CrtPostprocessor, 'dispose'>
export type CrtPostprocessorFactory = (options: CrtPostprocessorOptions) => CrtPostprocessorPort

type RendererConfig = Readonly<{ themeColor: string }>

export type CrtRendererStatus =
  Readonly<{ kind: 'active' }> | Readonly<{ kind: 'fallback'; message: string }>

export interface CrtRendererController extends IDisposable {
  readonly status: CrtRendererStatus
  onStatusChange(handler: (status: CrtRendererStatus) => void): IDisposable
}

type RendererTerminal = Pick<Terminal, 'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'>

export function activateCrtRenderer(
  terminal: RendererTerminal,
  config: RendererConfig,
  createAddon?: WebglAddonFactory,
  createPostprocessor: CrtPostprocessorFactory = (options) => new CrtPostprocessor(options),
): CrtRendererController {
  const createWebglAddon = createAddon ?? (() => new WebglAddon(false))
  let addon: WebglAddonPort | undefined
  let postprocessor: CrtPostprocessorPort | undefined
  let subscriptions: IDisposable[] = []
  let disposed = false
  let fallbackLatched = false
  let status: CrtRendererStatus = {
    kind: 'fallback',
    message: 'Renderer activation did not complete.',
  }
  const statusHandlers = new Set<(status: CrtRendererStatus) => void>()

  const setStatus = (nextStatus: CrtRendererStatus) => {
    status = nextStatus
    for (const handler of statusHandlers) {
      try {
        handler(status)
      } catch {}
    }
  }

  const disposeActive = () => {
    for (const subscription of subscriptions.splice(0)) {
      try {
        subscription.dispose()
      } catch {}
    }
    try {
      postprocessor?.dispose()
    } catch {}
    postprocessor = undefined
    try {
      addon?.dispose()
    } catch {}
    addon = undefined
  }

  const requestDefaultRendererRedraw = () => {
    const redrawTerminal = terminal as Partial<RendererTerminal>
    if (typeof redrawTerminal.refresh !== 'function' || typeof redrawTerminal.rows !== 'number')
      return
    try {
      redrawTerminal.refresh(0, Math.max(0, redrawTerminal.rows - 1))
    } catch {}
  }

  const fallback = (message: string) => {
    if (fallbackLatched || disposed) return
    fallbackLatched = true
    setStatus({ kind: 'fallback', message })
    disposeActive()
    requestDefaultRendererRedraw()
  }

  try {
    const created = createWebglAddon()
    addon = created
    const terminalElement = terminal.element
    if (!terminalElement) throw new Error('CRT effects require an open public xterm element')
    const canvasesBeforeActivation = new Set(
      terminalElement.querySelectorAll<HTMLCanvasElement>('canvas'),
    )

    subscriptions.push(
      created.onContextLoss(() => {
        fallback('The WebGL context was permanently lost.')
      }),
    )

    terminal.loadAddon(created)

    const activated = discoverActivatedWebglCanvas(terminalElement, canvasesBeforeActivation)
    postprocessor = createPostprocessor({
      terminal,
      canvas: activated.canvas,
      gl: activated.gl,
      themeColor: config.themeColor,
      onRuntimeFailure: () => {
        fallback('The CRT postprocessor failed a framebuffer, resize, or presentation check.')
      },
    })
    setStatus({ kind: 'active' })
  } catch (error) {
    fallback(`Renderer activation failed: ${errorMessage(error)}`)
  }

  return {
    get status() {
      return status
    },
    onStatusChange(handler) {
      statusHandlers.add(handler)
      return {
        dispose() {
          statusHandlers.delete(handler)
        },
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      disposeActive()
      statusHandlers.clear()
    },
  }
}
