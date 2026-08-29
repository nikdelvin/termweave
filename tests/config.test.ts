import { describe, expect, test } from 'bun:test'
import { getTermweaveConfig, parseAppConfig } from '../termweave/config'
import {
  TERMINAL_FONT_SIZE,
  TERMINAL_FOREGROUND_COLOR,
  TERMINAL_GRID,
  TERMINAL_SURFACE,
} from '../termweave/constants'
import { validAppConfig } from './support/app-config'

describe('app configuration', () => {
  test('parses exactly the application-owned schema', () => {
    expect(parseAppConfig(validAppConfig())).toEqual(validAppConfig())
    expect(TERMINAL_SURFACE).toEqual({ width: 2560, height: 1440 })
    expect(TERMINAL_FONT_SIZE).toBe(20)
    expect(TERMINAL_GRID).toEqual({
      cols: 128,
      rows: 72,
      fontSize: 20,
      width: 2560,
      height: 1440,
    })
  })

  test('requires an object root', () => {
    for (const value of [null, [], 'config', 1]) {
      expect(() => parseAppConfig(value)).toThrow('root must be an object')
    }
  })

  test('requires non-empty name and description strings', () => {
    for (const field of ['name', 'description']) {
      for (const value of ['', '   ', 42]) {
        expect(() => parseAppConfig(validAppConfig({ [field]: value }))).toThrow(
          `${field} must be a non-empty string`,
        )
      }
    }
  })

  test('requires at least one non-empty author', () => {
    expect(() => parseAppConfig(validAppConfig({ authors: [] }))).toThrow(
      'authors must contain at least one author',
    )
    for (const authors of [[''], ['   '], ['Valid', 42], 'Author']) {
      expect(() => parseAppConfig(validAppConfig({ authors }))).toThrow('authors')
    }
  })

  test('validates package names, identifiers, and semantic versions', () => {
    for (const packageName of ['termweave', 'termweave2', 'termweave-app-2']) {
      expect(parseAppConfig(validAppConfig({ packageName })).packageName).toBe(packageName)
    }
    for (const packageName of ['Termweave', '2termweave', 'term_weave', 'term--weave']) {
      expect(() => parseAppConfig(validAppConfig({ packageName }))).toThrow('packageName')
    }

    for (const bundleIdentifier of ['com.example.app', 'io.example-2.app']) {
      expect(parseAppConfig(validAppConfig({ bundleIdentifier })).bundleIdentifier).toBe(
        bundleIdentifier,
      )
    }
    for (const bundleIdentifier of ['termweave', '.example.app', 'com..app']) {
      expect(() => parseAppConfig(validAppConfig({ bundleIdentifier }))).toThrow('bundleIdentifier')
    }

    for (const version of ['0.1.0', '1.2.3-alpha.1', '1.2.3+build.9']) {
      expect(parseAppConfig(validAppConfig({ version })).version).toBe(version)
    }
    for (const version of ['1', '1.2', '01.2.3', '1.2.3-']) {
      expect(() => parseAppConfig(validAppConfig({ version }))).toThrow('version')
    }
  })

  test('requires a six-digit theme color and never aliases backgroundColor', () => {
    for (const themeColor of ['#abcdef', '#ABCDEF', '#012345']) {
      expect(parseAppConfig(validAppConfig({ themeColor })).themeColor).toBe(themeColor)
    }
    for (const themeColor of ['abcdef', '#fff', '#gg0000', '#12345678', true]) {
      expect(() => parseAppConfig(validAppConfig({ themeColor }))).toThrow('themeColor')
    }

    const oldConfig: Record<string, unknown> = validAppConfig()
    delete oldConfig.themeColor
    oldConfig.backgroundColor = '#112233'
    expect(() => parseAppConfig(oldConfig)).toThrow('themeColor')
  })

  test('accepts safe PNG and SVG icon paths', () => {
    expect(parseAppConfig(validAppConfig({ icon: 'app.icon.png' })).icon).toBe('app.icon.png')
    expect(parseAppConfig(validAppConfig({ icon: 'assets\\icon.SVG' })).icon).toBe(
      'assets/icon.SVG',
    )
    expect(parseAppConfig(validAppConfig({ icon: 'assets/../app.icon.png' })).icon).toBe(
      'app.icon.png',
    )

    for (const icon of [
      '',
      'icon.jpg',
      '/tmp/icon.png',
      'C:\\icons\\icon.png',
      'https://example.com/icon.png',
      '../icon.png',
    ]) {
      expect(() => parseAppConfig(validAppConfig({ icon }))).toThrow('icon')
    }
  })

  test('ignores removed and unknown fields and returns frozen narrow views', () => {
    const parsed = parseAppConfig(
      validAppConfig({
        fontSize: 8,
        foregroundColor: '#FFFFFF',
        backgroundColor: '#112233',
        monitorOverlay: false,
        crtEffects: false,
        extra: 'ignored',
      }),
    )
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'authors',
        'bundleIdentifier',
        'description',
        'icon',
        'name',
        'packageName',
        'themeColor',
        'version',
      ].sort(),
    )
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.authors)).toBe(true)

    const publicConfig = getTermweaveConfig()
    expect(publicConfig).toEqual({
      themeColor: '#010416',
      terminalForegroundColor: TERMINAL_FOREGROUND_COLOR,
    })
    expect(Object.isFrozen(publicConfig)).toBe(true)
    expect(Object.keys(publicConfig).sort()).toEqual(['terminalForegroundColor', 'themeColor'])
  })
})
