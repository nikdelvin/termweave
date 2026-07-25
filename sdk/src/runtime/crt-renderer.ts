import { WebglAddon } from '@xterm/addon-webgl'
import { type IDisposable, type Terminal } from '@xterm/xterm'
import {
  CRT_EFFECT_DEFAULTS,
  CRT_EFFECTS_ENABLED,
  TERMINAL_GRID,
} from '../../shared/terminal-config'
import { diagnostic } from '../diagnostics'

interface ChromaticAberrationRenderer {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  texture: WebGLTexture
  vertexArray: WebGLVertexArrayObject
  resolutionLocation: WebGLUniformLocation
  shiftLocation: WebGLUniformLocation
}

interface CrtRendererOptions {
  aberrationCanvas: HTMLCanvasElement
  aberrationHost: HTMLElement
  effectsHost: HTMLElement
  onRendererChanged: () => void
  terminal: Terminal
  terminalHost: HTMLElement
}

export function createCrtRenderer(options: CrtRendererOptions) {
  const {
    aberrationCanvas,
    aberrationHost,
    effectsHost,
    onRendererChanged,
    terminal,
    terminalHost,
  } = options
  let aberrationCaptureFailed = false
  let aberrationFrame: number | undefined
  let chromaticRenderer: ChromaticAberrationRenderer | undefined
  let contextLossSubscription: IDisposable | undefined
  let lastAberrationSource: HTMLCanvasElement | undefined
  let webglAddon: WebglAddon | undefined

  const noisePeakOpacity = CRT_EFFECT_DEFAULTS.noiseVisibility * 0.1
  const flickerAmplitude = CRT_EFFECT_DEFAULTS.flickerVisibility * 0.1
  const sweepPeakOpacity = CRT_EFFECT_DEFAULTS.sweepLineVisibility * 0.1
  const styleVariables = {
    '--crt-processed-frame-opacity': CRT_EFFECT_DEFAULTS.processedFrameOpacity,
    '--crt-noise-opacity-low': noisePeakOpacity * (46 / 62),
    '--crt-noise-opacity-high': noisePeakOpacity * (58 / 62),
    '--crt-noise-opacity-medium': noisePeakOpacity * (50 / 62),
    '--crt-noise-opacity-peak': noisePeakOpacity,
    '--crt-scanlines-opacity': CRT_EFFECT_DEFAULTS.scanlinesVisibility,
    '--crt-flicker-low-opacity': Math.max(
      0,
      CRT_EFFECT_DEFAULTS.scanlinesVisibility - flickerAmplitude,
    ),
    '--crt-flicker-high-opacity': Math.min(
      1,
      CRT_EFFECT_DEFAULTS.scanlinesVisibility + flickerAmplitude * 0.6,
    ),
    '--crt-sweep-soft-opacity': sweepPeakOpacity * (25 / 70),
    '--crt-sweep-peak-opacity': sweepPeakOpacity,
    '--crt-sweep-trailing-opacity': sweepPeakOpacity * (20 / 70),
  } as const

  effectsHost.hidden = !CRT_EFFECTS_ENABLED
  if (CRT_EFFECTS_ENABLED) {
    for (const [property, value] of Object.entries(styleVariables)) {
      effectsHost.style.setProperty(property, String(value))
    }
  }

  const terminalWebglCanvas = () => {
    const screen = terminalHost.querySelector<HTMLElement>('.xterm-screen')
    if (!screen) return undefined
    return Array.from(screen.children).find(
      (element): element is HTMLCanvasElement =>
        element instanceof HTMLCanvasElement && element.classList.length === 0,
    )
  }

  const compileShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('Unable to create CRT shader')

    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      throw new Error(`Unable to compile CRT shader: ${log ?? 'unknown error'}`)
    }
    return shader
  }

  const createChromaticRenderer = (): ChromaticAberrationRenderer => {
    const gl = aberrationCanvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
    })
    if (!gl) throw new Error('Unable to create CRT WebGL2 renderer')

    const vertexShader = compileShader(
      gl,
      gl.VERTEX_SHADER,
      `#version 300 es
        in vec2 a_position;
        out vec2 v_uv;

        void main() {
          v_uv = a_position * 0.5 + 0.5;
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `,
    )
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      `#version 300 es
        precision highp float;

        uniform sampler2D u_texture;
        uniform vec2 u_resolution;
        uniform vec2 u_max_shift;
        in vec2 v_uv;
        out vec4 out_color;

        void main() {
          vec2 centered = v_uv * 2.0 - 1.0;
          float distance_from_center = length(centered) / 1.41421356237;
          float edge_strength = smoothstep(0.16, 1.0, distance_from_center);
          vec2 direction = centered / max(length(centered), 0.0001);
          vec2 offset = direction * u_max_shift * edge_strength / u_resolution;
          vec4 base = texture(u_texture, v_uv);
          float red = texture(u_texture, clamp(v_uv + offset, 0.0, 1.0)).r;
          float blue = texture(u_texture, clamp(v_uv - offset, 0.0, 1.0)).b;
          out_color = vec4(red, base.g, blue, base.a);
        }
      `,
    )
    const program = gl.createProgram()
    if (!program) throw new Error('Unable to create CRT shader program')

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Unable to link CRT shader program: ${gl.getProgramInfoLog(program)}`)
    }

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    const shiftLocation = gl.getUniformLocation(program, 'u_max_shift')
    const textureLocation = gl.getUniformLocation(program, 'u_texture')
    const vertexArray = gl.createVertexArray()
    const positionBuffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (
      positionLocation < 0 ||
      !resolutionLocation ||
      !shiftLocation ||
      !textureLocation ||
      !vertexArray ||
      !positionBuffer ||
      !texture
    ) {
      throw new Error('Unable to initialize CRT shader resources')
    }

    gl.bindVertexArray(vertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.useProgram(program)
    gl.uniform1i(textureLocation, 0)

    return { gl, program, texture, vertexArray, resolutionLocation, shiftLocation }
  }

  const renderAberration = () => {
    const source = terminalWebglCanvas()
    if (!source || source.width === 0 || source.height === 0) {
      aberrationHost.hidden = true
      lastAberrationSource = undefined
      return
    }

    try {
      const renderer = (chromaticRenderer ??= createChromaticRenderer())
      const { gl } = renderer
      if (aberrationCanvas.width !== source.width) aberrationCanvas.width = source.width
      if (aberrationCanvas.height !== source.height) aberrationCanvas.height = source.height

      gl.viewport(0, 0, aberrationCanvas.width, aberrationCanvas.height)
      gl.useProgram(renderer.program)
      gl.bindVertexArray(renderer.vertexArray)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, renderer.texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      gl.uniform2f(renderer.resolutionLocation, source.width, source.height)
      gl.uniform2f(
        renderer.shiftLocation,
        CRT_EFFECT_DEFAULTS.chromaticAberrationShift * (source.width / TERMINAL_GRID.targetWidth),
        CRT_EFFECT_DEFAULTS.chromaticAberrationShift * (source.height / TERMINAL_GRID.targetHeight),
      )
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      aberrationHost.hidden = false
      aberrationCaptureFailed = false

      if (source !== lastAberrationSource) {
        lastAberrationSource = source
        diagnostic('crt', 'WebGL chromatic aberration connected', {
          source: `${source.width}x${source.height}`,
          effect: `${aberrationCanvas.width}x${aberrationCanvas.height}`,
          maximumShift: CRT_EFFECT_DEFAULTS.chromaticAberrationShift,
        })
      }
    } catch (error) {
      aberrationHost.hidden = true
      if (!aberrationCaptureFailed) {
        aberrationCaptureFailed = true
        diagnostic('crt', 'WebGL chromatic aberration render failed', error, 'warn')
      }
    }
  }

  const scheduleAberration = () => {
    if (aberrationFrame !== undefined) return
    aberrationFrame = requestAnimationFrame(() => {
      aberrationFrame = undefined
      renderAberration()
    })
  }

  const clearAberration = () => {
    if (aberrationFrame !== undefined) cancelAnimationFrame(aberrationFrame)
    aberrationFrame = undefined
    lastAberrationSource = undefined
    aberrationHost.hidden = true
    const gl = chromaticRenderer?.gl
    if (gl) {
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
  }

  const disposeWebgl = (reason: string) => {
    const addon = webglAddon
    const subscription = contextLossSubscription
    webglAddon = undefined
    contextLossSubscription = undefined
    clearAberration()

    try {
      subscription?.dispose()
    } catch (error) {
      diagnostic(
        'xterm.webgl',
        'failed to dispose WebGL context-loss subscription',
        { reason, error },
        'warn',
      )
    }
    if (!addon) return

    try {
      addon.dispose()
      diagnostic('xterm.webgl', 'WebGL addon disposed; DOM renderer active', { reason })
    } catch (error) {
      diagnostic('xterm.webgl', 'failed to dispose WebGL addon safely', { reason, error }, 'warn')
    }
    onRendererChanged()
  }

  const aberrationRenderSubscription = CRT_EFFECTS_ENABLED
    ? terminal.onRender(scheduleAberration)
    : undefined

  return {
    clearAberration,

    dispose(reason: string) {
      aberrationRenderSubscription?.dispose()
      disposeWebgl(reason)
    },

    enable() {
      let addon: WebglAddon | undefined
      try {
        addon = new WebglAddon(true)
        webglAddon = addon
        contextLossSubscription = addon.onContextLoss(() => {
          diagnostic(
            'xterm.webgl',
            'WebGL context lost; falling back to DOM renderer',
            undefined,
            'warn',
          )
          disposeWebgl('context loss')
        })
        terminal.loadAddon(addon)
        onRendererChanged()
        if (CRT_EFFECTS_ENABLED) scheduleAberration()
        diagnostic('xterm.webgl', 'WebGL renderer enabled', {
          customGlyphs: terminal.options.customGlyphs,
          preserveDrawingBuffer: true,
        })
      } catch (error) {
        diagnostic(
          'xterm.webgl',
          'WebGL renderer initialization failed; continuing with DOM renderer',
          error,
          'warn',
        )
        if (webglAddon === addon) disposeWebgl('initialization failure')
      }
    },

    rendererName() {
      return webglAddon === undefined ? 'dom' : 'webgl'
    },
  }
}
