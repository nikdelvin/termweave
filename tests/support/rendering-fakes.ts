export class FakeCanvas {
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

export class FakeTerminal {
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

export function fakeWebglCanvas(maximumTextureUnits = 16) {
  const maximumTextureUnitsParameter = 0x8872
  const gl = {
    MAX_TEXTURE_IMAGE_UNITS: maximumTextureUnitsParameter,
    getParameter(parameter: number) {
      if (parameter !== maximumTextureUnitsParameter) {
        throw new Error(`Unexpected WebGL parameter ${parameter}.`)
      }
      return maximumTextureUnits
    },
  } as unknown as WebGL2RenderingContext
  return {
    getContext(type: string) {
      return type === 'webgl2' ? gl : null
    },
  } as unknown as HTMLCanvasElement
}
