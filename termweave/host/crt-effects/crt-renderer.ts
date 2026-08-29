import { WebglAddon } from '@xterm/addon-webgl'
import type { IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm'
import type { AppConfig } from '../../config'
import { errorMessage } from '../../error-message'
import {
  CrtPostprocessor,
  discoverActivatedWebglCanvas,
  type CrtPostprocessorOptions,
} from './crt-postprocessor'
import {
  browserAnimationFrameScheduler,
  createGlyphAtlasMonitor,
  type AnimationFrameScheduler,
} from './glyph-atlas'

export interface WebglAddonPort extends ITerminalAddon {
  readonly textureAtlas?: HTMLCanvasElement
  onContextLoss(handler: () => void): IDisposable
  onChangeTextureAtlas?(handler: (canvas: HTMLCanvasElement) => void): IDisposable
  onAddTextureAtlasCanvas?(handler: (canvas: HTMLCanvasElement) => void): IDisposable
  onRemoveTextureAtlasCanvas?(handler: (canvas: HTMLCanvasElement) => void): IDisposable
}

export type WebglAddonFactory = () => WebglAddonPort
type CrtPostprocessorPort = Pick<CrtPostprocessor, 'dispose' | 'presentForHandoff'>
export type CrtPostprocessorFactory = (options: CrtPostprocessorOptions) => CrtPostprocessorPort
interface RendererCanvasHandoff extends IDisposable {
  attachAbove(replacement: HTMLCanvasElement): void
}

type RendererConfig = Pick<AppConfig, 'themeColor'>

export type CrtRendererStatus =
  Readonly<{ kind: 'active' }> | Readonly<{ kind: 'fallback'; message: string }>

export interface CrtRendererController extends IDisposable {
  readonly status: CrtRendererStatus
  onStatusChange(handler: (status: CrtRendererStatus) => void): IDisposable
}

type RendererTerminal = Pick<Terminal, 'element' | 'loadAddon' | 'onRender' | 'refresh' | 'rows'>

/** Detaches xterm's outgoing canvas so its last frame can cover the replacement's first draw. */
function detachRendererCanvas(source: HTMLCanvasElement): RendererCanvasHandoff | undefined {
  try {
    if (!source.parentElement) return
    source.remove()

    return {
      attachAbove(replacement) {
        replacement.parentElement?.appendChild(source)
      },
      dispose() {
        source.remove()
      },
    }
  } catch {
    // A failed visual handoff must not prevent the required addon recreation.
    return
  }
}

export function activateCrtRenderer(
  terminal: RendererTerminal,
  config: RendererConfig,
  createAddon?: WebglAddonFactory,
  createPostprocessor: CrtPostprocessorFactory = (options) => new CrtPostprocessor(options),
  animationFrameScheduler: AnimationFrameScheduler = browserAnimationFrameScheduler,
): CrtRendererController {
  const createWebglAddon = createAddon ?? (() => new WebglAddon(false))
  type RendererGeneration = {
    addon: WebglAddonPort
    canvas?: HTMLCanvasElement
    postprocessor?: CrtPostprocessorPort
    canvasHandoff?: RendererCanvasHandoff
    subscriptions: IDisposable[]
  }

  let generation: RendererGeneration | undefined
  let disposed = false
  let fallbackLatched = false
  let status: CrtRendererStatus = {
    kind: 'fallback',
    message: 'Renderer activation did not complete.',
  }
  const statusHandlers = new Set<(status: CrtRendererStatus) => void>()
  let recycleWebglAddon = () => {}
  const atlasMonitor = createGlyphAtlasMonitor({
    onRecycle: () => recycleWebglAddon(),
    scheduler: animationFrameScheduler,
  })

  const setStatus = (nextStatus: CrtRendererStatus) => {
    status = nextStatus
    for (const handler of statusHandlers) {
      try {
        handler(status)
      } catch {
        // A diagnostic observer must not interrupt renderer fallback or disposal.
      }
    }
  }

  const disposeGeneration = () => {
    const current = generation
    generation = undefined
    atlasMonitor.resetGeneration()
    if (!current) return
    try {
      current.canvasHandoff?.dispose()
    } catch {
      // Visual handoff cleanup must not interrupt renderer disposal.
    }
    current.canvasHandoff = undefined
    for (const subscription of current.subscriptions.splice(0)) {
      try {
        subscription.dispose()
      } catch {
        // Renderer replacement must survive partially disposed event state.
      }
    }
    try {
      current.postprocessor?.dispose()
    } catch {
      // Partial WebGL state must not prevent the stock addon from being removed.
    }
    try {
      current.addon.dispose()
    } catch {
      // xterm's default renderer remains the final fallback.
    }
  }

  const requestDefaultRendererRedraw = () => {
    const redrawTerminal = terminal as Partial<RendererTerminal>
    if (typeof redrawTerminal.refresh !== 'function' || typeof redrawTerminal.rows !== 'number')
      return
    try {
      redrawTerminal.refresh(0, Math.max(0, redrawTerminal.rows - 1))
    } catch {
      // Default-renderer activation remains useful even if redraw scheduling fails.
    }
  }

  const fallback = (message: string, failure?: { emergencyHandoff(): void }) => {
    if (fallbackLatched || disposed) return
    fallbackLatched = true
    setStatus({ kind: 'fallback', message })
    try {
      failure?.emergencyHandoff()
    } catch {
      // Emergency handoff is best effort and never replaces renderer fallback.
    }
    atlasMonitor.dispose()
    disposeGeneration()
    requestDefaultRendererRedraw()
  }

  const activateGeneration = (canvasHandoff?: RendererCanvasHandoff) => {
    const addon = createWebglAddon()
    const current: RendererGeneration = { addon, canvasHandoff, subscriptions: [] }
    generation = current
    const terminalElement = terminal.element
    if (!terminalElement) throw new Error('CRT effects require an open public xterm element')
    const canvasesBeforeActivation = new Set(
      terminalElement.querySelectorAll<HTMLCanvasElement>('canvas'),
    )

    try {
      current.subscriptions.push(
        addon.onContextLoss(() => {
          if (generation === current) fallback('The WebGL context was permanently lost.')
        }),
      )
      if (addon.onChangeTextureAtlas) {
        current.subscriptions.push(
          addon.onChangeTextureAtlas((canvas) => {
            if (generation === current) atlasMonitor.changePage(canvas)
          }),
        )
      }
      if (addon.onAddTextureAtlasCanvas) {
        current.subscriptions.push(
          addon.onAddTextureAtlasCanvas((canvas) => {
            if (generation === current) atlasMonitor.addPage(canvas)
          }),
        )
      }
      if (addon.onRemoveTextureAtlasCanvas) {
        current.subscriptions.push(
          addon.onRemoveTextureAtlasCanvas((canvas) => {
            if (generation === current) atlasMonitor.removePage(canvas)
          }),
        )
      }

      terminal.loadAddon(addon)

      const activated = discoverActivatedWebglCanvas(terminalElement, canvasesBeforeActivation)
      current.canvas = activated.canvas
      const textureUnits = activated.gl.getParameter(activated.gl.MAX_TEXTURE_IMAGE_UNITS)
      if (typeof textureUnits !== 'number' || !Number.isFinite(textureUnits) || textureUnits < 1) {
        throw new Error('The WebGL glyph-atlas page limit is unavailable')
      }
      atlasMonitor.setMaximumPages(Math.min(32, Math.floor(textureUnits)))
      if (addon.textureAtlas) atlasMonitor.addPage(addon.textureAtlas)

      current.postprocessor = createPostprocessor({
        terminal,
        canvas: activated.canvas,
        gl: activated.gl,
        themeColor: config.themeColor,
        onRuntimeFailure: (failure) => {
          if (generation === current) {
            fallback(
              'The CRT postprocessor failed a framebuffer, resize, restoration, or presentation check.',
              failure,
            )
          }
        },
      })
      if (current.canvasHandoff) {
        try {
          current.canvasHandoff.attachAbove(activated.canvas)
        } catch {
          current.canvasHandoff.dispose()
          current.canvasHandoff = undefined
        }
      }
      if (current.canvasHandoff) {
        const firstRenderSubscription = terminal.onRender(() => {
          if (generation !== current) return
          try {
            current.canvasHandoff?.dispose()
          } finally {
            current.canvasHandoff = undefined
            firstRenderSubscription.dispose()
          }
        })
        current.subscriptions.push(firstRenderSubscription)
      }
      setStatus({ kind: 'active' })
    } catch (error) {
      if (generation === current) disposeGeneration()
      throw error
    }
  }

  recycleWebglAddon = () => {
    if (disposed || fallbackLatched || !generation) return
    const outgoing = generation
    outgoing.postprocessor?.presentForHandoff()
    if (disposed || fallbackLatched || generation !== outgoing) return

    let canvasHandoff: RendererCanvasHandoff | undefined
    try {
      if (outgoing.canvas) canvasHandoff = detachRendererCanvas(outgoing.canvas)
    } catch {
      // The renderer still has to recycle if a custom visual handoff fails.
    }
    disposeGeneration()
    try {
      activateGeneration(canvasHandoff)
      requestDefaultRendererRedraw()
    } catch (error) {
      try {
        canvasHandoff?.dispose()
      } catch {
        // Renderer fallback remains authoritative if handoff cleanup also fails.
      }
      fallback(`Renderer reactivation failed: ${errorMessage(error)}`)
    }
  }

  try {
    activateGeneration()
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
      atlasMonitor.dispose()
      disposeGeneration()
      statusHandlers.clear()
    },
  }
}
