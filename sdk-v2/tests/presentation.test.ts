import { describe, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseAppConfig } from '../shared/config'
import {
  createPresentation,
  crtEffectStyleVariables,
  monitorBezelFilter,
  presentationLayout,
  presentationState,
  scaleStageToFit,
} from '../src/presentation'
import { validAppConfig } from './fixtures'

function fakeStyle() {
  const properties = new Map<string, string>()
  return {
    getPropertyValue(property: string) {
      return properties.get(property) ?? ''
    },
    setProperty(property: string, value: string) {
      properties.set(property, value)
    },
  } as CSSStyleDeclaration
}

function fakeElement() {
  return {
    dataset: {} as DOMStringMap,
    hidden: true,
    style: fakeStyle(),
  }
}

describe('presentation configuration matrix', () => {
  for (const monitorOverlay of [true, false]) {
    for (const crtEffects of [true, false]) {
      test(`monitor ${monitorOverlay ? 'on' : 'off'}, CRT ${crtEffects ? 'on' : 'off'}`, () => {
        const state = presentationState({ monitorOverlay, crtEffects })

        expect(state.monitorHidden).toBe(!monitorOverlay)
        expect(state.effectsHidden).toBe(!crtEffects)
        expect(state.layout.terminalWidth).toBe(2560)
        expect(state.layout.terminalHeight).toBe(1440)
      })
    }
  }

  test('applies every flag and configured color to the complete presentation host', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    let disconnectCount = 0

    class FakeResizeObserver {
      disconnect() {
        disconnectCount += 1
      }

      observe() {}
    }

    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver

    try {
      for (const monitorOverlay of [true, false]) {
        for (const crtEffects of [true, false]) {
          const stage = fakeElement()
          const terminal = fakeElement()
          const effects = fakeElement()
          const monitor = fakeElement()
          const rendererStatus = fakeElement()
          const rendererStatusMessage = fakeElement()
          const elements = new Map<string, ReturnType<typeof fakeElement>>([
            ['#display-stage', stage],
            ['#terminal', terminal],
            ['#crt-effects', effects],
            ['#monitor-overlay', monitor],
            ['#renderer-status', rendererStatus],
            ['#renderer-status-message', rendererStatusMessage],
          ])
          const root = {
            ...fakeElement(),
            clientHeight: 900,
            clientWidth: 1200,
            querySelector(selector: string) {
              return elements.get(selector) ?? null
            },
          }
          const config = parseAppConfig(
            validAppConfig({
              backgroundColor: '#112233',
              foregroundColor: '#AABBCC',
              monitorOverlay,
              crtEffects,
            }),
          )

          const presentation = createPresentation(root as unknown as HTMLElement, config)

          expect(root.style.getPropertyValue('--termweave-background')).toBe('#112233')
          expect(root.style.getPropertyValue('--termweave-foreground')).toBe('#AABBCC')
          expect(root.dataset.monitorOverlay).toBe(monitorOverlay ? 'on' : 'off')
          expect(root.dataset.crtEffects).toBe(crtEffects ? 'on' : 'off')
          expect(monitor.hidden).toBe(!monitorOverlay)
          expect(effects.hidden).toBe(!crtEffects)
          expect(terminal.style.left).toBe('-1280px')
          expect(terminal.style.top).toBe('-720px')
          expect(terminal.style.width).toBe('2560px')
          expect(terminal.style.height).toBe('1440px')
          expect(effects.style.width).toBe('2560px')
          expect(effects.style.height).toBe('1440px')
          expect(rendererStatus.style.left).toBe('-1280px')
          expect(rendererStatus.style.top).toBe('-720px')
          expect(rendererStatus.style.width).toBe('2560px')
          expect(rendererStatus.style.height).toBe('1440px')
          expect(effects.style.getPropertyValue('--crt-noise-opacity')).toBe(
            crtEffects ? '0.025' : '',
          )
          expect(effects.style.getPropertyValue('--crt-scanlines-opacity')).toBe('')
          expect(stage.style.getPropertyValue('--termweave-stage-scale')).toBe(
            String(monitorOverlay ? 1072 / 2560 : 1200 / 2560),
          )

          presentation.dispose()
        }
      }
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }

    expect(disconnectCount).toBe(4)
  })
})

describe('fixed logical stage', () => {
  test('uses an edge-to-edge 2560x1440 terminal when the monitor is disabled', () => {
    const layout = presentationLayout(false)
    expect(layout).toMatchObject({
      terminalLeft: -1280,
      terminalTop: -720,
      terminalWidth: 2560,
      terminalHeight: 1440,
      windowInset: 0,
    })
    expect(scaleStageToFit(2560, 1440, layout)).toBe(1)
  })

  test('positions the monitor around an exactly centered terminal aperture', () => {
    const layout = presentationLayout(true)
    const apertureWidth = 3000 - 268 - 278
    const apertureHeight = 1740 - 201 - 159
    const apertureCenterX = 268 + apertureWidth / 2
    const apertureCenterY = 201 + apertureHeight / 2
    const frameWidth = 2464
    const frameHeight = 1386
    const frameLeft = apertureCenterX - frameWidth / 2
    const frameTop = apertureCenterY - frameHeight / 2
    const artworkScale = 2560 / frameWidth
    const frameRight = layout.monitorLeft + (frameLeft + frameWidth) * artworkScale
    const frameBottom = layout.monitorTop + (frameTop + frameHeight) * artworkScale

    expect(apertureWidth).toBe(2454)
    expect(apertureHeight).toBe(1380)
    expect(frameWidth / frameHeight).toBe(16 / 9)
    expect((frameWidth - apertureWidth) / 2).toBe(5)
    expect((frameHeight - apertureHeight) / 2).toBe(3)
    expect(layout.terminalLeft + layout.terminalWidth / 2).toBe(0)
    expect(layout.terminalTop + layout.terminalHeight / 2).toBe(0)
    expect(layout.monitorLeft).toBeCloseTo(-apertureCenterX * artworkScale, 12)
    expect(layout.monitorTop).toBeCloseTo(-apertureCenterY * artworkScale, 12)
    expect(layout.monitorWidth).toBeCloseTo(3000 * artworkScale, 10)
    expect(layout.monitorHeight).toBeCloseTo(1740 * artworkScale, 10)
    expect(layout.monitorWidth / 3000).toBeCloseTo(layout.monitorHeight / 1740, 12)
    expect(layout.monitorLeft + frameLeft * artworkScale).toBeCloseTo(layout.terminalLeft, 12)
    expect(layout.monitorTop + frameTop * artworkScale).toBeCloseTo(layout.terminalTop, 12)
    expect(frameRight).toBeCloseTo(layout.terminalLeft + layout.terminalWidth, 12)
    expect(frameBottom).toBeCloseTo(layout.terminalTop + layout.terminalHeight, 12)
    expect(layout.windowInset).toBe(64)
  })
})

describe('original SDK visual styling', () => {
  test('derives the original stable monitor filter from the configured background', () => {
    expect(monitorBezelFilter('#808080')).toEqual({
      brightness: 1.073,
      contrast: 1.05,
      hueRotation: 0,
      saturation: 1,
      sepia: 0,
    })
  })

  test('applies the CSS noise visibility directly as opacity', () => {
    const variables = crtEffectStyleVariables()

    expect(variables['--crt-noise-opacity']).toBe(0.025)
    expect(Object.keys(variables)).toEqual(['--crt-noise-opacity'])
  })
})

describe('responsive uniform scaling', () => {
  const layout = presentationLayout(false)

  test('fits exact, wide, tall, portrait, and fullscreen-sized containers', () => {
    expect(scaleStageToFit(2560, 1440, layout)).toBe(1)
    expect(scaleStageToFit(1920, 800, layout)).toBeCloseTo(800 / 1440, 10)
    expect(scaleStageToFit(1200, 900, layout)).toBeCloseTo(1200 / 2560, 10)
    expect(scaleStageToFit(900, 1200, layout)).toBeCloseTo(900 / 2560, 10)
    expect(scaleStageToFit(1536, 864, layout)).toBeCloseTo(1536 / 2560, 10)
  })

  test('collapses safely when either host dimension is unavailable', () => {
    expect(scaleStageToFit(0, 1440, layout)).toBe(0)
    expect(scaleStageToFit(2560, 0, layout)).toBe(0)
    expect(scaleStageToFit(-1, 1440, layout)).toBe(0)
  })

  test('keeps the original 64px minimum monitor inset at common 16:9 sizes', () => {
    const monitorLayout = presentationLayout(true)
    const scale = scaleStageToFit(1920, 1080, monitorLayout)
    const horizontalGap = (1920 - 2560 * scale) / 2
    const verticalGap = (1080 - 1440 * scale) / 2

    expect(Math.min(horizontalGap, verticalGap)).toBeCloseTo(64, 10)
    expect(horizontalGap).toBeGreaterThanOrEqual(64)
    expect(verticalGap).toBeGreaterThanOrEqual(64)
  })

  test('keeps the terminal perfectly centered with the 64px inset across target window shapes', () => {
    const monitorLayout = presentationLayout(true)

    for (const [width, height] of [
      [1536, 864],
      [1200, 900],
      [1920, 800],
      [900, 1200],
      [2560, 1440],
    ]) {
      const scale = scaleStageToFit(width, height, monitorLayout)
      const left = width / 2 + monitorLayout.terminalLeft * scale
      const top = height / 2 + monitorLayout.terminalTop * scale
      const renderedWidth = monitorLayout.terminalWidth * scale
      const renderedHeight = monitorLayout.terminalHeight * scale
      const right = width - left - renderedWidth
      const bottom = height - top - renderedHeight

      expect(left + renderedWidth / 2).toBeCloseTo(width / 2, 10)
      expect(top + renderedHeight / 2).toBeCloseTo(height / 2, 10)
      expect(Math.min(left, top, right, bottom)).toBeCloseTo(64, 10)
      expect(left).toBeGreaterThanOrEqual(64)
      expect(top).toBeGreaterThanOrEqual(64)
      expect(right).toBeGreaterThanOrEqual(64)
      expect(bottom).toBeGreaterThanOrEqual(64)
    }
  })
})

describe('streamlined visual asset and markup contract', () => {
  test('retains one monitor, one noise texture, and the licensed local font', async () => {
    const assets = (await readdir(resolve(import.meta.dir, '../src/assets'))).sort()
    expect(assets).toEqual(['crt-noise.png', 'font-OFL.txt', 'font.ttf', 'monitor-overlay.webp'])
  })

  test('keeps only noise in CSS and leaves curved scanlines to WebGL', async () => {
    const [html, css] = await Promise.all([
      readFile(resolve(import.meta.dir, '../index.html'), 'utf8'),
      readFile(resolve(import.meta.dir, '../src/styles.css'), 'utf8'),
    ])

    expect(html.match(/id="crt-noise"/g)).toHaveLength(1)
    expect(html.match(/id="renderer-status"/g)).toHaveLength(1)
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-live="assertive"')
    expect(html).toContain('aria-atomic="true"')
    expect(html).not.toContain('id="crt-sweep"')
    expect(html).not.toContain('<canvas')
    expect(html).not.toContain('monitor-surround')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('[hidden]')
    expect(css).toContain('animation: crt-noise-shift 133.467ms steps(1, end) infinite')
    expect(css).toContain('inset: -96px')
    expect(css).toContain('transform: translate3d(83px, -37px, 0)')
    expect(css).not.toContain('#crt-effects::before')
    expect(css).not.toContain('repeating-linear-gradient')
    expect(css).not.toContain('crt-scanline')
    expect(css).toContain('background-size: 128px 128px')
    expect(css.match(/--crt-noise-opacity/g)).toHaveLength(1)
    expect(css).not.toContain('will-change: transform, opacity')
    expect(css).not.toMatch(/translate3d\([^)]*%/)
    expect(css).not.toContain('crt-scanline-drift')
    expect(css).not.toContain('crt-flicker')
    expect(css).not.toContain('crt-sweep')
    expect(css).not.toContain('#crt-effects::after')
    expect(css).not.toContain('radial-gradient')
    expect(css).not.toContain('box-shadow: inset')
    expect(css).toContain('brightness(var(--monitor-bezel-brightness))')
    expect(css.match(/monitor-overlay\.webp/g)).toHaveLength(1)
    expect(css).toContain('#renderer-status')
    expect(css).toContain('z-index: 4')
    expect(css).toContain('align-items: flex-end')
    expect(css).not.toContain('monitor-mirrored')
  })
})
