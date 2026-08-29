import { describe, expect, test } from 'bun:test'
import {
  CrtPostprocessor,
  type RuntimePostprocessorFailure,
} from '../termweave/host/crt-effects/crt-postprocessor'

type GlObject = { readonly kind: string; readonly id: number }

class FakeGl {
  readonly ACTIVE_TEXTURE = 1
  readonly TEXTURE_BINDING_2D = 2
  readonly CURRENT_PROGRAM = 3
  readonly VERTEX_ARRAY_BINDING = 4
  readonly ARRAY_BUFFER_BINDING = 5
  readonly VIEWPORT = 6
  readonly READ_FRAMEBUFFER_BINDING = 7
  readonly DRAW_FRAMEBUFFER_BINDING = 8
  readonly MAX_TEXTURE_SIZE = 9
  readonly BLEND = 10
  readonly TEXTURE0 = 100
  readonly TEXTURE_2D = 11
  readonly TEXTURE_MIN_FILTER = 12
  readonly TEXTURE_MAG_FILTER = 13
  readonly TEXTURE_WRAP_S = 14
  readonly TEXTURE_WRAP_T = 15
  readonly LINEAR = 16
  readonly CLAMP_TO_EDGE = 17
  readonly RGBA8 = 18
  readonly RGBA = 19
  readonly UNSIGNED_BYTE = 20
  readonly DRAW_FRAMEBUFFER = 21
  readonly READ_FRAMEBUFFER = 22
  readonly COLOR_ATTACHMENT0 = 23
  readonly FRAMEBUFFER_COMPLETE = 24
  readonly VERTEX_SHADER = 25
  readonly FRAGMENT_SHADER = 26
  readonly COMPILE_STATUS = 27
  readonly LINK_STATUS = 28
  readonly ARRAY_BUFFER = 29
  readonly STATIC_DRAW = 30
  readonly FLOAT = 31
  readonly TRIANGLES = 32
  readonly COLOR_BUFFER_BIT = 33
  readonly NEAREST = 34
  readonly COLOR_CLEAR_VALUE = 35
  readonly COLOR_WRITEMASK = 36
  readonly SCISSOR_TEST = 37
  readonly NO_ERROR = 0
  readonly OUT_OF_MEMORY = 1285

  activeTextureUnit = this.TEXTURE0 + 3
  arrayBuffer: GlObject | null = { kind: 'stock-buffer', id: -3 }
  blendEnabled = true
  scissorEnabled = true
  clearColorValue = new Float32Array([0.25, 0.5, 0.75, 0.5])
  colorMaskValue = [false, true, false, true]
  currentProgram: GlObject | null = { kind: 'stock-program', id: -1 }
  drawFramebuffer: GlObject | null = null
  drawingBufferWidth = 2560
  drawingBufferHeight = 1440
  readFramebuffer: GlObject | null = { kind: 'stock-read-framebuffer', id: -5 }
  vertexArray: GlObject | null = { kind: 'stock-vertex-array', id: -2 }
  viewportValue = new Int32Array([7, 11, 123, 456])
  maximumTextureSize = 8192
  contextLost = false
  framebufferComplete = true
  failShaderType: number | undefined
  programLinks = true
  allocationError = this.NO_ERROR
  throwOnDraw = false
  failCreation: string | undefined

  readonly operations: string[] = []
  readonly allocations: { internalFormat: number; width: number; height: number }[] = []
  readonly created = new Map<string, GlObject[]>()
  readonly deleted = new Map<string, GlObject[]>()
  readonly textureBindings = new Map<number, GlObject | null>([
    [this.TEXTURE0, { kind: 'stock-texture', id: -4 }],
  ])
  private readonly shaderTypes = new Map<GlObject, number>()
  drawCount = 0
  blitCount = 0
  clearCount = 0
  readonly clearedColors: number[][] = []
  readonly clearedFramebuffers: (GlObject | null)[] = []
  private nextId = 1

  private create(kind: string) {
    if (this.failCreation === kind) return null
    const value = { kind, id: this.nextId++ }
    const values = this.created.get(kind) ?? []
    values.push(value)
    this.created.set(kind, values)
    return value
  }

  private remove(kind: string, value: GlObject | null) {
    if (!value) return
    const values = this.deleted.get(kind) ?? []
    values.push(value)
    this.deleted.set(kind, values)
  }

  getParameter(parameter: number) {
    if (parameter === this.ACTIVE_TEXTURE) return this.activeTextureUnit
    if (parameter === this.TEXTURE_BINDING_2D) {
      return this.textureBindings.get(this.activeTextureUnit) ?? null
    }
    if (parameter === this.CURRENT_PROGRAM) return this.currentProgram
    if (parameter === this.VERTEX_ARRAY_BINDING) return this.vertexArray
    if (parameter === this.ARRAY_BUFFER_BINDING) return this.arrayBuffer
    if (parameter === this.VIEWPORT) return this.viewportValue
    if (parameter === this.READ_FRAMEBUFFER_BINDING) return this.readFramebuffer
    if (parameter === this.DRAW_FRAMEBUFFER_BINDING) return this.drawFramebuffer
    if (parameter === this.MAX_TEXTURE_SIZE) return this.maximumTextureSize
    if (parameter === this.COLOR_CLEAR_VALUE) return this.clearColorValue
    if (parameter === this.COLOR_WRITEMASK) return this.colorMaskValue
    throw new Error(`Unexpected getParameter ${parameter}`)
  }

  activeTexture(unit: number) {
    this.activeTextureUnit = unit
  }
  isEnabled(capability: number) {
    if (capability === this.BLEND) return this.blendEnabled
    if (capability === this.SCISSOR_TEST) return this.scissorEnabled
    return false
  }
  enable(capability: number) {
    if (capability === this.BLEND) this.blendEnabled = true
    if (capability === this.SCISSOR_TEST) this.scissorEnabled = true
  }
  disable(capability: number) {
    if (capability === this.BLEND) this.blendEnabled = false
    if (capability === this.SCISSOR_TEST) this.scissorEnabled = false
  }
  useProgram(program: GlObject | null) {
    this.currentProgram = program
  }
  bindVertexArray(vertexArray: GlObject | null) {
    this.vertexArray = vertexArray
  }
  bindBuffer(_target: number, buffer: GlObject | null) {
    this.arrayBuffer = buffer
  }
  viewport(x: number, y: number, width: number, height: number) {
    this.viewportValue = new Int32Array([x, y, width, height])
  }
  bindTexture(_target: number, texture: GlObject | null) {
    this.textureBindings.set(this.activeTextureUnit, texture)
  }
  bindFramebuffer(target: number, framebuffer: GlObject | null) {
    this.operations.push(`bindFramebuffer:${target}:${framebuffer?.id ?? 'default'}`)
    if (target === this.READ_FRAMEBUFFER) this.readFramebuffer = framebuffer
    else if (target === this.DRAW_FRAMEBUFFER) this.drawFramebuffer = framebuffer
  }
  createShader(type: number) {
    const shader = this.create('shader')
    if (shader) this.shaderTypes.set(shader, type)
    return shader
  }
  shaderSource() {}
  compileShader() {}
  getShaderParameter(shader: GlObject) {
    return this.shaderTypes.get(shader) !== this.failShaderType
  }
  getShaderInfoLog() {
    return 'fake shader failure'
  }
  deleteShader(value: GlObject | null) {
    this.remove('shader', value)
  }
  createProgram() {
    return this.create('program')
  }
  attachShader() {}
  linkProgram() {}
  getProgramParameter() {
    return this.programLinks
  }
  getProgramInfoLog() {
    return 'fake link failure'
  }
  deleteProgram(value: GlObject | null) {
    this.remove('program', value)
  }
  createBuffer() {
    return this.create('buffer')
  }
  deleteBuffer(value: GlObject | null) {
    this.remove('buffer', value)
  }
  createVertexArray() {
    return this.create('vertex-array')
  }
  deleteVertexArray(value: GlObject | null) {
    this.remove('vertex-array', value)
  }
  createTexture() {
    return this.create('texture')
  }
  deleteTexture(value: GlObject | null) {
    this.remove('texture', value)
  }
  createFramebuffer() {
    return this.create('framebuffer')
  }
  deleteFramebuffer(value: GlObject | null) {
    this.remove('framebuffer', value)
  }
  bufferData() {}
  enableVertexAttribArray() {}
  vertexAttribPointer() {}
  texParameteri() {}
  texImage2D(
    _target: number,
    _level: number,
    internalFormat: number,
    width: number,
    height: number,
  ) {
    this.allocations.push({ internalFormat, width, height })
  }
  getError() {
    const error = this.allocationError
    this.allocationError = this.NO_ERROR
    return error
  }
  framebufferTexture2D() {}
  checkFramebufferStatus() {
    return this.framebufferComplete ? this.FRAMEBUFFER_COMPLETE : -1
  }
  getUniformLocation(_program: GlObject, name: string) {
    return this.failCreation === `uniform:${name}`
      ? null
      : ({ kind: `uniform:${name}`, id: this.nextId++ } as GlObject)
  }
  uniform1i() {}
  uniform1f() {}
  uniform2f() {}
  uniform3f() {}
  drawArrays() {
    if (this.throwOnDraw) throw new Error('draw failed')
    this.drawCount += 1
  }
  blitFramebuffer() {
    this.blitCount += 1
  }
  clearColor(red: number, green: number, blue: number, alpha: number) {
    this.clearColorValue = new Float32Array([red, green, blue, alpha])
  }
  colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean) {
    this.colorMaskValue = [red, green, blue, alpha]
  }
  clear(mask: number) {
    expect(mask).toBe(this.COLOR_BUFFER_BIT)
    this.clearCount += 1
    this.clearedColors.push([...this.clearColorValue])
    this.clearedFramebuffers.push(this.drawFramebuffer)
  }
  isContextLost() {
    return this.contextLost
  }
}

class FakeCanvas {
  width = 2560
  height = 1440
  clientWidth = 2560
  clientHeight = 1440
  style = { backgroundColor: '#112233' }
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener)
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener({ type } as Event)
      else listener.handleEvent({ type } as Event)
    }
  }
  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0
  }
}

class FakeTerminal {
  renderDisposeCount = 0
  throwOnSubscribe = false
  private renderHandler: (() => void) | undefined

  onRender(handler: () => void) {
    if (this.throwOnSubscribe) throw new Error('render subscription failed')
    this.renderHandler = handler
    return {
      dispose: () => {
        this.renderDisposeCount += 1
        this.renderHandler = undefined
      },
    }
  }
  render() {
    this.renderHandler?.()
  }
}

type HarnessConfig = Readonly<{
  themeColor?: string
  configureGl?: (gl: FakeGl) => void
  observerFailure?: 'create' | 'observe'
  terminalSubscriptionFailure?: boolean
}>

function createFixture({
  themeColor = '#010416',
  configureGl,
  observerFailure,
  terminalSubscriptionFailure = false,
}: HarnessConfig = {}) {
  const gl = new FakeGl()
  configureGl?.(gl)
  const canvas = new FakeCanvas()
  const terminal = new FakeTerminal()
  terminal.throwOnSubscribe = terminalSubscriptionFailure
  let observerCallback: MutationCallback | undefined
  let observerDisconnectCount = 0
  let observerOptions: MutationObserverInit | undefined
  const failures: RuntimePostprocessorFailure[] = []

  const construct = () =>
    new CrtPostprocessor({
      terminal: terminal as never,
      canvas: canvas as never,
      gl: gl as unknown as WebGL2RenderingContext,
      themeColor,
      onRuntimeFailure: (failure) => failures.push(failure),
      createObserver: (callback) => {
        if (observerFailure === 'create') throw new Error('observer creation failed')
        observerCallback = callback
        return {
          observe: (_target, options) => {
            if (observerFailure === 'observe') throw new Error('observer subscription failed')
            observerOptions = options
          },
          disconnect: () => {
            observerDisconnectCount += 1
          },
        }
      },
    })

  return {
    gl,
    canvas,
    terminal,
    failures,
    construct,
    resize: () => {
      gl.drawingBufferWidth = canvas.width
      gl.drawingBufferHeight = canvas.height
      observerCallback?.([], {} as MutationObserver)
    },
    observerOptions: () => observerOptions,
    observerDisconnectCount: () => observerDisconnectCount,
  }
}

function createHarness(config: HarnessConfig = {}) {
  const fixture = createFixture(config)
  return { ...fixture, postprocessor: fixture.construct() }
}

function resourceIds(resources: readonly GlObject[]) {
  return resources.map(({ id }) => id).sort((left, right) => left - right)
}

function expectAllCreatedResourcesDeleted(gl: FakeGl) {
  for (const [kind, created] of gl.created) {
    expect(resourceIds(gl.deleted.get(kind) ?? []), `${kind} resources`).toEqual(
      resourceIds(created),
    )
  }
}

function expectStockStateRestored(gl: FakeGl) {
  expect(gl.currentProgram).toEqual({ kind: 'stock-program', id: -1 })
  expect(gl.vertexArray).toEqual({ kind: 'stock-vertex-array', id: -2 })
  expect(gl.arrayBuffer).toEqual({ kind: 'stock-buffer', id: -3 })
  expect(gl.textureBindings.get(gl.TEXTURE0)).toEqual({ kind: 'stock-texture', id: -4 })
  expect(gl.readFramebuffer).toEqual({ kind: 'stock-read-framebuffer', id: -5 })
  expect(gl.activeTextureUnit).toBe(gl.TEXTURE0 + 3)
  expect([...gl.viewportValue]).toEqual([7, 11, 123, 456])
  expect(gl.blendEnabled).toBe(true)
}

describe('same-context CRT postprocessor lifecycle', () => {
  test('initializes the sampled target and display before the first render', () => {
    const harness = createHarness({ themeColor: '#FF0000' })
    expect(harness.gl.created.get('texture')).toHaveLength(1)
    expect(harness.gl.created.get('framebuffer')).toHaveLength(1)
    expect(harness.gl.allocations).toEqual([
      { internalFormat: harness.gl.RGBA8, width: 2560, height: 1440 },
    ])
    const target = harness.gl.created.get('framebuffer')![0]!
    expect(harness.gl.drawFramebuffer).toBe(target)
    expect(harness.gl.clearCount).toBe(2)
    expect(harness.gl.clearedColors).toEqual([
      [1, 0, 0, 1],
      [1, 0, 0, 1],
    ])
    expect(harness.gl.clearedFramebuffers).toEqual([target, null])
    expect([...harness.gl.clearColorValue]).toEqual([0.25, 0.5, 0.75, 0.5])
    expect(harness.gl.colorMaskValue).toEqual([false, true, false, true])
    expect(harness.gl.scissorEnabled).toBe(true)
    expect(harness.canvas.style.backgroundColor).toBe('#FF0000')
    expect(harness.observerOptions()).toEqual({
      attributes: true,
      attributeFilter: ['width', 'height'],
    })
    harness.postprocessor.dispose()
    expect(harness.canvas.style.backgroundColor).toBe('#112233')
  })

  test('presents synchronously without copies or allocations and restores all shared state', () => {
    const harness = createHarness()
    const target = harness.gl.drawFramebuffer!
    const stockProgram = harness.gl.currentProgram
    const stockVertexArray = harness.gl.vertexArray
    const stockBuffer = harness.gl.arrayBuffer
    const stockReadFramebuffer = harness.gl.readFramebuffer
    const stockTexture = harness.gl.textureBindings.get(harness.gl.TEXTURE0)
    const stockViewport = [...harness.gl.viewportValue]
    const allocationCount = harness.gl.allocations.length

    harness.terminal.render()
    harness.terminal.render()

    expect(harness.gl.drawCount).toBe(2)
    expect(harness.gl.blitCount).toBe(0)
    expect(harness.gl.allocations).toHaveLength(allocationCount)
    expect(harness.gl.drawFramebuffer).toBe(target)
    expect(harness.gl.clearCount).toBe(2)
    expect(harness.gl.readFramebuffer).toBe(stockReadFramebuffer)
    expect(harness.gl.currentProgram).toBe(stockProgram)
    expect(harness.gl.vertexArray).toBe(stockVertexArray)
    expect(harness.gl.arrayBuffer).toBe(stockBuffer)
    expect([...harness.gl.viewportValue]).toEqual(stockViewport)
    expect(harness.gl.blendEnabled).toBe(true)
    expect(harness.gl.activeTextureUnit).toBe(harness.gl.TEXTURE0 + 3)
    expect(harness.gl.textureBindings.get(harness.gl.TEXTURE0)).toBe(stockTexture)
    expect(harness.failures).toHaveLength(0)
    harness.postprocessor.dispose()
  })

  test('reuses the one texture and framebuffer at exact resized drawing-buffer dimensions', () => {
    const harness = createHarness()
    const target = harness.gl.drawFramebuffer!
    const texture = harness.gl.created.get('texture')![0]

    for (const [width, height, clientWidth, clientHeight] of [
      [5120, 2880, 2560, 1440],
      [2400, 1800, 1200, 900],
      [2560, 1440, 2560, 1440],
    ]) {
      harness.canvas.width = width
      harness.canvas.height = height
      harness.canvas.clientWidth = clientWidth
      harness.canvas.clientHeight = clientHeight
      harness.resize()
    }

    expect(harness.gl.created.get('texture')).toEqual([texture])
    expect(harness.gl.created.get('framebuffer')).toEqual([target])
    expect(harness.gl.allocations).toEqual([
      { internalFormat: harness.gl.RGBA8, width: 2560, height: 1440 },
      { internalFormat: harness.gl.RGBA8, width: 5120, height: 2880 },
      { internalFormat: harness.gl.RGBA8, width: 2400, height: 1800 },
      { internalFormat: harness.gl.RGBA8, width: 2560, height: 1440 },
    ])
    expect(harness.gl.drawFramebuffer).toBe(target)
    expect(harness.gl.clearCount).toBe(8)
    expect(harness.gl.clearedFramebuffers).toEqual([
      target,
      null,
      target,
      null,
      target,
      null,
      target,
      null,
    ])
    harness.terminal.render()
    expect(harness.gl.drawCount).toBe(1)
    expect(harness.failures).toHaveLength(0)
    harness.postprocessor.dispose()
    expectAllCreatedResourcesDeleted(harness.gl)
  })

  test('suspends on loss and rebuilds fresh resources synchronously on restoration', () => {
    const harness = createHarness()
    const firstTarget = harness.gl.drawFramebuffer
    harness.gl.contextLost = true
    harness.canvas.emit('webglcontextlost')
    harness.terminal.render()
    expect(harness.gl.drawCount).toBe(0)
    expect(harness.gl.created.get('framebuffer')).toHaveLength(1)

    harness.gl.contextLost = false
    harness.canvas.emit('webglcontextrestored')
    expect(harness.gl.created.get('framebuffer')).toHaveLength(2)
    expect(harness.gl.drawFramebuffer).not.toBe(firstTarget)
    expect(harness.gl.clearCount).toBe(4)
    expect(harness.gl.clearedFramebuffers).toEqual([
      firstTarget,
      null,
      harness.gl.drawFramebuffer,
      null,
    ])
    harness.terminal.render()
    expect(harness.gl.drawCount).toBe(1)
    expect(harness.failures).toHaveLength(0)

    harness.postprocessor.dispose()
    harness.postprocessor.dispose()
    expect(harness.gl.deleted.get('framebuffer')).toHaveLength(1)
    expect(harness.terminal.renderDisposeCount).toBe(1)
    expect(harness.observerDisconnectCount()).toBe(1)
    expect(harness.canvas.listenerCount('webglcontextlost')).toBe(0)
    expect(harness.canvas.listenerCount('webglcontextrestored')).toBe(0)
  })

  test('uses exactly one emergency nearest blit after a steering invariant failure', () => {
    const harness = createHarness()
    harness.gl.drawFramebuffer = { kind: 'foreign-framebuffer', id: -20 }
    harness.terminal.render()
    expect(harness.failures).toHaveLength(1)
    harness.failures[0]!.emergencyHandoff()
    harness.failures[0]!.emergencyHandoff()
    expect(harness.gl.blitCount).toBe(1)
    expect(harness.gl.readFramebuffer).toBeNull()
    expect(harness.gl.drawFramebuffer).toBeNull()
    harness.postprocessor.dispose()
  })

  test('skips emergency handoff when xterm already rendered the raw frame to default', () => {
    const harness = createHarness()
    harness.gl.drawFramebuffer = null
    harness.terminal.render()
    harness.failures[0]!.emergencyHandoff()
    expect(harness.gl.blitCount).toBe(0)
    harness.postprocessor.dispose()
  })

  test('hands off once after an unexpected presentation exception', () => {
    const harness = createHarness({
      configureGl: (gl) => {
        gl.throwOnDraw = true
      },
    })
    harness.terminal.render()
    expect(harness.failures).toHaveLength(1)
    harness.failures[0]!.emergencyHandoff()
    harness.failures[0]!.emergencyHandoff()
    expect(harness.gl.blitCount).toBe(1)
    harness.postprocessor.dispose()
  })
})

describe('transactional CRT construction failures', () => {
  const glFailures: readonly Readonly<{
    name: string
    configureGl(gl: FakeGl): void
  }>[] = [
    {
      name: 'vertex shader compilation failure',
      configureGl: (gl) => {
        gl.failShaderType = gl.VERTEX_SHADER
      },
    },
    {
      name: 'fragment shader compilation failure',
      configureGl: (gl) => {
        gl.failShaderType = gl.FRAGMENT_SHADER
      },
    },
    {
      name: 'program linking failure',
      configureGl: (gl) => {
        gl.programLinks = false
      },
    },
    ...['program', 'buffer', 'vertex-array', 'texture', 'framebuffer'].map((kind) => ({
      name: `${kind} creation failure`,
      configureGl: (gl: FakeGl) => {
        gl.failCreation = kind
      },
    })),
    {
      name: 'texture allocation failure',
      configureGl: (gl) => {
        gl.allocationError = gl.OUT_OF_MEMORY
      },
    },
    {
      name: 'maximum texture-size failure',
      configureGl: (gl) => {
        gl.maximumTextureSize = 1024
      },
    },
    {
      name: 'non-finite texture-size limit',
      configureGl: (gl) => {
        gl.maximumTextureSize = Number.NaN
      },
    },
    {
      name: 'drawing-buffer dimension mismatch',
      configureGl: (gl) => {
        gl.drawingBufferWidth = 1280
      },
    },
    {
      name: 'framebuffer incompleteness',
      configureGl: (gl) => {
        gl.framebufferComplete = false
      },
    },
    {
      name: 'required uniform failure',
      configureGl: (gl) => {
        gl.failCreation = 'uniform:u_terminal'
      },
    },
  ]

  for (const { name, configureGl } of glFailures) {
    test(`cleans up after ${name}`, () => {
      const fixture = createFixture({ configureGl })
      expect(fixture.construct).toThrow()
      expectAllCreatedResourcesDeleted(fixture.gl)
      expectStockStateRestored(fixture.gl)
      expect(fixture.gl.drawFramebuffer).toBeNull()
      expect(fixture.canvas.style.backgroundColor).toBe('#112233')
      expect(fixture.canvas.listenerCount('webglcontextlost')).toBe(0)
      expect(fixture.canvas.listenerCount('webglcontextrestored')).toBe(0)
      expect(fixture.observerDisconnectCount()).toBe(0)
      expect(fixture.terminal.renderDisposeCount).toBe(0)
    })
  }

  for (const config of [
    { name: 'observer creation failure', observerFailure: 'create' as const, disconnects: 0 },
    { name: 'observer subscription failure', observerFailure: 'observe' as const, disconnects: 1 },
    { name: 'render subscription failure', terminalSubscriptionFailure: true, disconnects: 1 },
  ]) {
    test(`cleans up after ${config.name}`, () => {
      const fixture = createFixture(config)
      expect(fixture.construct).toThrow()
      expectAllCreatedResourcesDeleted(fixture.gl)
      expectStockStateRestored(fixture.gl)
      expect(fixture.gl.drawFramebuffer).toBeNull()
      expect(fixture.canvas.style.backgroundColor).toBe('#112233')
      expect(fixture.canvas.listenerCount('webglcontextlost')).toBe(0)
      expect(fixture.canvas.listenerCount('webglcontextrestored')).toBe(0)
      expect(fixture.observerDisconnectCount()).toBe(config.disconnects)
      expect(fixture.terminal.renderDisposeCount).toBe(0)
    })
  }
})

describe('transactional CRT runtime failures', () => {
  for (const failure of ['allocation', 'framebuffer'] as const) {
    test(`falls back cleanly after a resize ${failure} failure`, () => {
      const harness = createHarness()
      harness.canvas.width = 5120
      harness.canvas.height = 2880
      if (failure === 'allocation') harness.gl.allocationError = harness.gl.OUT_OF_MEMORY
      else harness.gl.framebufferComplete = false

      harness.resize()
      expect(harness.failures).toHaveLength(1)
      harness.terminal.render()
      expect(harness.gl.drawCount).toBe(0)
      harness.failures[0]!.emergencyHandoff()
      expect(harness.gl.blitCount).toBe(0)

      harness.postprocessor.dispose()
      expectAllCreatedResourcesDeleted(harness.gl)
      expect(harness.terminal.renderDisposeCount).toBe(1)
      expect(harness.observerDisconnectCount()).toBe(1)
      expect(harness.canvas.listenerCount('webglcontextlost')).toBe(0)
      expect(harness.canvas.listenerCount('webglcontextrestored')).toBe(0)
    })
  }

  test('cleans partial replacement resources when context restoration fails', () => {
    const harness = createHarness()
    harness.gl.contextLost = true
    harness.canvas.emit('webglcontextlost')
    const createdBeforeRestoration = harness.gl.created.get('shader')!.length

    harness.gl.contextLost = false
    harness.gl.programLinks = false
    harness.canvas.emit('webglcontextrestored')

    expect(harness.failures).toHaveLength(1)
    expect(harness.gl.created.get('shader')).toHaveLength(createdBeforeRestoration + 2)
    expect(resourceIds(harness.gl.deleted.get('shader')!)).toEqual(
      resourceIds(harness.gl.created.get('shader')!.slice(createdBeforeRestoration)),
    )
    expect(harness.gl.deleted.get('program')).toEqual(harness.gl.created.get('program')!.slice(1))
    harness.terminal.render()
    expect(harness.gl.drawCount).toBe(0)

    harness.postprocessor.dispose()
    expect(harness.terminal.renderDisposeCount).toBe(1)
    expect(harness.observerDisconnectCount()).toBe(1)
    expect(harness.canvas.listenerCount('webglcontextlost')).toBe(0)
    expect(harness.canvas.listenerCount('webglcontextrestored')).toBe(0)
  })
})
