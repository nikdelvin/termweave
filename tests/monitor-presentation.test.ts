import { describe, expect, test } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseAppConfig } from '../termweave/config'
import {
  calculateMonitorLayout,
  calculateStageScale,
  createMonitorPresentation,
  monitorBezelFilter,
} from '../termweave/host/monitor-presentation'
import { validAppConfig } from './support/app-config'

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
    hidden: false,
    style: fakeStyle(),
  }
}

describe('always-on presentation', () => {
  test('applies the theme, fixed foreground, monitor filter, geometry, and resize lifecycle', () => {
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
      const stage = fakeElement()
      const terminal = fakeElement()
      const effects = fakeElement()
      const monitor = fakeElement()
      const rendererStatus = fakeElement()
      const rendererStatusMessage = fakeElement()
      const elements = new Map([
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
      const config = parseAppConfig(validAppConfig({ themeColor: '#112233' }))
      const presentation = createMonitorPresentation(root as unknown as HTMLElement, config)

      expect(root.style.getPropertyValue('--termweave-theme-color')).toBe('#112233')
      expect(root.style.getPropertyValue('--termweave-terminal-foreground')).toBe('#F59B5A')
      expect(terminal.style.left).toBe('-1280px')
      expect(terminal.style.top).toBe('-720px')
      expect(terminal.style.width).toBe('2560px')
      expect(terminal.style.height).toBe('1440px')
      expect(effects.style.width).toBe('2560px')
      expect(effects.style.height).toBe('1440px')
      expect(monitor.hidden).toBe(false)
      expect(effects.hidden).toBe(false)
      expect(monitor.style.getPropertyValue('--monitor-bezel-hue')).not.toBe('')
      expect(stage.style.getPropertyValue('--termweave-stage-scale')).toBe(String(1072 / 2560))

      presentation.dispose()
      expect(disconnectCount).toBe(1)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
    }
  })
})

describe('fixed logical stage', () => {
  const layout = calculateMonitorLayout()

  test('positions the monitor around an exactly centered 2560x1440 terminal aperture', () => {
    const apertureWidth = 3000 - 268 - 278
    const apertureHeight = 1740 - 201 - 159
    const apertureCenterX = 268 + apertureWidth / 2
    const apertureCenterY = 201 + apertureHeight / 2
    const frameWidth = 2464
    const frameHeight = 1386
    const frameLeft = apertureCenterX - frameWidth / 2
    const frameTop = apertureCenterY - frameHeight / 2
    const artworkScale = 2560 / frameWidth

    expect(layout).toMatchObject({
      terminalLeft: -1280,
      terminalTop: -720,
      terminalWidth: 2560,
      terminalHeight: 1440,
      windowInset: 64,
    })
    expect(layout.monitorLeft).toBeCloseTo(-apertureCenterX * artworkScale, 12)
    expect(layout.monitorTop).toBeCloseTo(-apertureCenterY * artworkScale, 12)
    expect(layout.monitorLeft + frameLeft * artworkScale).toBeCloseTo(layout.terminalLeft, 12)
    expect(layout.monitorTop + frameTop * artworkScale).toBeCloseTo(layout.terminalTop, 12)
  })

  test('fits wide, tall, portrait, and fullscreen containers with the 64px inset', () => {
    for (const [width, height] of [
      [1536, 864],
      [1200, 900],
      [1920, 800],
      [900, 1200],
      [2560, 1440],
    ]) {
      const scale = calculateStageScale(width, height, layout)
      const left = width / 2 + layout.terminalLeft * scale
      const top = height / 2 + layout.terminalTop * scale
      const right = width - left - layout.terminalWidth * scale
      const bottom = height - top - layout.terminalHeight * scale
      expect(Math.min(left, top, right, bottom)).toBeCloseTo(64, 10)
    }
  })

  test('collapses safely when either host dimension is unavailable', () => {
    expect(calculateStageScale(0, 1440, layout)).toBe(0)
    expect(calculateStageScale(2560, 0, layout)).toBe(0)
    expect(calculateStageScale(-1, 1440, layout)).toBe(0)
  })
})

describe('visual styling and assets', () => {
  test('derives the stable monitor filter from the application theme', () => {
    expect(monitorBezelFilter('#808080')).toEqual({
      brightness: 1.073,
      contrast: 1.05,
      hueRotation: 0,
      saturation: 1,
      sepia: 0,
    })
  })

  test('retains one monitor, one noise texture, and the licensed local font', async () => {
    const assets = (await readdir(resolve(import.meta.dir, '../termweave/host/assets'))).sort()
    const crtAssets = (
      await readdir(resolve(import.meta.dir, '../termweave/host/crt-effects/assets'))
    ).sort()
    expect(assets).toEqual(['font-OFL.txt', 'font.ttf', 'monitor-overlay.webp'])
    expect(crtAssets).toEqual(['crt-noise.png'])
  })

  test('keeps monitor and noise always visible while reduced motion freezes only animation', async () => {
    const [html, webviewCss, crtCss] = await Promise.all([
      readFile(resolve(import.meta.dir, '../index.html'), 'utf8'),
      readFile(resolve(import.meta.dir, '../termweave/host/webview-styles.css'), 'utf8'),
      readFile(resolve(import.meta.dir, '../termweave/host/crt-effects/crt-styles.css'), 'utf8'),
    ])
    const css = `${webviewCss}\n${crtCss}`

    expect(html).toContain('<div id="crt-effects" aria-hidden="true">')
    expect(html).toContain('<div id="monitor-overlay" aria-hidden="true"></div>')
    expect(html).toContain('src="/termweave/host/webview-entry.ts"')
    expect(html).not.toMatch(/id="(?:crt-effects|monitor-overlay)"[^>]*\shidden(?:\s|>)/)
    expect(css).toContain('opacity: 0.025')
    expect(css.match(/0\.025/g)).toHaveLength(1)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation: none')
    expect(css).toContain('animation: crt-noise-shift 133.467ms steps(1, end) infinite')
    expect(css).not.toContain('--crt-noise-opacity')
    expect(css).not.toContain('repeating-linear-gradient')
    expect(css).not.toContain('crt-scanline')
    expect(css.match(/monitor-overlay\.webp/g)).toHaveLength(1)
  })
})
