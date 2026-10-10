import { describe, expect, test } from 'bun:test'
import { getAppConfig, getTermweaveConfig, parseAppConfig } from '../termweave/config'

const validConfig = {
  name: 'Termweave App',
  description: 'A terminal desktop application built with Termweave.',
  packageName: 'termweave-app',
  bundleIdentifier: 'com.example.termweave-app',
  version: '0.1.0',
  author: 'Example Author',
  themeColor: '#010416',
  icon: 'app.icon.png',
}

describe('app.config.json validation', () => {
  test('parses and freezes a complete valid configuration', () => {
    const config = parseAppConfig(validConfig)
    expect(config).toEqual(validConfig)
    expect(Object.isFrozen(config)).toBe(true)
  })

  test('exposes the runtime Termweave configuration', () => {
    expect(getAppConfig().name).toBe('Termweave App')
    expect(getTermweaveConfig()).toEqual({
      themeColor: '#010416',
      terminalForegroundColor: '#F59B5A',
    })
  })

  test('rejects malformed fields', () => {
    expect(() => parseAppConfig({ ...validConfig, themeColor: 'red' })).toThrow(/themeColor/)
    expect(() => parseAppConfig({ ...validConfig, themeColor: '#12345' })).toThrow(/themeColor/)
    expect(() => parseAppConfig({ ...validConfig, version: '1.0' })).toThrow(/version/)
    expect(() => parseAppConfig({ ...validConfig, bundleIdentifier: 'termweave' })).toThrow(
      /bundleIdentifier/,
    )
    expect(() => parseAppConfig({ ...validConfig, packageName: 'MyApp' })).toThrow(/packageName/)
    expect(() => parseAppConfig({ ...validConfig, author: '' })).toThrow(/author/)
    expect(() => parseAppConfig({ ...validConfig, name: 42 })).toThrow(/name/)
  })

  test('rejects unsafe or unsupported icon paths', () => {
    expect(() => parseAppConfig({ ...validConfig, icon: '/etc/passwd.png' })).toThrow(/icon/)
    expect(() => parseAppConfig({ ...validConfig, icon: '../outside.png' })).toThrow(/icon/)
    expect(() => parseAppConfig({ ...validConfig, icon: 'photo.jpg' })).toThrow(/icon/)
  })
})
