import { describe, expect, test } from 'bun:test'
import { readSidecarRuntimeConfig } from '../../src/runtime/config'

const validEnvironment = {
  TUI_SIDECAR_DIAGNOSTICS: '1',
  TUI_SIDECAR_INSTANCE_ID: ' instance-1 ',
  TUI_SIDECAR_PORT: '4312',
  TUI_SIDECAR_TOKEN: ' secret ',
}

describe('sidecar runtime config', () => {
  test('reads and validates the sidecar environment', () => {
    expect(readSidecarRuntimeConfig(validEnvironment)).toEqual({
      clientToken: 'secret',
      diagnosticsEnabled: true,
      instanceId: 'instance-1',
      port: 4312,
    })
  })

  test('requires the instance ID and client token', () => {
    expect(() =>
      readSidecarRuntimeConfig({ ...validEnvironment, TUI_SIDECAR_INSTANCE_ID: ' ' }),
    ).toThrow('TUI_SIDECAR_INSTANCE_ID is required')
    expect(() =>
      readSidecarRuntimeConfig({ ...validEnvironment, TUI_SIDECAR_TOKEN: undefined }),
    ).toThrow('TUI_SIDECAR_TOKEN is required')
  })

  test.each(['0', '65536', '1.5', 'not-a-number'])('rejects invalid TCP port %s', (port) => {
    expect(() => readSidecarRuntimeConfig({ ...validEnvironment, TUI_SIDECAR_PORT: port })).toThrow(
      'TUI_SIDECAR_PORT must be a valid TCP port',
    )
  })
})
