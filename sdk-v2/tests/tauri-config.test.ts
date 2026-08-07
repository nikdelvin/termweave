import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import packageManifest from '../package.json'
import capabilities from '../src-tauri/capabilities/default.json'
import tauriConfig from '../src-tauri/tauri.conf.json'

describe('Tauri runtime configuration', () => {
  test('keeps tracked metadata SDK-owned until the generated application override is applied', () => {
    expect(tauriConfig.productName).toBe('Termweave SDK Runtime')
    expect(tauriConfig.version).toBe('2.0.0')
    expect(tauriConfig.identifier).toBe('dev.termweave.sdk')
    expect(tauriConfig.app.windows[0]?.title).toBe('Termweave SDK Runtime')
    expect(tauriConfig.app.windows[0]).not.toHaveProperty('backgroundColor')
    expect(tauriConfig.bundle.icon).toEqual(['../termweave/host/assets/crt-noise.png'])
  })

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

  test('passes the packaged OpenTUI native-asset root to the sidecar', async () => {
    const [main, prepare] = await Promise.all([
      readFile(new URL('../termweave/host/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../scripts/prepare.ts', import.meta.url), 'utf8'),
    ])

    expect(prepare).toContain('[nativeAsset.sourcePath]: nativeAsset.resourcePath')
    expect(main).toContain('await join(await resourceDir(), OPENTUI_ASSET_ROOT_DIRECTORY)')
    expect(main).toContain("env: { DEBUG: '', OTUI_ASSET_ROOT: opentuiAssetRoot }")
  })
})

describe('Tauri development command', () => {
  test('builds the development launcher before starting Tauri', () => {
    expect(packageManifest.scripts.dev).toBe(
      'bun run prepare && bun scripts/build-sidecar.ts development && tauri dev --config src-tauri/.generated/override.json',
    )
    expect(packageManifest.scripts['sidecar:build']).toBe('bun scripts/build-sidecar.ts')
  })
})
