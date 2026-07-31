export function validAppConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Termweave App',
    description: 'A terminal desktop application built with Termweave.',
    packageName: 'termweave-app',
    bundleIdentifier: 'com.example.termweave-app',
    version: '0.1.0',
    authors: ['Example Author'],
    fontSize: 8,
    backgroundColor: '#010416',
    foregroundColor: '#F59B5A',
    monitorOverlay: true,
    crtEffects: true,
    icon: 'app.icon.png',
    ...overrides,
  }
}
