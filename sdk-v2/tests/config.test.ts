import { describe, expect, test } from 'bun:test'
import { getTermweaveConfig, parseAppConfig, terminalSurface } from '../shared/config'
import { validAppConfig } from './fixtures'

describe('app configuration', () => {
  test('parses the complete default schema and derives the fixed grid', () => {
    expect(parseAppConfig(validAppConfig())).toEqual({
      ...validAppConfig(),
      terminalGrid: {
        cols: 320,
        rows: 180,
        fontSize: 8,
        width: 2560,
        height: 1440,
      },
    })
    expect(terminalSurface).toEqual({ width: 2560, height: 1440 })
  })

  test('requires an object root', () => {
    for (const value of [null, [], 'config', 1]) {
      expect(() => parseAppConfig(value)).toThrow('root must be an object')
    }
  })

  test('requires non-empty name and description strings after trimming', () => {
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

  test('accepts only lowercase kebab-case package names beginning with a letter', () => {
    for (const packageName of ['termweave', 'termweave2', 'termweave-app-2']) {
      expect(parseAppConfig(validAppConfig({ packageName })).packageName).toBe(packageName)
    }
    for (const packageName of ['Termweave', '2termweave', 'term_weave', 'term--weave', 'term-']) {
      expect(() => parseAppConfig(validAppConfig({ packageName }))).toThrow('packageName')
    }
  })

  test('requires a reverse-domain bundle identifier with at least two segments', () => {
    for (const bundleIdentifier of ['com.example.app', 'io.example-2.app']) {
      expect(parseAppConfig(validAppConfig({ bundleIdentifier })).bundleIdentifier).toBe(
        bundleIdentifier,
      )
    }
    for (const bundleIdentifier of ['termweave', '.example.app', 'com..app', 'com.-example']) {
      expect(() => parseAppConfig(validAppConfig({ bundleIdentifier }))).toThrow('bundleIdentifier')
    }
  })

  test('accepts complete semantic versions including prerelease and build suffixes', () => {
    for (const version of ['0.1.0', '1.2.3-alpha.1', '1.2.3+build.9', '1.2.3-rc.1+build.9']) {
      expect(parseAppConfig(validAppConfig({ version })).version).toBe(version)
    }
    for (const version of ['1', '1.2', '01.2.3', '1.2.3-', '1.2.3-01', '1.2.3+']) {
      expect(() => parseAppConfig(validAppConfig({ version }))).toThrow('version')
    }
  })

  test('requires a finite font size greater than zero', () => {
    for (const fontSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '8']) {
      expect(() => parseAppConfig(validAppConfig({ fontSize }))).toThrow('fontSize')
    }
  })

  test('requires font size to produce whole rows and columns', () => {
    expect(() => parseAppConfig(validAppConfig({ fontSize: 7 }))).toThrow(
      'must divide the fixed 2560x1440 terminal surface',
    )
    expect(parseAppConfig(validAppConfig({ fontSize: 16 })).terminalGrid).toEqual({
      cols: 160,
      rows: 90,
      fontSize: 16,
      width: 2560,
      height: 1440,
    })
  })

  test('requires six-digit hexadecimal colors', () => {
    for (const field of ['backgroundColor', 'foregroundColor'] as const) {
      for (const value of ['#abcdef', '#ABCDEF', '#012345']) {
        expect(parseAppConfig(validAppConfig({ [field]: value }))[field]).toBe(value)
      }
      for (const value of ['abcdef', '#fff', '#gg0000', '#12345678', true]) {
        expect(() => parseAppConfig(validAppConfig({ [field]: value }))).toThrow(field)
      }
    }
  })

  test('requires boolean monitor and CRT flags', () => {
    for (const field of ['monitorOverlay', 'crtEffects'] as const) {
      expect(parseAppConfig(validAppConfig({ [field]: false }))[field]).toBe(false)
      for (const value of [0, 'false', null]) {
        expect(() => parseAppConfig(validAppConfig({ [field]: value }))).toThrow(
          `${field} must be a boolean`,
        )
      }
    }
  })

  test('accepts project-relative PNG and SVG icon paths and normalizes safe segments', () => {
    expect(parseAppConfig(validAppConfig({ icon: 'app.icon.png' })).icon).toBe('app.icon.png')
    expect(parseAppConfig(validAppConfig({ icon: 'assets\\icon.SVG' })).icon).toBe(
      'assets/icon.SVG',
    )
    expect(parseAppConfig(validAppConfig({ icon: 'assets/../app.icon.png' })).icon).toBe(
      'app.icon.png',
    )
  })

  test('rejects empty, unsupported, absolute, URL, and root-escaping icon paths', () => {
    for (const icon of [
      '',
      '   ',
      'icon.jpg',
      '/tmp/icon.png',
      'C:\\icons\\icon.png',
      '\\\\server\\icon.png',
      'https://example.com/icon.png',
      'file:icon.png',
      '../icon.png',
      'assets/../../icon.png',
    ]) {
      expect(() => parseAppConfig(validAppConfig({ icon }))).toThrow('icon')
    }
  })

  test('ignores unknown fields and returns frozen configuration views', () => {
    const parsed = parseAppConfig(validAppConfig({ extra: 'ignored' }))
    expect('extra' in parsed).toBe(false)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.authors)).toBe(true)
    expect(Object.isFrozen(parsed.terminalGrid)).toBe(true)

    const publicConfig = getTermweaveConfig()
    expect(publicConfig).toEqual({
      backgroundColor: '#010416',
      foregroundColor: '#F59B5A',
      terminalGrid: {
        cols: 128,
        rows: 72,
        fontSize: 20,
        width: 2560,
        height: 1440,
      },
    })
    expect(Object.isFrozen(publicConfig)).toBe(true)
    expect(Object.keys(publicConfig).sort()).toEqual([
      'backgroundColor',
      'foregroundColor',
      'terminalGrid',
    ])
  })
})
