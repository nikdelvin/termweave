import { mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { isRemoteUri } from './media-uri'
import type { Dimensions, Frame, Rgb } from './pixel-image'

const MAX_FFMPEG_ERROR_LENGTH = 8_192

export interface VideoFrame extends Frame {
  frameIndex: number
  pixelFormat: 'bgra'
  release: () => void
}

export interface VideoFrameStreamOptions extends Dimensions {
  background: Rgb
  ffmpegPath?: string
  framesPerSecond: number
  signal: AbortSignal
  uri: string
}

export interface VideoAudioStreamOptions {
  ffmpegPath?: string
  signal: AbortSignal
  uri: string
}

interface ResolveFfmpegOptions {
  environment?: NodeJS.ProcessEnv
  executablePath?: string
  fileExists?: (path: string) => Promise<boolean>
  platform?: NodeJS.Platform
}

interface RetainedVideoFile {
  path: string
  release: () => Promise<void>
}

interface MaterializedVideo {
  directory: string
  path: string
  references: number
}

const materializedVideos = new Map<string, Promise<MaterializedVideo>>()

function ffmpegColor(background: Rgb) {
  return `0x${background.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function buildFfmpegArguments(options: {
  background: Rgb
  framesPerSecond: number
  height: number
  inputPath: string
  width: number
}) {
  const { background, framesPerSecond, height, inputPath, width } = options
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2) {
    throw new RangeError('Video output dimensions must be integers of at least two pixels.')
  }
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0) {
    throw new RangeError('Video output FPS must be positive.')
  }

  const filter = [
    `fps=fps=${framesPerSecond}:round=near`,
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${ffmpegColor(background)}`,
    'format=bgra',
  ].join(',')

  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-re',
    '-stream_loop',
    '-1',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-vf',
    filter,
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'bgra',
    'pipe:1',
  ]
}

export function buildFfmpegAudioArguments(inputPath: string) {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-re',
    '-stream_loop',
    '-1',
    '-i',
    inputPath,
    '-map',
    '0:a:0',
    '-vn',
    '-sn',
    '-dn',
    '-af',
    'aresample=async=1:first_pts=0',
    '-c:a',
    'flac',
    '-compression_level',
    '0',
    '-f',
    'flac',
    'pipe:1',
  ]
}

export function ffmpegExecutableName(platform: NodeJS.Platform = process.platform) {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

async function defaultFileExists(path: string) {
  return Bun.file(path).exists()
}

export async function resolveFfmpegPath(options: ResolveFfmpegOptions = {}) {
  const environment = options.environment ?? process.env
  const executablePath = options.executablePath ?? process.execPath
  const fileExists = options.fileExists ?? defaultFileExists
  const platform = options.platform ?? process.platform
  const configuredPath = environment.TERMWEAVE_FFMPEG_PATH?.trim()
  const packagedExecutable = /^opentui-sidecar(?:\.exe)?$/i.test(basename(executablePath))
    ? resolve(dirname(executablePath), ffmpegExecutableName(platform))
    : undefined
  const candidates = [
    configuredPath ? resolve(configuredPath) : undefined,
    packagedExecutable,
  ].filter((path): path is string => Boolean(path))

  for (const path of candidates) {
    if (await fileExists(path)) return path
  }

  throw new Error(
    configuredPath
      ? `The configured FFmpeg executable does not exist: ${configuredPath}`
      : 'The bundled FFmpeg executable could not be found.',
  )
}

function localPath(uri: string) {
  const path = uri.startsWith('file:') ? fileURLToPath(uri) : uri
  return resolve(path)
}

export function isBunVirtualFilePath(path: string) {
  return path.includes('$bunfs') || /^B:[\\/]~BUN/i.test(path)
}

async function retainVideoFile(uri: string): Promise<RetainedVideoFile> {
  if (isRemoteUri(uri)) throw new Error('Remote MP4 playback is not supported.')

  const path = localPath(uri)
  if (!isBunVirtualFilePath(path) && (await Bun.file(path).exists())) {
    return { path, release: async () => {} }
  }

  let pendingEntry = materializedVideos.get(uri)
  if (!pendingEntry) {
    pendingEntry = (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'termweave-video-'))
      const materializedPath = join(directory, 'video.mp4')
      try {
        await Bun.write(materializedPath, Bun.file(path))
        return {
          directory,
          path: materializedPath,
          references: 0,
        }
      } catch (error) {
        await rm(directory, { force: true, recursive: true })
        throw error
      }
    })()
    materializedVideos.set(uri, pendingEntry)
  }

  let entry: MaterializedVideo
  try {
    entry = await pendingEntry
  } catch (error) {
    if (materializedVideos.get(uri) === pendingEntry) materializedVideos.delete(uri)
    throw error
  }
  entry.references += 1

  let released = false
  return {
    path: entry.path,
    release: async () => {
      if (released) return
      released = true
      entry.references -= 1
      if (entry.references > 0) return

      if (materializedVideos.get(uri) === pendingEntry) materializedVideos.delete(uri)
      await rm(entry.directory, { force: true, recursive: true })
    },
  }
}

async function readFfmpegError(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let message = ''

  for await (const chunk of stream) {
    message += decoder.decode(chunk, { stream: true })
    if (message.length > MAX_FFMPEG_ERROR_LENGTH) {
      message = message.slice(-MAX_FFMPEG_ERROR_LENGTH)
    }
  }

  message += decoder.decode()
  return message.trim()
}

export async function* assembleRawVideoFrames(
  chunks: AsyncIterable<Uint8Array>,
  dimensions: Dimensions,
  signal?: AbortSignal,
): AsyncGenerator<VideoFrame> {
  const frameBytes = dimensions.width * dimensions.height * 4
  if (!Number.isSafeInteger(frameBytes) || frameBytes < 1) {
    throw new RangeError('Raw video frame dimensions are invalid.')
  }

  const pool: Uint8Array[] = []
  const acquireBuffer = () => pool.pop() ?? new Uint8Array(frameBytes)
  let frameData = acquireBuffer()
  let frameIndex = 0
  let offset = 0

  for await (const chunk of chunks) {
    if (signal?.aborted) return
    let chunkOffset = 0

    while (chunkOffset < chunk.byteLength) {
      const copyLength = Math.min(frameBytes - offset, chunk.byteLength - chunkOffset)
      frameData.set(chunk.subarray(chunkOffset, chunkOffset + copyLength), offset)
      offset += copyLength
      chunkOffset += copyLength
      if (offset !== frameBytes) continue

      const completedData = frameData
      let released = false
      yield {
        ...dimensions,
        data: completedData,
        frameIndex,
        pixelFormat: 'bgra',
        release: () => {
          if (released) return
          released = true
          pool.push(completedData)
        },
      }
      frameIndex += 1
      frameData = acquireBuffer()
      offset = 0
    }
  }

  if (!signal?.aborted && offset !== 0) {
    throw new Error(`FFmpeg ended with a partial video frame (${offset}/${frameBytes} bytes).`)
  }
}

export async function* streamVideoFrames(
  options: VideoFrameStreamOptions,
): AsyncGenerator<VideoFrame> {
  const { background, framesPerSecond, height, signal, uri, width } = options
  const retainedFile = await retainVideoFile(uri)

  try {
    const ffmpegPath = options.ffmpegPath ?? (await resolveFfmpegPath())
    const subprocess = Bun.spawn(
      [
        ffmpegPath,
        ...buildFfmpegArguments({
          background,
          framesPerSecond,
          height,
          inputPath: retainedFile.path,
          width,
        }),
      ],
      {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        windowsHide: true,
      },
    )
    const errorOutput = readFfmpegError(subprocess.stderr)
    const stop = () => {
      try {
        subprocess.kill()
      } catch {
        // The process already exited.
      }
    }
    signal.addEventListener('abort', stop, { once: true })

    try {
      for await (const frame of assembleRawVideoFrames(
        subprocess.stdout,
        { width, height },
        signal,
      )) {
        yield frame
      }

      const exitCode = await subprocess.exited
      const message = await errorOutput
      if (!signal.aborted) {
        throw new Error(
          message ||
            (exitCode === 0
              ? 'FFmpeg video playback ended unexpectedly.'
              : `FFmpeg video playback failed with exit code ${exitCode}.`),
        )
      }
    } finally {
      signal.removeEventListener('abort', stop)
      stop()
      await subprocess.exited.catch(() => {})
      await errorOutput.catch(() => {})
    }
  } finally {
    await retainedFile.release()
  }
}

export async function* streamVideoAudio(
  options: VideoAudioStreamOptions,
): AsyncGenerator<Uint8Array> {
  const { signal, uri } = options
  const retainedFile = await retainVideoFile(uri)

  try {
    const ffmpegPath = options.ffmpegPath ?? (await resolveFfmpegPath())
    const subprocess = Bun.spawn([ffmpegPath, ...buildFfmpegAudioArguments(retainedFile.path)], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true,
    })
    const errorOutput = readFfmpegError(subprocess.stderr)
    const stop = () => {
      try {
        subprocess.kill()
      } catch {
        // The process already exited.
      }
    }
    signal.addEventListener('abort', stop, { once: true })

    try {
      for await (const chunk of subprocess.stdout) {
        if (signal.aborted) return
        yield chunk
      }

      const exitCode = await subprocess.exited
      const message = await errorOutput
      if (!signal.aborted) {
        throw new Error(
          message ||
            (exitCode === 0
              ? 'FFmpeg audio playback ended unexpectedly.'
              : `FFmpeg audio playback failed with exit code ${exitCode}.`),
        )
      }
    } finally {
      signal.removeEventListener('abort', stop)
      stop()
      await subprocess.exited.catch(() => {})
      await errorOutput.catch(() => {})
    }
  } finally {
    await retainedFile.release()
  }
}
