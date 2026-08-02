import { describe, expect, test } from 'bun:test'
import capabilities from '../src-tauri/capabilities/default.json'
import tauriConfig from '../src-tauri/tauri.conf.json'

describe('Tauri Phase 2 configuration', () => {
  test('bundles exactly the OpenTUI sidecar and permits only scoped process operations', () => {
    expect(tauriConfig.bundle.externalBin).toEqual(['binaries/opentui-sidecar'])
    expect(capabilities.permissions).toEqual([
      'core:default',
      'core:window:allow-close',
      'core:window:allow-show',
      'core:window:allow-set-focus',
      {
        identifier: 'shell:allow-spawn',
        allow: [{ name: 'binaries/opentui-sidecar', sidecar: true }],
      },
      'shell:allow-stdin-write',
      'shell:allow-kill',
    ])
    expect(JSON.stringify(capabilities)).not.toContain('shell:allow-execute')
  })

  test('allows bundled content and Tauri IPC without remote or loopback transport sources', () => {
    const csp = tauriConfig.app.security.csp
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain('ipc: http://ipc.localhost')
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).not.toMatch(/wss?:|127\.0\.0\.1|localhost:\d/)
  })
})
