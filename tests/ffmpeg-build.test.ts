import { describe, expect, test } from 'bun:test'
import ffmpegManifest from '../ffmpeg-artifacts.json'
import { getFfmpegOutputPath } from '../scripts/build-ffmpeg'

describe('bundled FFmpeg manifest', () => {
  test('pins an LGPL source, both macOS targets, HTTPS, codecs, and raw outputs', () => {
    expect(ffmpegManifest.ffmpegVersion).toBe('8.1.2')
    expect(ffmpegManifest.source.sha256).toHaveLength(64)
    expect(ffmpegManifest.license).toBe('LGPL-2.1-or-later')
    expect(Object.keys(ffmpegManifest.targets).sort()).toEqual([
      'aarch64-apple-darwin',
      'x86_64-apple-darwin',
    ])
    for (const flag of [
      '--enable-securetransport',
      '--enable-zlib',
      '--enable-protocol=https',
      '--enable-decoder=aac',
      '--enable-decoder=h264',
      '--enable-decoder=hevc',
      '--enable-decoder=gif',
      '--enable-decoder=png',
      '--enable-decoder=mjpeg',
      '--enable-encoder=flac',
      '--enable-muxer=rawvideo',
      '--enable-videotoolbox',
    ]) {
      expect(ffmpegManifest.configure).toContain(flag)
    }
    expect(ffmpegManifest.configure).not.toContain('--enable-gpl')
    expect(ffmpegManifest.configure).not.toContain('--enable-nonfree')
  })

  test('uses distinct Tauri external-binary names', () => {
    expect(getFfmpegOutputPath('/sdk', 'aarch64-apple-darwin', 'darwin')).toBe(
      '/sdk/src-tauri/binaries/ffmpeg-aarch64-apple-darwin',
    )
    expect(getFfmpegOutputPath('/sdk', 'x86_64-apple-darwin', 'darwin')).toBe(
      '/sdk/src-tauri/binaries/ffmpeg-x86_64-apple-darwin',
    )
  })
})
