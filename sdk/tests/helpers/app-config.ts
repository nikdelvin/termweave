import type { AppBuilderConfig } from '../../scripts/app/app-config'

export function validAppConfig(overrides: Partial<AppBuilderConfig> = {}): AppBuilderConfig {
  return {
    name: 'Example App',
    description: 'Example description.',
    packageName: 'example-app',
    bundleIdentifier: 'com.example.app',
    version: '1.2.3',
    authors: ['Example Author'],
    fontSize: 8,
    showDiagnostics: false,
    backgroundColor: '#010416',
    foregroundColor: '#F59B5A',
    monitorOverlay: true,
    crtEffects: true,
    icon: 'app.icon.png',
    ...overrides,
  }
}
