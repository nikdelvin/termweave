import { diagnostic } from './diagnostics'
import { WebglAddon } from '@xterm/addon-webgl'
import { type IDisposable, Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { invoke } from '@tauri-apps/api/core'
import { type Child, Command } from '@tauri-apps/plugin-shell'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  CRT_EFFECTS,
  FOREGROUND_COLOR,
  MONITOR_OVERLAY_ENABLED,
  SHOW_DIAGNOSTICS,
  SIDECAR_PROTOCOL,
  TERMINAL_GRID,
  THEME_COLOR,
  type SidecarAuthenticate,
  type SidecarAuthenticated,
  type SidecarExitRequested,
  type SidecarShutdown,
} from '../shared/terminal-config'
import { decodeTerminalFrame, type SidecarFrameAcknowledgement } from '../shared/terminal-protocol'
import './styles.css'

const {
  cols: COLS,
  rows: ROWS,
  targetWidth: TERMINAL_WIDTH,
  targetHeight: TERMINAL_HEIGHT,
  fontSize: TERMINAL_FONT_SIZE,
} = TERMINAL_GRID
const FONT_FAMILY = '"Kreative Square"'
const FONT_MEASUREMENT_SIZE = 100
const MONITOR_BEZEL_SEPIA_HUE_DEGREES = 37.5
const MIN_HORIZONTAL_BEZEL_PX = MONITOR_OVERLAY_ENABLED ? 64 : 0
const MIN_VERTICAL_BEZEL_PX = MONITOR_OVERLAY_ENABLED ? 64 : 0
const MONITOR_OVERLAY = {
  width: 3_000,
  height: 1_740,
  aperture: {
    left: 268,
    top: 201,
    width: 2_453,
    height: 1_380,
  },
} as const
const monitorScaleX = TERMINAL_WIDTH / MONITOR_OVERLAY.aperture.width
const monitorScaleY = TERMINAL_HEIGHT / MONITOR_OVERLAY.aperture.height
const MONITOR_LAYOUT = {
  width: MONITOR_OVERLAY.width * monitorScaleX,
  height: MONITOR_OVERLAY.height * monitorScaleY,
  screenLeft: MONITOR_OVERLAY.aperture.left * monitorScaleX,
  screenTop: MONITOR_OVERLAY.aperture.top * monitorScaleY,
  screenWidth: TERMINAL_WIDTH,
  screenHeight: TERMINAL_HEIGHT,
  screenCenterX: MONITOR_OVERLAY.aperture.left * monitorScaleX + TERMINAL_WIDTH / 2,
  screenCenterY: MONITOR_OVERLAY.aperture.top * monitorScaleY + TERMINAL_HEIGHT / 2,
} as const
const HANDSHAKE_TIMEOUT_MS = 2_000
const CONNECTION_RETRY_DELAY_MS = 100
const STARTUP_CONNECTION_ATTEMPTS = 300
const RECOVERY_RECONNECT_ATTEMPTS = import.meta.env.DEV ? 100 : 20
const RECOVERY_CYCLE_RETRY_DELAY_MS = 2_000
const SIDECAR_SHUTDOWN_TIMEOUT_MS = 750
const appWebview = getCurrentWebview()
const appWindow = getCurrentWindow()

type BackendDiagnostics = {
  debugBuild: boolean
  os: string
  arch: string
  executable: string
  currentDirectory: string
  instanceId: string
  sidecarToken: string
  sidecarPort: number
}

type SidecarDiagnosticMessage = {
  type: 'diagnostic'
  line: string
}

type SidecarTextMessage = SidecarDiagnosticMessage | SidecarExitRequested

type ReceivedSidecarHello = {
  type: 'hello'
  protocol: string
  version: number
  instanceId: string
  port: number
}

class SidecarIdentityError extends Error {
  override name = 'SidecarIdentityError'
}

diagnostic('frontend', 'main module evaluating', {
  grid: `${COLS}x${ROWS}`,
  sidecarProtocol: SIDECAR_PROTOCOL,
  fontFamily: FONT_FAMILY,
  monitorOverlay: MONITOR_OVERLAY_ENABLED,
  windowLabel: appWindow.label,
  webviewLabel: appWebview.label,
})

function getRequiredElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector} element`)
  diagnostic('dom', 'required element found', { selector, tag: element.tagName })
  return element
}

function monitorBezelFilter(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255
  const green = Number.parseInt(color.slice(3, 5), 16) / 255
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum
  const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722
  const saturation = maximum === 0 ? 0 : delta / maximum
  let hueRotation = 0

  if (delta > 0) {
    let hue: number
    if (maximum === red) hue = ((green - blue) / delta) % 6
    else if (maximum === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4

    const targetHue = (((hue * 60) % 360) + 360) % 360
    hueRotation = (targetHue - MONITOR_BEZEL_SEPIA_HUE_DEGREES + 360) % 360
  }

  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    brightness: round(0.27 + luma * 1.6),
    contrast: round(1 + (1 - luma) * 0.1),
    hueRotation: round(hueRotation),
    saturation: round(1 + saturation * 0.1),
    sepia: round(saturation),
  }
}

const appHost = getRequiredElement<HTMLElement>('#app')
const displayStage = getRequiredElement<HTMLDivElement>('#display-stage')
const monitorArtboard = getRequiredElement<HTMLDivElement>('#monitor-artboard')
const monitorSurround = getRequiredElement<HTMLDivElement>('#monitor-surround')
const monitorOverlay = getRequiredElement<HTMLDivElement>('#monitor-overlay')
const terminalHost = getRequiredElement<HTMLDivElement>('#terminal')
const crtEffectsHost = getRequiredElement<HTMLDivElement>('#crt-effects')
const crtAberrationHost = getRequiredElement<HTMLDivElement>('#crt-aberration')
const crtAberrationCanvas = getRequiredElement<HTMLCanvasElement>('#crt-aberration-canvas')

const noisePeakOpacity = CRT_EFFECTS.noiseVisibility * 0.1
const flickerAmplitude = CRT_EFFECTS.flickerVisibility * 0.1
const sweepPeakOpacity = CRT_EFFECTS.sweepLineVisibility * 0.1
const crtStyleVariables = {
  '--crt-processed-frame-opacity': CRT_EFFECTS.processedFrameOpacity,
  '--crt-noise-opacity-low': noisePeakOpacity * (46 / 62),
  '--crt-noise-opacity-high': noisePeakOpacity * (58 / 62),
  '--crt-noise-opacity-medium': noisePeakOpacity * (50 / 62),
  '--crt-noise-opacity-peak': noisePeakOpacity,
  '--crt-scanlines-opacity': CRT_EFFECTS.scanlinesVisibility,
  '--crt-flicker-low-opacity': Math.max(0, CRT_EFFECTS.scanlinesVisibility - flickerAmplitude),
  '--crt-flicker-high-opacity': Math.min(
    1,
    CRT_EFFECTS.scanlinesVisibility + flickerAmplitude * 0.6,
  ),
  '--crt-sweep-soft-opacity': sweepPeakOpacity * (25 / 70),
  '--crt-sweep-peak-opacity': sweepPeakOpacity,
  '--crt-sweep-trailing-opacity': sweepPeakOpacity * (20 / 70),
} as const

for (const [property, value] of Object.entries(crtStyleVariables)) {
  crtEffectsHost.style.setProperty(property, String(value))
}

monitorSurround.hidden = !MONITOR_OVERLAY_ENABLED
monitorOverlay.hidden = !MONITOR_OVERLAY_ENABLED

const monitorBezelStyle = monitorBezelFilter(THEME_COLOR)
monitorArtboard.style.setProperty(
  '--monitor-bezel-brightness',
  String(monitorBezelStyle.brightness),
)
monitorArtboard.style.setProperty('--monitor-bezel-contrast', String(monitorBezelStyle.contrast))
monitorArtboard.style.setProperty('--monitor-bezel-sepia', String(monitorBezelStyle.sepia))
monitorArtboard.style.setProperty(
  '--monitor-bezel-saturation',
  String(monitorBezelStyle.saturation),
)
monitorArtboard.style.setProperty('--monitor-bezel-hue', `${monitorBezelStyle.hueRotation}deg`)
monitorArtboard.style.setProperty('--monitor-width', `${MONITOR_LAYOUT.width}px`)
monitorArtboard.style.setProperty('--monitor-height', `${MONITOR_LAYOUT.height}px`)
monitorArtboard.style.setProperty('--monitor-artboard-left', `${-MONITOR_LAYOUT.screenCenterX}px`)
monitorArtboard.style.setProperty('--monitor-artboard-top', `${-MONITOR_LAYOUT.screenCenterY}px`)
monitorArtboard.style.setProperty('--monitor-screen-left', `${MONITOR_LAYOUT.screenLeft}px`)
monitorArtboard.style.setProperty('--monitor-screen-top', `${MONITOR_LAYOUT.screenTop}px`)
monitorArtboard.style.setProperty('--monitor-screen-width', `${MONITOR_LAYOUT.screenWidth}px`)
monitorArtboard.style.setProperty('--monitor-screen-height', `${MONITOR_LAYOUT.screenHeight}px`)

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to measure terminal font')
  return context
}

const metricsCanvas = document.createElement('canvas')
const metricsContext = getCanvasContext(metricsCanvas)
let socketAttempt = 0

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sidecarSocketUrl(runtime: BackendDiagnostics) {
  return `ws://127.0.0.1:${runtime.sidecarPort}/terminal`
}

function getSidecarHello(data: unknown): ReceivedSidecarHello | undefined {
  if (typeof data !== 'string') return undefined

  try {
    const message = JSON.parse(data) as Record<string, unknown>
    if (
      message.type === 'hello' &&
      typeof message.protocol === 'string' &&
      typeof message.version === 'number' &&
      typeof message.instanceId === 'string' &&
      typeof message.port === 'number'
    ) {
      return {
        type: 'hello',
        protocol: message.protocol,
        version: message.version,
        instanceId: message.instanceId,
        port: message.port,
      }
    }
  } catch {
    // The first frame must be a valid identity handshake.
  }

  return undefined
}

function getSidecarAuthenticated(data: unknown): SidecarAuthenticated | undefined {
  if (typeof data !== 'string') return undefined

  try {
    const message = JSON.parse(data) as Record<string, unknown>
    if (message.type === 'authenticated') return { type: 'authenticated' }
  } catch {
    // Authentication acknowledgements must be valid JSON.
  }

  return undefined
}

function openSocket(url: string, attempt: number, runtime: BackendDiagnostics) {
  return new Promise<WebSocket>((resolve, reject) => {
    const attemptStartedAt = performance.now()
    let settled = false
    let accepted = false
    let identityAccepted = false
    let handshakeTimer: number | undefined
    diagnostic('websocket', 'connection attempt started', { attempt, url })

    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'

    const rejectConnection = (error: Error, closeSocket: boolean) => {
      if (settled) return
      settled = true
      if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer)
      socket.removeEventListener('message', handleHandshake)

      if (closeSocket && socket.readyState < WebSocket.CLOSING) {
        try {
          socket.close(1008, 'Sidecar authentication failed')
        } catch (closeError) {
          diagnostic('websocket', 'failed to close rejected connection', closeError, 'warn')
        }
      }

      reject(error)
    }

    const handleHandshake = (event: MessageEvent) => {
      if (identityAccepted) {
        const authenticated = getSidecarAuthenticated(event.data)
        if (!authenticated) {
          diagnostic(
            'websocket',
            'sidecar sent data before client authentication completed',
            {
              attempt,
              dataType: event.data?.constructor?.name ?? typeof event.data,
            },
            'error',
          )
          rejectConnection(
            new SidecarIdentityError('Sidecar client authentication was not acknowledged'),
            true,
          )
          return
        }

        accepted = true
        settled = true
        if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer)
        socket.removeEventListener('message', handleHandshake)
        socket.addEventListener('message', handleSocketMessage)
        diagnostic('websocket', 'mutual sidecar authentication completed', {
          attempt,
          elapsedMs: performance.now() - attemptStartedAt,
        })
        resolve(socket)
        return
      }

      const hello = getSidecarHello(event.data)
      if (!hello) {
        diagnostic(
          'websocket',
          'sidecar sent data before identity handshake',
          {
            attempt,
            dataType: event.data?.constructor?.name ?? typeof event.data,
          },
          'error',
        )
        rejectConnection(new SidecarIdentityError('Sidecar identity handshake was missing'), true)
        return
      }

      const matches =
        hello.protocol === SIDECAR_PROTOCOL.name &&
        hello.version === SIDECAR_PROTOCOL.version &&
        hello.instanceId === runtime.instanceId &&
        hello.port === runtime.sidecarPort

      if (!matches) {
        diagnostic(
          'websocket',
          'sidecar identity rejected',
          {
            attempt,
            expectedProtocol: SIDECAR_PROTOCOL,
            receivedProtocol: {
              name: hello.protocol,
              version: hello.version,
            },
            expectedPort: runtime.sidecarPort,
            receivedPort: hello.port,
            instanceMatches: hello.instanceId === runtime.instanceId,
          },
          'error',
        )
        rejectConnection(
          new SidecarIdentityError('Sidecar identity did not match this app instance'),
          true,
        )
        return
      }

      identityAccepted = true
      const authentication: SidecarAuthenticate = {
        type: 'authenticate',
        token: runtime.sidecarToken,
      }
      socket.send(JSON.stringify(authentication))
      diagnostic('websocket', 'sidecar identity accepted; client authentication sent', {
        attempt,
        protocol: hello.protocol,
        version: hello.version,
        port: hello.port,
        elapsedMs: performance.now() - attemptStartedAt,
      })
    }

    socket.addEventListener('message', handleHandshake)
    socket.onopen = () => {
      diagnostic('websocket', 'transport opened; awaiting identity', {
        attempt,
        elapsedMs: performance.now() - attemptStartedAt,
        protocol: socket.protocol,
        extensions: socket.extensions,
      })
    }
    socket.onerror = () => {
      diagnostic(
        'websocket',
        'connection error',
        {
          attempt,
          elapsedMs: performance.now() - attemptStartedAt,
          readyState: socket.readyState,
        },
        'error',
      )
      if (!accepted) rejectConnection(new Error(`WebSocket attempt ${attempt} failed`), true)
    }
    socket.onclose = (event) => {
      diagnostic(
        'websocket',
        'connection closed',
        {
          attempt,
          elapsedMs: performance.now() - attemptStartedAt,
          code: event.code,
          reason: event.reason,
          clean: event.wasClean,
        },
        event.wasClean ? 'info' : 'warn',
      )
      if (!accepted) {
        rejectConnection(
          new Error(`WebSocket attempt ${attempt} closed before authentication completed`),
          false,
        )
      }
    }

    handshakeTimer = window.setTimeout(() => {
      diagnostic(
        'websocket',
        'sidecar authentication handshake timed out',
        {
          attempt,
          timeoutMs: HANDSHAKE_TIMEOUT_MS,
        },
        'error',
      )
      rejectConnection(new SidecarIdentityError('Sidecar authentication handshake timed out'), true)
    }, HANDSHAKE_TIMEOUT_MS)
  })
}

async function connectWithRetry(runtime: BackendDiagnostics, maxAttempts: number, purpose: string) {
  const url = sidecarSocketUrl(runtime)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    socketAttempt += 1
    try {
      return await openSocket(url, socketAttempt, runtime)
    } catch (error) {
      if (error instanceof SidecarIdentityError) {
        diagnostic(
          'websocket',
          'connection rejected without retry',
          {
            attempt: socketAttempt,
            purpose,
            error,
          },
          'error',
        )
        throw error
      }

      diagnostic(
        'websocket',
        'attempt will retry',
        {
          attempt: socketAttempt,
          purpose,
          remaining: maxAttempts - attempt,
          error,
        },
        'warn',
      )
      if (attempt < maxAttempts) await delay(CONNECTION_RETRY_DELAY_MS)
    }
  }

  throw new Error(`OpenTUI sidecar connection failed during ${purpose}`)
}

const terminal = new Terminal({
  cols: COLS,
  rows: ROWS,
  scrollback: 0,
  cursorBlink: false,
  convertEol: false,
  customGlyphs: true,
  fontFamily: FONT_FAMILY,
  fontSize: TERMINAL_FONT_SIZE,
  letterSpacing: 0,
  lineHeight: 1,
  theme: {
    background: THEME_COLOR,
    foreground: FOREGROUND_COLOR,
    cursor: FOREGROUND_COLOR,
  },
})

diagnostic('xterm', 'Terminal instance created', {
  cols: terminal.cols,
  rows: terminal.rows,
})

let socketMessageCount = 0
let socketBytesReceived = 0
let xtermRenderCount = 0
let xtermParseCount = 0
let lastFitSignature = ''
const loadingFrames = ['|', '/', '-', '\\'] as const
const loadingLabel = 'Loading...'
const loadingTextWidth = `${loadingFrames[0]} ${loadingLabel}`.length
const loadingRow = Math.floor(ROWS / 2) + 1
const loadingColumn = Math.max(1, Math.floor((COLS - loadingTextWidth) / 2) + 1)
let loadingFrame = 0
let loadingTimer: number | undefined

function renderLoadingIndicator(onParsed?: () => void) {
  const frame = loadingFrames[loadingFrame % loadingFrames.length]
  loadingFrame += 1
  terminal.write(
    `\x1b[?25l\x1b[${loadingRow};${loadingColumn}H${frame} ${loadingLabel}\x1b[H`,
    onParsed,
  )
}

function startLoadingIndicator() {
  if (loadingTimer !== undefined) return Promise.resolve()

  loadingTimer = window.setInterval(renderLoadingIndicator, 120)
  diagnostic('xterm', 'loading indicator started', {
    row: loadingRow,
    column: loadingColumn,
  })

  return new Promise<void>((resolve) => renderLoadingIndicator(resolve))
}

function stopLoadingIndicator() {
  if (loadingTimer === undefined) return

  window.clearInterval(loadingTimer)
  loadingTimer = undefined
  terminal.write(`\x1b[${loadingRow};${loadingColumn}H${' '.repeat(loadingTextWidth)}\x1b[H`)
  diagnostic('xterm', 'loading indicator stopped')
}

if (SHOW_DIAGNOSTICS) {
  terminal.onRender(({ start, end }) => {
    xtermRenderCount += 1
    diagnostic('xterm', 'render event', {
      count: xtermRenderCount,
      startRow: start,
      endRow: end,
    })
  })

  terminal.onWriteParsed(() => {
    xtermParseCount += 1
    diagnostic('xterm', 'write parsed', { count: xtermParseCount })
  })

  terminal.onResize(({ cols, rows }) => {
    diagnostic('xterm', 'terminal resized', { cols, rows })
  })
}

function terminalSnapshot() {
  const buffer = terminal.buffer.active
  const nonEmptyLines: string[] = []

  for (let row = 0; row < Math.min(buffer.length, 12); row += 1) {
    const text = buffer.getLine(row)?.translateToString(true).trimEnd()
    if (text) nonEmptyLines.push(`${row}: ${text}`)
  }

  return {
    bufferType: terminal.buffer.active.type,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    baseY: buffer.baseY,
    viewportY: buffer.viewportY,
    lines: nonEmptyLines,
  }
}

function getSidecarTextMessage(data: string): SidecarTextMessage | undefined {
  try {
    const message = JSON.parse(data) as Record<string, unknown>
    if (message.type === 'diagnostic' && typeof message.line === 'string') {
      return { type: 'diagnostic', line: message.line }
    }

    if (message.type === 'exit-requested') return { type: 'exit-requested' }
  } catch {
    // Non-JSON text remains valid terminal output.
  }

  return undefined
}

function handleSocketMessage(event: MessageEvent) {
  const sourceSocket = event.currentTarget instanceof WebSocket ? event.currentTarget : undefined

  if (typeof event.data === 'string') {
    const message = getSidecarTextMessage(event.data)
    if (message?.type === 'diagnostic') {
      diagnostic('sidecar.ws', message.line)
      return
    }

    if (message?.type === 'exit-requested') {
      void closeWindowForSidecarExit()
      return
    }

    diagnostic('websocket', 'unexpected text message ignored', { data: event.data }, 'warn')
    return
  }

  if (!(event.data instanceof ArrayBuffer)) {
    diagnostic(
      'websocket',
      'unexpected terminal frame payload ignored',
      { dataType: event.data?.constructor?.name ?? typeof event.data },
      'error',
    )
    sourceSocket?.close(1002, 'Unexpected terminal frame payload')
    return
  }

  const frame = decodeTerminalFrame(event.data)
  if (!frame) {
    diagnostic(
      'websocket',
      'invalid terminal frame ignored',
      { bytes: event.data.byteLength },
      'error',
    )
    sourceSocket?.close(1002, 'Invalid terminal frame')
    return
  }

  stopLoadingIndicator()

  const acknowledgeFrame = () => {
    if (sourceSocket?.readyState !== WebSocket.OPEN) return

    const acknowledgement: SidecarFrameAcknowledgement = {
      type: 'frame-ack',
      frameId: frame.frameId,
    }
    sourceSocket.send(JSON.stringify(acknowledgement))
  }

  if (!SHOW_DIAGNOSTICS) {
    terminal.write(frame.data, acknowledgeFrame)
    return
  }

  const byteLength = frame.data.byteLength
  const messageNumber = ++socketMessageCount
  socketBytesReceived += byteLength
  diagnostic('websocket', 'message received', {
    message: messageNumber,
    frameId: frame.frameId,
    bytes: byteLength,
    totalBytes: socketBytesReceived,
    dataType: event.data?.constructor?.name ?? typeof event.data,
  })
  terminal.write(frame.data, () => {
    try {
      diagnostic('xterm', 'write callback completed', {
        message: messageNumber,
        frameId: frame.frameId,
        bytes: byteLength,
        snapshot: terminalSnapshot(),
      })
    } finally {
      acknowledgeFrame()
    }
  })
}

let socket: WebSocket | undefined
let child: Child | undefined
let recoveryPromise: Promise<void> | undefined
let recoveryTimer: number | undefined
let inputSubscription: { dispose(): void } | undefined
let resizeObserver: ResizeObserver | undefined
let resizeFrame: number | undefined
let focusFrame: number | undefined
let aberrationFrame: number | undefined
let unlistenWindowFocus: (() => void) | undefined
let unlistenWindowCloseRequested: (() => void) | undefined
let webglAddon: WebglAddon | undefined
let webglContextLossSubscription: IDisposable | undefined
let aberrationRenderSubscription: IDisposable | undefined
let lastAberrationSource: HTMLCanvasElement | undefined
let aberrationCaptureFailed = false
let terminalOpened = false
let disposed = false
let exitRequested = false
let cleanupPromise: Promise<void> | undefined
let windowClosePromise: Promise<void> | undefined

type ChromaticAberrationRenderer = {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  texture: WebGLTexture
  vertexArray: WebGLVertexArrayObject
  resolutionLocation: WebGLUniformLocation
  shiftLocation: WebGLUniformLocation
}

let chromaticAberrationRenderer: ChromaticAberrationRenderer | undefined

function getTerminalWebglCanvas() {
  const screen = terminalHost.querySelector<HTMLElement>('.xterm-screen')
  if (!screen) return undefined

  return Array.from(screen.children).find(
    (element): element is HTMLCanvasElement =>
      element instanceof HTMLCanvasElement && element.classList.length === 0,
  )
}

function compileCrtShader(gl: WebGL2RenderingContext, type: number, source: string) {
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

function createChromaticAberrationRenderer(): ChromaticAberrationRenderer {
  const gl = crtAberrationCanvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    premultipliedAlpha: false,
  })
  if (!gl) throw new Error('Unable to create CRT WebGL2 renderer')

  const vertexShader = compileCrtShader(
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
  const fragmentShader = compileCrtShader(
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

function renderChromaticAberration() {
  const source = getTerminalWebglCanvas()
  if (!source || source.width === 0 || source.height === 0) {
    crtAberrationHost.hidden = true
    lastAberrationSource = undefined
    return
  }

  try {
    const renderer = (chromaticAberrationRenderer ??= createChromaticAberrationRenderer())
    const { gl } = renderer
    if (crtAberrationCanvas.width !== source.width) crtAberrationCanvas.width = source.width
    if (crtAberrationCanvas.height !== source.height) crtAberrationCanvas.height = source.height

    gl.viewport(0, 0, crtAberrationCanvas.width, crtAberrationCanvas.height)
    gl.useProgram(renderer.program)
    gl.bindVertexArray(renderer.vertexArray)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, renderer.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.uniform2f(renderer.resolutionLocation, source.width, source.height)
    gl.uniform2f(
      renderer.shiftLocation,
      CRT_EFFECTS.chromaticAberrationShift * (source.width / TERMINAL_WIDTH),
      CRT_EFFECTS.chromaticAberrationShift * (source.height / TERMINAL_HEIGHT),
    )
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    crtAberrationHost.hidden = false
    aberrationCaptureFailed = false

    if (source !== lastAberrationSource) {
      lastAberrationSource = source
      diagnostic('crt', 'WebGL chromatic aberration connected', {
        source: `${source.width}x${source.height}`,
        effect: `${crtAberrationCanvas.width}x${crtAberrationCanvas.height}`,
        maximumShift: CRT_EFFECTS.chromaticAberrationShift,
      })
    }
  } catch (error) {
    crtAberrationHost.hidden = true
    if (!aberrationCaptureFailed) {
      aberrationCaptureFailed = true
      diagnostic('crt', 'WebGL chromatic aberration render failed', error, 'warn')
    }
  }
}

function scheduleChromaticAberration() {
  if (aberrationFrame !== undefined) return

  aberrationFrame = requestAnimationFrame(() => {
    aberrationFrame = undefined
    if (!disposed) renderChromaticAberration()
  })
}

function clearChromaticAberration() {
  if (aberrationFrame !== undefined) cancelAnimationFrame(aberrationFrame)
  aberrationFrame = undefined
  lastAberrationSource = undefined
  crtAberrationHost.hidden = true
  const gl = chromaticAberrationRenderer?.gl
  if (gl) {
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
}

aberrationRenderSubscription = terminal.onRender(scheduleChromaticAberration)

function disposeWebglRenderer(reason: string) {
  const addon = webglAddon
  const contextLossSubscription = webglContextLossSubscription
  webglAddon = undefined
  webglContextLossSubscription = undefined
  clearChromaticAberration()

  try {
    contextLossSubscription?.dispose()
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

  if (!disposed && terminalOpened) fitTerminalToApp()
}

function enableWebglRenderer() {
  let addon: WebglAddon | undefined

  try {
    addon = new WebglAddon(true)
    webglAddon = addon
    webglContextLossSubscription = addon.onContextLoss(() => {
      diagnostic(
        'xterm.webgl',
        'WebGL context lost; falling back to DOM renderer',
        undefined,
        'warn',
      )
      disposeWebglRenderer('context loss')
    })
    terminal.loadAddon(addon)
    fitTerminalToApp()
    scheduleChromaticAberration()
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
    if (webglAddon === addon) disposeWebglRenderer('initialization failure')
  }
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

function measureFont() {
  metricsContext.font = `${FONT_MEASUREMENT_SIZE}px ${FONT_FAMILY}`
  const metrics = metricsContext.measureText('W')

  return {
    widthRatio: metrics.width / FONT_MEASUREMENT_SIZE,
    heightRatio:
      (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) / FONT_MEASUREMENT_SIZE,
  }
}

function rectSnapshot(rect: DOMRect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  }
}

function monitorLayoutSnapshot(scale: number) {
  const artboardRect = monitorArtboard.getBoundingClientRect()
  const terminalRect = terminalHost.getBoundingClientRect()
  const expectedScreenRect = {
    x: artboardRect.x + MONITOR_LAYOUT.screenLeft * scale,
    y: artboardRect.y + MONITOR_LAYOUT.screenTop * scale,
    width: MONITOR_LAYOUT.screenWidth * scale,
    height: MONITOR_LAYOUT.screenHeight * scale,
  }

  return {
    source: MONITOR_OVERLAY,
    normalized: MONITOR_LAYOUT,
    artboardRect: rectSnapshot(artboardRect),
    terminalRect: rectSnapshot(terminalRect),
    expectedScreenRect,
    alignmentError: {
      x: terminalRect.x - expectedScreenRect.x,
      y: terminalRect.y - expectedScreenRect.y,
      width: terminalRect.width - expectedScreenRect.width,
      height: terminalRect.height - expectedScreenRect.height,
    },
  }
}

function fitTerminalToApp() {
  const pixelRatio = window.devicePixelRatio || 1
  const availableTerminalWidth = Math.max(0, appHost.clientWidth - MIN_HORIZONTAL_BEZEL_PX * 2)
  const availableTerminalHeight = Math.max(0, appHost.clientHeight - MIN_VERTICAL_BEZEL_PX * 2)
  const scale = Math.max(
    0,
    Math.min(availableTerminalWidth / TERMINAL_WIDTH, availableTerminalHeight / TERMINAL_HEIGHT),
  )
  const screenInsetX = (appHost.clientWidth - TERMINAL_WIDTH * scale) / 2
  const screenInsetY = (appHost.clientHeight - TERMINAL_HEIGHT * scale) / 2
  const fontMetrics = measureFont()
  const deviceCharWidth = Math.floor(fontMetrics.widthRatio * TERMINAL_FONT_SIZE * pixelRatio)
  const deviceCharHeight = Math.ceil(fontMetrics.heightRatio * TERMINAL_FONT_SIZE * pixelRatio)

  // Keep xterm on one fixed logical surface. Resizing the native window only scales
  // the complete monitor stage, so OpenTUI's grid, the CRT effects, and the bezel
  // aperture remain registered at every viewport size and aspect ratio.
  terminalHost.style.width = `${TERMINAL_WIDTH}px`
  terminalHost.style.height = `${TERMINAL_HEIGHT}px`
  displayStage.style.setProperty('--terminal-scale', String(scale))
  terminal.options.fontSize = TERMINAL_FONT_SIZE
  terminal.options.letterSpacing = 0

  const fitSignature = [appHost.clientWidth, appHost.clientHeight, pixelRatio, scale].join(':')

  if (fitSignature !== lastFitSignature) {
    lastFitSignature = fitSignature
    diagnostic('layout', 'terminal fitted', {
      app: `${appHost.clientWidth}x${appHost.clientHeight}`,
      terminal: `${TERMINAL_WIDTH}x${TERMINAL_HEIGHT}`,
      displayedTerminal: `${TERMINAL_WIDTH * scale}x${TERMINAL_HEIGHT * scale}`,
      displayedMonitor: `${MONITOR_LAYOUT.width * scale}x${MONITOR_LAYOUT.height * scale}`,
      screenInsets: {
        x: screenInsetX,
        y: screenInsetY,
        minimumHorizontalBezel: MIN_HORIZONTAL_BEZEL_PX,
        minimumVerticalBezel: MIN_VERTICAL_BEZEL_PX,
      },
      pixelRatio,
      deviceCharWidth,
      deviceCharHeight,
      scale,
      fontSize: TERMINAL_FONT_SIZE,
      letterSpacing: terminal.options.letterSpacing,
      fontMetrics,
      renderer: webglAddon === undefined ? 'dom' : 'webgl',
      terminalOpened,
      monitor: monitorLayoutSnapshot(scale),
    })
  }
}

function scheduleTerminalFit() {
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)

  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    if (!disposed) {
      fitTerminalToApp()
      scheduleTerminalFocus()
    }
  })
}

function scheduleTerminalFocus() {
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
  clearChromaticAberration()

  focusFrame = requestAnimationFrame(() => {
    focusFrame = undefined
    if (disposed || !terminalOpened) return

    diagnostic('focus', 'requesting webview and xterm focus')
    void appWebview
      .setFocus()
      .catch((error: unknown) => {
        diagnostic('focus', 'webview focus failed', error, 'error')
      })
      .then(() => {
        if (!disposed) {
          terminal.focus()
          diagnostic('focus', 'xterm focus requested', {
            activeElement: document.activeElement?.tagName,
          })
        }
      })
  })
}

function handleVisibilityChange() {
  diagnostic('window', 'visibility changed', { state: document.visibilityState })
  if (document.visibilityState === 'visible') scheduleTerminalFocus()
}

function isMouseMotionInput(data: string) {
  const match = /^\u001b\[<(\d+);\d+;\d+[Mm]$/.exec(data)
  return match ? (Number(match[1]) & 32) !== 0 : false
}

function sendTerminalInput(data: string) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'input', data }))
    if (!isMouseMotionInput(data)) {
      diagnostic('input', 'sent to sidecar', {
        length: data.length,
        escaped: JSON.stringify(data.slice(0, 120)),
      })
    }
    return true
  }

  diagnostic(
    'input',
    'discarded because socket is not open',
    {
      readyState: socket?.readyState,
    },
    'warn',
  )
  return false
}

function handleGlobalKeyDown(event: KeyboardEvent) {
  if (document.activeElement === terminal.textarea) return

  scheduleTerminalFocus()

  if (event.metaKey || event.ctrlKey || event.altKey) return

  const data = {
    ArrowLeft: '\u001b[D',
    ArrowRight: '\u001b[C',
    ArrowUp: '\u001b[A',
    ArrowDown: '\u001b[B',
  }[event.key]

  if (!data || !sendTerminalInput(data)) return

  event.preventDefault()
  event.stopImmediatePropagation()
}

async function spawnSidecar(runtime: BackendDiagnostics, reason: string) {
  diagnostic('sidecar', 'configuring command', {
    reason,
    port: runtime.sidecarPort,
  })

  const command = Command.sidecar('binaries/opentui-sidecar', [], {
    env: {
      TUI_SIDECAR_INSTANCE_ID: runtime.instanceId,
      TUI_SIDECAR_PORT: String(runtime.sidecarPort),
      TUI_SIDECAR_TOKEN: runtime.sidecarToken,
      TUI_SIDECAR_DIAGNOSTICS: SHOW_DIAGNOSTICS ? '1' : '0',
    },
  })
  command.stdout.on('data', (data) => {
    diagnostic('sidecar.stdout', 'data', data)
  })
  command.stderr.on('data', (data) => {
    for (const line of data.split(/\r?\n/)) {
      if (line) diagnostic('sidecar.stderr', line)
    }
  })
  command.on('error', (error) => {
    diagnostic('sidecar', 'process error', error, 'error')
  })
  command.on('close', ({ code, signal }) => {
    diagnostic(
      'sidecar',
      'process closed',
      { code, signal },
      code === 0 || disposed ? 'info' : 'error',
    )
  })

  diagnostic('sidecar', 'spawning process', {
    program: 'binaries/opentui-sidecar',
    reason,
    port: runtime.sidecarPort,
  })
  child = await command.spawn()
  diagnostic('sidecar', 'process spawned', { pid: child.pid, reason })
}

async function stopSidecar(reason: string) {
  const processToStop = child
  child = undefined

  const socketToShutdown = socket
  socket = undefined
  if (socketToShutdown?.readyState === WebSocket.OPEN) {
    const shutdown: SidecarShutdown = { type: 'shutdown' }
    const socketClosed = new Promise<boolean>((resolve) => {
      let settled = false
      let timeout: number | undefined
      const finish = (closed: boolean) => {
        if (settled) return
        settled = true
        if (timeout !== undefined) window.clearTimeout(timeout)
        socketToShutdown.removeEventListener('close', handleClose)
        resolve(closed)
      }
      const handleClose = () => finish(true)

      socketToShutdown.addEventListener('close', handleClose, { once: true })
      timeout = window.setTimeout(() => finish(false), SIDECAR_SHUTDOWN_TIMEOUT_MS)
    })

    try {
      socketToShutdown.send(JSON.stringify(shutdown))
      diagnostic('sidecar', 'graceful shutdown requested', { reason })
      const closedGracefully = await socketClosed
      diagnostic('sidecar', 'graceful shutdown wait completed', { reason, closedGracefully })
    } catch (error) {
      diagnostic('sidecar', 'failed to request graceful shutdown', { reason, error }, 'warn')
    }
  }
  socketToShutdown?.close()

  if (!processToStop) return

  diagnostic('sidecar', 'stopping process', { pid: processToStop.pid, reason }, 'warn')
  try {
    await processToStop.kill()
    diagnostic('sidecar', 'process stopped', { pid: processToStop.pid, reason })
  } catch (error) {
    diagnostic(
      'sidecar',
      'failed to stop process',
      { pid: processToStop.pid, reason, error },
      'warn',
    )
  }
}

function sendTerminalResize(reason: string) {
  if (socket?.readyState !== WebSocket.OPEN) return

  socket.send(JSON.stringify({ type: 'resize', cols: COLS, rows: ROWS }))
  diagnostic('websocket', 'terminal resize sent', { cols: COLS, rows: ROWS, reason })
}

function activateSocket(nextSocket: WebSocket, runtime: BackendDiagnostics, reason: string) {
  if (disposed) {
    diagnostic('frontend', 'disposed before socket activation; closing socket', { reason }, 'warn')
    nextSocket.close()
    return false
  }

  if (nextSocket.readyState !== WebSocket.OPEN) {
    throw new Error(`Sidecar socket closed before activation during ${reason}`)
  }

  const previousSocket = socket
  socket = nextSocket

  nextSocket.addEventListener(
    'close',
    () => {
      if (disposed || socket !== nextSocket) return

      socket = undefined
      diagnostic(
        'recovery',
        'active sidecar connection was lost',
        {
          reason,
          port: runtime.sidecarPort,
        },
        'warn',
      )
      requestSidecarRecovery(runtime)
    },
    { once: true },
  )

  if (previousSocket && previousSocket !== nextSocket) previousSocket.close()

  diagnostic('frontend', 'sidecar WebSocket activated', {
    attempt: socketAttempt,
    readyState: nextSocket.readyState,
    reason,
    port: runtime.sidecarPort,
  })
  return true
}

async function recoverSidecar(runtime: BackendDiagnostics) {
  if (disposed) return

  diagnostic(
    'recovery',
    'automatic sidecar recovery started',
    {
      port: runtime.sidecarPort,
    },
    'warn',
  )

  try {
    const reconnectedSocket = await connectWithRetry(
      runtime,
      RECOVERY_RECONNECT_ATTEMPTS,
      'recovery reconnect',
    )

    if (!activateSocket(reconnectedSocket, runtime, 'recovery reconnect')) return
    sendTerminalResize('recovery reconnect')
    scheduleTerminalFocus()
    diagnostic('recovery', 'reconnected to the existing sidecar process')
    return
  } catch (error) {
    if (error instanceof SidecarIdentityError) throw error
    if (disposed) return
    diagnostic('recovery', 'existing sidecar did not recover; restarting it', error, 'warn')
  }

  await stopSidecar('recovery reconnect grace period expired')
  await spawnSidecar(runtime, 'automatic crash recovery')
  const restartedSocket = await connectWithRetry(
    runtime,
    STARTUP_CONNECTION_ATTEMPTS,
    'sidecar restart',
  )

  if (!activateSocket(restartedSocket, runtime, 'sidecar restart')) return
  sendTerminalResize('sidecar restart')
  scheduleTerminalFocus()
  diagnostic('recovery', 'sidecar restarted and reconnected')
}

function requestSidecarRecovery(runtime: BackendDiagnostics) {
  if (disposed || recoveryPromise || recoveryTimer !== undefined) return

  recoveryPromise = recoverSidecar(runtime)
    .catch((error: unknown) => {
      diagnostic('recovery', 'automatic sidecar recovery failed', error, 'error')
      if (!disposed) {
        terminal.write(`\r\nSidecar recovery failed: ${String(error)}\r\n`)
      }
    })
    .finally(() => {
      recoveryPromise = undefined

      if (!disposed && !socket) {
        diagnostic(
          'recovery',
          'scheduling another recovery cycle',
          {
            delayMs: RECOVERY_CYCLE_RETRY_DELAY_MS,
          },
          'warn',
        )
        recoveryTimer = window.setTimeout(() => {
          recoveryTimer = undefined
          requestSidecarRecovery(runtime)
        }, RECOVERY_CYCLE_RETRY_DELAY_MS)
      }
    })
}

async function start(runtime: BackendDiagnostics) {
  const url = sidecarSocketUrl(runtime)
  diagnostic('sidecar', 'probing for this app instance sidecar', {
    port: runtime.sidecarPort,
    protocol: SIDECAR_PROTOCOL,
  })
  socketAttempt = 0

  let connectedSocket: WebSocket
  try {
    connectedSocket = await openSocket(url, socketAttempt, runtime)
    diagnostic('sidecar', 'reusing verified existing process')
  } catch (error) {
    if (error instanceof SidecarIdentityError) throw error
    diagnostic('sidecar', 'no verified existing process found', error, 'warn')
    await spawnSidecar(runtime, 'initial startup')
    connectedSocket = await connectWithRetry(
      runtime,
      STARTUP_CONNECTION_ATTEMPTS,
      'initial startup',
    )
  }

  if (!activateSocket(connectedSocket, runtime, 'initial startup')) return

  inputSubscription = terminal.onData((data) => {
    sendTerminalInput(data)
  })
  diagnostic('xterm', 'input subscription installed')

  sendTerminalResize('initial startup')
}

function cleanup(reason: string) {
  if (cleanupPromise) return cleanupPromise
  diagnostic('frontend', 'cleanup started', { reason })
  disposed = true
  resizeObserver?.disconnect()
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
  if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer)
  if (loadingTimer !== undefined) window.clearInterval(loadingTimer)
  unlistenWindowFocus?.()
  window.removeEventListener('focus', scheduleTerminalFocus)
  window.removeEventListener('keydown', handleGlobalKeyDown, true)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  terminalHost.removeEventListener('pointerdown', scheduleTerminalFocus)
  aberrationRenderSubscription?.dispose()
  inputSubscription?.dispose()
  disposeWebglRenderer('frontend cleanup')
  if (terminalOpened) terminal.dispose()

  cleanupPromise = stopSidecar(reason).then(() => {
    diagnostic('frontend', 'cleanup completed', { reason })
  })
  return cleanupPromise
}

window.addEventListener('focus', scheduleTerminalFocus)
window.addEventListener('keydown', handleGlobalKeyDown, true)
document.addEventListener('visibilitychange', handleVisibilityChange)
terminalHost.addEventListener('pointerdown', scheduleTerminalFocus)
window.addEventListener('beforeunload', () => void cleanup('window unloading'), { once: true })
import.meta.hot?.dispose(() => {
  unlistenWindowCloseRequested?.()
  void cleanup('hot reload')
})

void (async () => {
  diagnostic('bootstrap', 'started')

  let backend: BackendDiagnostics
  try {
    backend = await invoke<BackendDiagnostics>('backend_diagnostics')
    const { sidecarToken: _sidecarToken, ...safeBackendDiagnostics } = backend
    diagnostic('tauri', 'native backend responded', {
      ...safeBackendDiagnostics,
      sidecarTokenPresent: _sidecarToken.length > 0,
    })
  } catch (error) {
    diagnostic('tauri', 'native backend diagnostics failed', error, 'error')
    throw error
  }

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

  fitTerminalToApp()
  diagnostic('xterm', 'opening terminal', {
    hostInlineSize: `${terminalHost.style.width}x${terminalHost.style.height}`,
  })
  terminal.open(terminalHost)
  terminalOpened = true
  enableWebglRenderer()
  await startLoadingIndicator()
  await appWindow.show()
  fitTerminalToApp()
  diagnostic('tauri', 'window shown after terminal initialization')
  const terminalRect = terminalHost.getBoundingClientRect()
  diagnostic('xterm', 'terminal opened', {
    cols: terminal.cols,
    rows: terminal.rows,
    hostRect: {
      x: terminalRect.x,
      y: terminalRect.y,
      width: terminalRect.width,
      height: terminalRect.height,
    },
    hasElement: Boolean(terminal.element),
    hasTextarea: Boolean(terminal.textarea),
    rowContainers: terminalHost.querySelectorAll('.xterm-rows').length,
  })

  unlistenWindowFocus = await appWindow.onFocusChanged(({ payload }) => {
    diagnostic('tauri', 'window focus changed', { focused: payload })
    if (payload) scheduleTerminalFocus()
  })
  diagnostic('tauri', 'window focus listener installed')

  resizeObserver = new ResizeObserver(scheduleTerminalFit)
  resizeObserver.observe(appHost)
  diagnostic('layout', 'resize observer installed')

  scheduleTerminalFocus()
  await start(backend)
  scheduleTerminalFocus()
  diagnostic('bootstrap', 'completed')
})().catch((error) => {
  diagnostic('bootstrap', 'fatal startup error', error, 'error')
  stopLoadingIndicator()
  terminal.write(`\r\nFailed to start sidecar: ${String(error)}\r\n`)
})
