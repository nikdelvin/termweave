import { describe, expect, test } from 'bun:test'
import {
  MONITOR_OVERLAY_ENABLED,
  SIDECAR_PROTOCOL,
  TERMINAL_GRID,
} from '../../shared/terminal-config'
import {
  MIN_HORIZONTAL_BEZEL_PX,
  MIN_VERTICAL_BEZEL_PX,
  monitorBezelFilter,
  terminalScale,
} from '../../src/runtime/monitor-layout'
import {
  parseSidecarAuthenticated,
  parseSidecarHello,
  parseSidecarTextMessage,
  sidecarIdentityMatches,
  sidecarSocketUrl,
  type FrontendRuntime,
} from '../../src/runtime/sidecar-protocol'

const runtime: FrontendRuntime = {
  debugBuild: false,
  os: 'macos',
  arch: 'aarch64',
  executable: '/app',
  currentDirectory: '/project',
  instanceId: 'instance-1',
  sidecarToken: 'secret',
  sidecarPort: 4312,
}

describe('frontend layout', () => {
  test('fits the fixed terminal surface inside the configured monitor margins', () => {
    expect(
      terminalScale(
        TERMINAL_GRID.targetWidth + MIN_HORIZONTAL_BEZEL_PX * 2,
        TERMINAL_GRID.targetHeight + MIN_VERTICAL_BEZEL_PX * 2,
      ),
    ).toBe(1)
    expect(
      terminalScale(
        TERMINAL_GRID.targetWidth / 2 + MIN_HORIZONTAL_BEZEL_PX * 2,
        TERMINAL_GRID.targetHeight / 2 + MIN_VERTICAL_BEZEL_PX * 2,
      ),
    ).toBe(0.5)

    const expectedSmallScale = MONITOR_OVERLAY_ENABLED
      ? 0
      : Math.min(100 / TERMINAL_GRID.targetWidth, 100 / TERMINAL_GRID.targetHeight)
    expect(terminalScale(100, 100)).toBe(expectedSmallScale)
  })

  test('derives a stable monitor filter from the configured color', () => {
    expect(monitorBezelFilter('#808080')).toEqual({
      brightness: 1.073,
      contrast: 1.05,
      hueRotation: 0,
      saturation: 1,
      sepia: 0,
    })
  })
})

describe('frontend sidecar protocol', () => {
  test('parses and verifies the sidecar identity handshake', () => {
    const hello = parseSidecarHello(
      JSON.stringify({
        type: 'hello',
        protocol: SIDECAR_PROTOCOL.name,
        version: SIDECAR_PROTOCOL.version,
        instanceId: runtime.instanceId,
        port: runtime.sidecarPort,
      }),
    )

    expect(hello).toBeDefined()
    expect(sidecarIdentityMatches(hello!, runtime)).toBeTrue()
    expect(sidecarSocketUrl(runtime)).toBe('ws://127.0.0.1:4312/terminal')
  })

  test('rejects malformed and mismatched identity handshakes', () => {
    expect(parseSidecarHello('invalid JSON')).toBeUndefined()
    expect(parseSidecarHello('{"type":"hello","port":"4312"}')).toBeUndefined()

    const hello = parseSidecarHello(
      JSON.stringify({
        type: 'hello',
        protocol: SIDECAR_PROTOCOL.name,
        version: SIDECAR_PROTOCOL.version,
        instanceId: 'another-instance',
        port: runtime.sidecarPort,
      }),
    )
    expect(sidecarIdentityMatches(hello!, runtime)).toBeFalse()
  })

  test('parses authenticated and supported text messages', () => {
    expect(parseSidecarAuthenticated('{"type":"authenticated"}')).toEqual({
      type: 'authenticated',
    })
    expect(parseSidecarAuthenticated('{"type":"other"}')).toBeUndefined()
    expect(parseSidecarTextMessage('{"type":"diagnostic","line":"ready"}')).toEqual({
      type: 'diagnostic',
      line: 'ready',
    })
    expect(parseSidecarTextMessage('{"type":"exit-requested"}')).toEqual({
      type: 'exit-requested',
    })
    expect(parseSidecarTextMessage('terminal text')).toBeUndefined()
  })
})
