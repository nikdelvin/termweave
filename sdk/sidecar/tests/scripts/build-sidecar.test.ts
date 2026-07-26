import { expect, test } from 'bun:test'
import ffmpegManifest from '../../ffmpeg-artifacts.json'
import { getFfmpegOutputPath } from '../../scripts/build-ffmpeg'
import { getSidecarOutputPath } from '../../scripts/build-sidecar'

test('uses the Tauri external-binary naming convention', () => {
  expect(getSidecarOutputPath('/sdk', 'aarch64-apple-darwin', 'darwin')).toBe(
    '/sdk/src-tauri/binaries/opentui-sidecar-aarch64-apple-darwin',
  )
  expect(getSidecarOutputPath('/sdk', 'x86_64-pc-windows-msvc', 'win32')).toBe(
    '/sdk/src-tauri/binaries/opentui-sidecar-x86_64-pc-windows-msvc.exe',
  )
})

test('uses a distinct Tauri external-binary name for FFmpeg', () => {
  expect(getFfmpegOutputPath('/sdk', 'aarch64-apple-darwin', 'darwin')).toBe(
    '/sdk/src-tauri/binaries/ffmpeg-aarch64-apple-darwin',
  )
  expect(getFfmpegOutputPath('/sdk', 'x86_64-pc-windows-msvc', 'win32')).toBe(
    '/sdk/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe',
  )
})

test('pins an LGPL-only FFmpeg source and configuration', () => {
  expect(ffmpegManifest.ffmpegVersion).toBe('8.1.2')
  expect(ffmpegManifest.source.sha256).toHaveLength(64)
  expect(ffmpegManifest.license).toBe('LGPL-2.1-or-later')
  expect(ffmpegManifest.configure).not.toContain('--enable-gpl')
  expect(ffmpegManifest.configure).not.toContain('--enable-nonfree')
  expect(ffmpegManifest.configure).toContain('--enable-decoder=aac')
  expect(ffmpegManifest.configure).toContain('--enable-decoder=h264')
  expect(ffmpegManifest.configure).toContain('--enable-encoder=flac')
  expect(ffmpegManifest.configure).toContain('--enable-muxer=flac')
  expect(ffmpegManifest.configure).toContain('--enable-swresample')
})
