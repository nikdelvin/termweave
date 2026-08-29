import type { IDisposable, Terminal } from '@xterm/xterm'
import { normalizeRgb, parseHexRgb } from '../../color'
import {
  crtBrightPassThreshold,
  crtFragmentShaderSource,
  crtVertexShaderSource,
} from './crt-optics'

export type CrtTerminal = Pick<Terminal, 'onRender'>

export type RuntimePostprocessorFailure = Readonly<{
  emergencyHandoff(): void
}>

type ObserverLike = Pick<MutationObserver, 'disconnect' | 'observe'>
type CreateObserver = (callback: MutationCallback) => ObserverLike

export type CrtPostprocessorOptions = Readonly<{
  terminal: CrtTerminal
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  themeColor: string
  onRuntimeFailure(failure: RuntimePostprocessorFailure): void
  createObserver?: CreateObserver
}>

type GlResources = Readonly<{
  generation: number
  vertexShader: WebGLShader
  fragmentShader: WebGLShader
  program: WebGLProgram
  vertexBuffer: WebGLBuffer
  vertexArray: WebGLVertexArrayObject
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  terminalLocation: WebGLUniformLocation
  drawableSizeLocation: WebGLUniformLocation
  backgroundLocation: WebGLUniformLocation
  brightPassThresholdLocation: WebGLUniformLocation
}>

type SharedGlState = Readonly<{
  program: WebGLProgram | null
  vertexArray: WebGLVertexArrayObject | null
  arrayBuffer: WebGLBuffer | null
  viewport: Int32Array
  blendEnabled: boolean
  activeTexture: number
  texture0Binding: WebGLTexture | null
  readFramebuffer: WebGLFramebuffer | null
  drawFramebuffer: WebGLFramebuffer | null
}>

function saveSharedState(gl: WebGL2RenderingContext): SharedGlState {
  const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number
  gl.activeTexture(gl.TEXTURE0)
  const texture0Binding = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
  gl.activeTexture(activeTexture)
  return {
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    vertexArray: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
    arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    viewport: new Int32Array(gl.getParameter(gl.VIEWPORT) as Int32Array),
    blendEnabled: gl.isEnabled(gl.BLEND),
    activeTexture,
    texture0Binding,
    readFramebuffer: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    drawFramebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
  }
}

function restoreSharedState(gl: WebGL2RenderingContext, state: SharedGlState) {
  gl.useProgram(state.program)
  gl.bindVertexArray(state.vertexArray)
  gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer)
  gl.viewport(state.viewport[0]!, state.viewport[1]!, state.viewport[2]!, state.viewport[3]!)
  if (state.blendEnabled) gl.enable(gl.BLEND)
  else gl.disable(gl.BLEND)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, state.texture0Binding)
  gl.activeTexture(state.activeTexture)
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer)
}

function clearRenderSurfaces(
  gl: WebGL2RenderingContext,
  targetFramebuffer: WebGLFramebuffer,
  background: readonly [number, number, number],
) {
  const drawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
  const clearColor = new Float32Array(gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array)
  const colorMask = [...(gl.getParameter(gl.COLOR_WRITEMASK) as boolean[])]
  const scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST)

  try {
    gl.disable(gl.SCISSOR_TEST)
    gl.colorMask(true, true, true, true)
    gl.clearColor(background[0], background[1], background[2], 1)
    for (const framebuffer of [targetFramebuffer, null]) {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
  } finally {
    gl.clearColor(clearColor[0]!, clearColor[1]!, clearColor[2]!, clearColor[3]!)
    gl.colorMask(colorMask[0]!, colorMask[1]!, colorMask[2]!, colorMask[3]!)
    if (scissorEnabled) gl.enable(gl.SCISSOR_TEST)
    else gl.disable(gl.SCISSOR_TEST)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer)
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create CRT shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) ?? 'unknown shader compiler error'
    gl.deleteShader(shader)
    throw new Error(`Could not compile CRT shader: ${detail}`)
  }
  return shader
}

function requiredUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string) {
  const location = gl.getUniformLocation(program, name)
  if (!location) throw new Error(`Missing CRT shader uniform ${name}`)
  return location
}

function validDimensions(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
  const width = canvas.width
  const height = canvas.height
  const maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isFinite(maximum) ||
    width <= 0 ||
    height <= 0 ||
    maximum <= 0 ||
    width > maximum ||
    height > maximum ||
    gl.drawingBufferWidth !== width ||
    gl.drawingBufferHeight !== height
  ) {
    throw new Error(
      `CRT target dimensions ${width}x${height} do not match the WebGL2 drawing buffer`,
    )
  }
  return { width, height }
}

function allocateTarget(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  texture: WebGLTexture,
  framebuffer: WebGLFramebuffer,
) {
  const dimensions = validDimensions(canvas, gl)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    dimensions.width,
    dimensions.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  )
  if (gl.getError() !== gl.NO_ERROR)
    throw new Error('Could not allocate the full-resolution CRT target')

  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('The full-resolution CRT framebuffer is incomplete')
  }
  return dimensions
}

function bestEffort(action: () => void) {
  try {
    action()
  } catch {
    // Transactional fallback must continue through every remaining cleanup step.
  }
}

function deleteResources(gl: WebGL2RenderingContext, resources: GlResources | undefined) {
  if (!resources) return
  bestEffort(() => gl.deleteFramebuffer(resources.framebuffer))
  bestEffort(() => gl.deleteTexture(resources.texture))
  bestEffort(() => gl.deleteVertexArray(resources.vertexArray))
  bestEffort(() => gl.deleteBuffer(resources.vertexBuffer))
  bestEffort(() => gl.deleteProgram(resources.program))
  bestEffort(() => gl.deleteShader(resources.fragmentShader))
  bestEffort(() => gl.deleteShader(resources.vertexShader))
}

function createResources(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  generation: number,
) {
  const state = saveSharedState(gl)
  let vertexShader: WebGLShader | undefined
  let fragmentShader: WebGLShader | undefined
  let program: WebGLProgram | undefined
  let vertexBuffer: WebGLBuffer | undefined
  let vertexArray: WebGLVertexArrayObject | undefined
  let texture: WebGLTexture | undefined
  let framebuffer: WebGLFramebuffer | undefined

  try {
    if (gl.isContextLost()) throw new Error('The WebGL2 context is unavailable')
    vertexShader = compileShader(gl, gl.VERTEX_SHADER, crtVertexShaderSource)
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, crtFragmentShaderSource)
    program = gl.createProgram() ?? undefined
    if (!program) throw new Error('Could not create CRT shader program')
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `Could not link CRT shader: ${gl.getProgramInfoLog(program) ?? 'unknown error'}`,
      )
    }

    vertexBuffer = gl.createBuffer() ?? undefined
    vertexArray = gl.createVertexArray() ?? undefined
    texture = gl.createTexture() ?? undefined
    framebuffer = gl.createFramebuffer() ?? undefined
    if (!vertexBuffer || !vertexArray || !texture || !framebuffer) {
      throw new Error('Could not create all CRT WebGL resources')
    }

    gl.bindVertexArray(vertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    allocateTarget(gl, canvas, texture, framebuffer)

    const resources: GlResources = {
      generation,
      vertexShader,
      fragmentShader,
      program,
      vertexBuffer,
      vertexArray,
      texture,
      framebuffer,
      terminalLocation: requiredUniform(gl, program, 'u_terminal'),
      drawableSizeLocation: requiredUniform(gl, program, 'u_drawableSize'),
      backgroundLocation: requiredUniform(gl, program, 'u_background'),
      brightPassThresholdLocation: requiredUniform(gl, program, 'u_brightPassThreshold'),
    }
    return resources
  } catch (error) {
    if (framebuffer) gl.deleteFramebuffer(framebuffer)
    if (texture) gl.deleteTexture(texture)
    if (vertexArray) gl.deleteVertexArray(vertexArray)
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer)
    if (program) gl.deleteProgram(program)
    if (fragmentShader) gl.deleteShader(fragmentShader)
    if (vertexShader) gl.deleteShader(vertexShader)
    throw error
  } finally {
    restoreSharedState(gl, state)
  }
}

export function discoverActivatedWebglCanvas(
  terminalElement: HTMLElement,
  canvasesBeforeActivation: ReadonlySet<HTMLCanvasElement>,
) {
  const matches: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext }[] = []
  for (const canvas of terminalElement.querySelectorAll('canvas')) {
    if (canvasesBeforeActivation.has(canvas)) continue
    const gl = canvas.getContext('webgl2')
    if (gl) matches.push({ canvas, gl })
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one newly activated xterm WebGL2 canvas, found ${matches.length}`)
  }
  return matches[0]!
}

export class CrtPostprocessor implements IDisposable {
  private readonly background: readonly [number, number, number]
  private readonly brightPassThreshold: number
  private readonly previousCanvasBackground: string
  private readonly observer: ObserverLike
  private readonly renderSubscription: IDisposable
  private resources: GlResources | undefined
  private width = 0
  private height = 0
  private generation = 1
  private suspended = false
  private disposed = false
  private rendering = false
  private failureReported = false
  private emergencyHandoffLatched = false

  private readonly handleContextLost = () => {
    if (this.disposed) return
    this.suspended = true
    this.generation += 1
    this.resources = undefined
  }

  private readonly handleContextRestored = () => {
    if (this.disposed || !this.suspended) return
    this.suspended = false
    try {
      this.resources = createResources(this.gl, this.canvas, this.generation)
      this.width = this.canvas.width
      this.height = this.canvas.height
      clearRenderSurfaces(this.gl, this.resources.framebuffer, this.background)
      this.gl.bindFramebuffer(this.gl.DRAW_FRAMEBUFFER, this.resources.framebuffer)
    } catch {
      this.reportRuntimeFailure(false)
    }
  }

  constructor(private readonly options: CrtPostprocessorOptions) {
    const { terminal, canvas, gl, themeColor, createObserver } = options
    this.canvas = canvas
    this.gl = gl
    this.background = normalizeRgb(parseHexRgb(themeColor))
    this.brightPassThreshold = crtBrightPassThreshold(this.background)
    this.previousCanvasBackground = canvas.style.backgroundColor

    let resources: GlResources | undefined
    let observer: ObserverLike | undefined
    let renderSubscription: IDisposable | undefined
    try {
      canvas.style.backgroundColor = themeColor
      resources = createResources(gl, canvas, this.generation)
      this.resources = resources
      this.width = canvas.width
      this.height = canvas.height
      clearRenderSurfaces(gl, resources.framebuffer, this.background)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resources.framebuffer)

      observer = (createObserver ?? ((callback) => new MutationObserver(callback)))(() => {
        this.handleDrawableResize()
      })
      observer.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] })
      canvas.addEventListener('webglcontextlost', this.handleContextLost)
      canvas.addEventListener('webglcontextrestored', this.handleContextRestored)
      renderSubscription = terminal.onRender(() => this.present())
    } catch (error) {
      bestEffort(() => renderSubscription?.dispose())
      bestEffort(() => observer?.disconnect())
      bestEffort(() => canvas.removeEventListener('webglcontextlost', this.handleContextLost))
      bestEffort(() =>
        canvas.removeEventListener('webglcontextrestored', this.handleContextRestored),
      )
      bestEffort(() => {
        canvas.style.backgroundColor = this.previousCanvasBackground
      })
      deleteResources(gl, resources)
      bestEffort(() => gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null))
      throw error
    }

    this.observer = observer
    this.renderSubscription = renderSubscription
  }

  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGL2RenderingContext

  private handleDrawableResize() {
    if (
      this.disposed ||
      this.suspended ||
      (this.canvas.width === this.width && this.canvas.height === this.height)
    ) {
      return
    }
    const resources = this.resources
    if (!resources) return

    let state: SharedGlState | undefined
    let failed = false
    try {
      state = saveSharedState(this.gl)
      allocateTarget(this.gl, this.canvas, resources.texture, resources.framebuffer)
      this.width = this.canvas.width
      this.height = this.canvas.height
      clearRenderSurfaces(this.gl, resources.framebuffer, this.background)
    } catch {
      failed = true
    } finally {
      if (state) {
        try {
          restoreSharedState(this.gl, state)
        } catch {
          failed = true
        }
      }
      if (!failed && !this.disposed && !this.failureReported) {
        try {
          this.gl.bindFramebuffer(this.gl.DRAW_FRAMEBUFFER, resources.framebuffer)
        } catch {
          failed = true
        }
      }
    }
    if (failed) this.reportRuntimeFailure(false)
  }

  private present() {
    if (this.disposed || this.failureReported || this.suspended || this.rendering) return
    try {
      this.presentValidated()
    } catch {
      this.rendering = false
      this.reportRuntimeFailure(false)
    }
  }

  /** Leaves the current composed CRT frame on its canvas before renderer replacement. */
  presentForHandoff() {
    this.present()
  }

  private presentValidated() {
    const resources = this.resources
    const gl = this.gl
    if (!resources || resources.generation !== this.generation || gl.isContextLost()) {
      this.reportRuntimeFailure(false)
      return
    }

    const drawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    if (drawFramebuffer !== resources.framebuffer) {
      this.reportRuntimeFailure(drawFramebuffer === null)
      return
    }
    if (
      this.canvas.width !== this.width ||
      this.canvas.height !== this.height ||
      gl.drawingBufferWidth !== this.width ||
      gl.drawingBufferHeight !== this.height ||
      !Number.isFinite(this.canvas.clientWidth) ||
      !Number.isFinite(this.canvas.clientHeight) ||
      this.canvas.clientWidth <= 0 ||
      this.canvas.clientHeight <= 0
    ) {
      this.reportRuntimeFailure(false)
      return
    }
    if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      this.reportRuntimeFailure(false)
      return
    }

    this.rendering = true
    let state: SharedGlState | undefined
    let failed = false
    try {
      state = saveSharedState(gl)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      gl.viewport(0, 0, this.width, this.height)
      gl.disable(gl.BLEND)
      gl.useProgram(resources.program)
      gl.bindVertexArray(resources.vertexArray)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, resources.texture)
      gl.uniform1i(resources.terminalLocation, 0)
      gl.uniform2f(resources.drawableSizeLocation, this.width, this.height)
      gl.uniform3f(resources.backgroundLocation, ...this.background)
      gl.uniform1f(resources.brightPassThresholdLocation, this.brightPassThreshold)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    } catch {
      failed = true
    } finally {
      if (state) {
        try {
          restoreSharedState(gl, state)
        } catch {
          failed = true
        }
      }
      try {
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resources.framebuffer)
      } catch {
        failed = true
      }
      this.rendering = false
    }
    if (failed) this.reportRuntimeFailure(false)
  }

  private reportRuntimeFailure(rawFrameAlreadyInDefault: boolean) {
    if (this.disposed || this.failureReported) return
    this.failureReported = true
    this.options.onRuntimeFailure({
      emergencyHandoff: () => this.emergencyHandoff(rawFrameAlreadyInDefault),
    })
  }

  private emergencyHandoff(rawFrameAlreadyInDefault: boolean) {
    if (this.emergencyHandoffLatched) return
    this.emergencyHandoffLatched = true
    const resources = this.resources
    const gl = this.gl
    try {
      if (
        rawFrameAlreadyInDefault ||
        !resources ||
        this.suspended ||
        gl.isContextLost() ||
        this.canvas.width !== this.width ||
        this.canvas.height !== this.height ||
        gl.drawingBufferWidth !== this.width ||
        gl.drawingBufferHeight !== this.height
      ) {
        return
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, resources.framebuffer)
      if (gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      gl.blitFramebuffer(
        0,
        0,
        this.width,
        this.height,
        0,
        0,
        this.width,
        this.height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      )
    } catch {
      // The default renderer is still the terminal fallback when handoff itself fails.
    } finally {
      try {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      } catch {
        // A lost context has no recoverable shared state to unbind.
      }
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    bestEffort(() => this.renderSubscription.dispose())
    bestEffort(() => this.observer.disconnect())
    bestEffort(() => this.canvas.removeEventListener('webglcontextlost', this.handleContextLost))
    bestEffort(() =>
      this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored),
    )
    bestEffort(() => {
      if (!this.gl.isContextLost()) deleteResources(this.gl, this.resources)
    })
    bestEffort(() => {
      this.canvas.style.backgroundColor = this.previousCanvasBackground
    })
    this.resources = undefined
  }
}
