import { describe, expect, test } from 'bun:test'
import { parseAppConfig, resolveAppIcon } from '../../../scripts/app/app-config'
import { validAppConfig } from '../../helpers/app-config'

describe('app config', () => {
  test('parses the complete supported schema', () => {
    expect(parseAppConfig(validAppConfig())).toEqual(validAppConfig())
  })

  test('reports the supported migration for an old schema', () => {
    const config = { ...validAppConfig() } as Record<string, unknown>
    delete config.monitorOverlay
    expect(() => parseAppConfig(config)).toThrow('outdated configuration schema')
  })

  test('requires an exact 16:9 terminal grid', () => {
    expect(() => parseAppConfig(validAppConfig({ windowHeight: 1000 }))).toThrow(
      'exact 16:9 aspect ratio',
    )
  })

  test('keeps icons inside the project root and outside reserved directories', () => {
    expect(resolveAppIcon('/tmp/example', 'assets/icon.svg').icon).toBe('assets/icon.svg')
    expect(() => resolveAppIcon('/tmp/example', '../icon.png')).toThrow('project-relative')
    expect(() => resolveAppIcon('/tmp/example', 'src/icon.png')).toThrow('reserved src')
    expect(() => resolveAppIcon('/tmp/example', 'icon.jpg')).toThrow('SVG or PNG')
  })
})
