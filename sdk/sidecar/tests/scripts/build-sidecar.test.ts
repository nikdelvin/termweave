import { expect, test } from 'bun:test'
import { getSidecarOutputPath } from '../../scripts/build-sidecar'

test('uses the Tauri external-binary naming convention', () => {
  expect(getSidecarOutputPath('/sdk', 'aarch64-apple-darwin', 'darwin')).toBe(
    '/sdk/src-tauri/binaries/opentui-sidecar-aarch64-apple-darwin',
  )
  expect(getSidecarOutputPath('/sdk', 'x86_64-pc-windows-msvc', 'win32')).toBe(
    '/sdk/src-tauri/binaries/opentui-sidecar-x86_64-pc-windows-msvc.exe',
  )
})
