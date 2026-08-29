import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import ffmpegManifest from '../ffmpeg-artifacts.json'
import { getFfmpegOutputPath } from '../scripts/build-ffmpeg'
import { testFfmpegPath } from './support/media-fixtures'

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
      '--enable-parser=gif',
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

  test('the built artifact decodes all eight committed campfire GIF frames', async () => {
    const child = Bun.spawn(
      [
        testFfmpegPath(),
        '-v',
        'error',
        '-f',
        'gif',
        '-i',
        resolve(import.meta.dir, '../app/assets/campfire.gif'),
        '-map',
        '0:v:0',
        '-an',
        '-c:v',
        'rawvideo',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        'pipe:1',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [exitCode, output, diagnostic] = await Promise.all([
      child.exited,
      new Response(child.stdout).arrayBuffer(),
      new Response(child.stderr).text(),
    ])
    expect(diagnostic).toBe('')
    expect(exitCode).toBe(0)
    expect(output.byteLength).toBe(8 * 768 * 432 * 4)
  })
})
