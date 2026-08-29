import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function decode(base64: string) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

// Small committed samples keep tests independent from image-generation packages.
const transparentRedPng = decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAE0lEQVR4AWP8z8DQwIAEmBjQAAAwRQGDGywTzgAAAABJRU5ErkJggg==',
)
const opaqueJpeg = decode(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAwAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAwADAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+R6KKK+sPlz/2Q==',
)
const opaqueBrownPng = decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAE0lEQVR4AWMUVDL+z4AEmBjQAAAq5gFpzqk6YgAAAABJRU5ErkJggg==',
)
export const opaqueSquarePng = decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAF0lEQVR4AWN0CU37zwAFTAxIgIkBCQAASDICBK8kmgMAAAAASUVORK5CYII=',
)
export const twoFrameGif = decode(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAABAAAALAAAAAABAAEAAAIBTAAh+QQAAQAAACwAAAAAAQABAAACAUwAOw==',
)
const disposalGif = decode(
  'R0lGODlhAgABAIAAAAAAAP8AACH5BAgFAAAALAAAAAABAAEAAAICTAEAIfkEBAUAAAAsAQAAAAEAAQAAAgJMAQA7',
)

const ffmpegTargets: Record<string, string> = {
  'darwin:arm64': 'ffmpeg-aarch64-apple-darwin',
  'darwin:x64': 'ffmpeg-x86_64-apple-darwin',
  'linux:arm64': 'ffmpeg-aarch64-unknown-linux-gnu',
  'linux:x64': 'ffmpeg-x86_64-unknown-linux-gnu',
  'win32:x64': 'ffmpeg-x86_64-pc-windows-msvc.exe',
}

export function testFfmpegPath() {
  const name = ffmpegTargets[`${process.platform}:${process.arch}`]
  if (!name) throw new Error(`No test FFmpeg target for ${process.platform}/${process.arch}.`)
  return resolve(import.meta.dir, '../../src-tauri/binaries', name)
}

export interface MediaFixtures {
  directory: string
  brownPngPath: string
  corruptPngPath: string
  disposalGifPath: string
  gifPath: string
  jpegPath: string
  squarePngPath: string
  transparentPngPath: string
  cleanup(): Promise<void>
}

export async function createMediaFixtures(
  prefix = 'termweave-media-test-',
): Promise<MediaFixtures> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  const paths = {
    brownPngPath: join(directory, 'brown.data'),
    corruptPngPath: join(directory, 'corrupt.data'),
    disposalGifPath: join(directory, 'disposal.data'),
    gifPath: join(directory, 'animation.data'),
    jpegPath: join(directory, 'photo.data'),
    squarePngPath: join(directory, 'square.data'),
    transparentPngPath: join(directory, 'transparent.data'),
  }
  await Promise.all([
    Bun.write(paths.brownPngPath, opaqueBrownPng),
    Bun.write(paths.corruptPngPath, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0)),
    Bun.write(paths.disposalGifPath, disposalGif),
    Bun.write(paths.gifPath, twoFrameGif),
    Bun.write(paths.jpegPath, opaqueJpeg),
    Bun.write(paths.squarePngPath, opaqueSquarePng),
    Bun.write(paths.transparentPngPath, transparentRedPng),
  ])
  return {
    directory,
    ...paths,
    cleanup: () => rm(directory, { force: true, recursive: true }),
  }
}
