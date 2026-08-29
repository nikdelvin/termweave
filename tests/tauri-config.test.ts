import { describe, expect, test } from 'bun:test'
import packageManifest from '../package.json'
import { getOpenTuiNativeAsset } from '../scripts/prepare'
import capabilities from '../src-tauri/capabilities/default.json'
import tauriConfig from '../src-tauri/tauri.conf.json'
import { OPENTUI_ASSET_ROOT_DIRECTORY } from '../termweave/constants'

describe('Tauri runtime configuration', () => {
  test('keeps tracked metadata SDK-owned until the generated application override is applied', () => {
    expect(tauriConfig.productName).toBe('Termweave SDK Runtime')
    expect(tauriConfig.version).toBe('2.0.0')
    expect(tauriConfig.identifier).toBe('dev.termweave.sdk')
    expect(tauriConfig.app.windows[0]?.title).toBe('Termweave SDK Runtime')
    expect(tauriConfig.app.windows[0]).not.toHaveProperty('backgroundColor')
    expect(tauriConfig.bundle.icon).toEqual(['../termweave/host/crt-effects/assets/crt-noise.png'])
  })

  test('bundles the OpenTUI and FFmpeg sidecars while permitting only scoped host operations', () => {
    expect(tauriConfig.bundle.externalBin).toEqual(['binaries/opentui-sidecar', 'binaries/ffmpeg'])
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

  test('uses one packaged root for the prepared OpenTUI native library', () => {
    const nativeLibrary = getOpenTuiNativeAsset('/sdk', 'darwin', 'arm64')
    expect(nativeLibrary.resourcePath).toBe(
      `${OPENTUI_ASSET_ROOT_DIRECTORY}/@opentui/core-darwin-arm64/libopentui.dylib`,
    )
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
