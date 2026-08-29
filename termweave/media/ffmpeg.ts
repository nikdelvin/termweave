import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import type { Rgb } from '../color'
import { errorMessage } from '../error-message'
import { rgbaByteLength, type Dimensions, type RgbaFrame } from './frame'
import {
  createMediaAbortError,
  retainMediaInput,
  throwIfMediaAborted,
  type MediaFormat,
  type ResolvedMediaSource,
  type RetainedMediaInput,
} from './source'

// FFmpeg owns only executable/process mechanics and yields pooled, timestamped raw frames.
const MAX_FFMPEG_DIAGNOSTIC_LENGTH = 8_192
const VIDEO_BUFFER_POOL_SIZE = 3

export interface TimedVideoFrame extends RgbaFrame {
  ptsMs: number
  release(): void
}

export interface FfmpegMediaSession {
  audio: ReadableStream<Uint8Array> | undefined
  frames: AsyncGenerator<TimedVideoFrame>
  result: Promise<FfmpegProcessResult>
  dispose(): void
}

export interface FfmpegProcessResult {
  diagnostic: string
  exitCode: number
}

export class FfmpegProcessError extends Error {
  readonly diagnostic: string
  readonly exitCode: number

  constructor(message: string, result: FfmpegProcessResult) {
    super(message)
    this.name = 'FfmpegProcessError'
    this.diagnostic = result.diagnostic
    this.exitCode = result.exitCode
  }
}

export function createFfmpegProcessError(result: FfmpegProcessResult) {
  return new FfmpegProcessError(
    result.diagnostic ||
      (result.exitCode === 0
        ? 'FFmpeg produced no media frames.'
        : `FFmpeg media playback failed with exit code ${result.exitCode}.`),
    result,
  )
}

type FfmpegByteStream = ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>

export interface FfmpegChildProcess {
  readonly exited: Promise<number>
  readonly stderr: ReadableStream<Uint8Array>
  readonly stdout: ReadableStream<Uint8Array>
  readonly stdio: readonly unknown[]
  kill(): void
}

export type SpawnFfmpegProcess = (
  command: string[],
  options: Readonly<{
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
    windowsHide: true
  }>,
) => FfmpegChildProcess

export type OpenFfmpegDescriptor = (
  descriptor: unknown,
  name: 'audio' | 'timestamp',
) => ReadableStream<Uint8Array>

interface ResolveFfmpegOptions {
  architecture?: string
  development?: boolean
  environment?: NodeJS.ProcessEnv
  executablePath?: string
  fileExists?: (path: string) => Promise<boolean>
  platform?: NodeJS.Platform
}

interface FfmpegCommandOptions extends Dimensions {
  background: Rgb
  hardwareAcceleration: boolean
  input: string
  inputFormat: MediaFormat
  realtime: boolean
  remote: boolean
  withAudio: boolean
}

export interface OpenFfmpegMediaSessionOptions extends Dimensions {
  background: Rgb
  ffmpegPath?: string
  hardwareAcceleration?: boolean
  realtime?: boolean
  signal: AbortSignal
  source: ResolvedMediaSource
  openDescriptor?: OpenFfmpegDescriptor
  resolvePath?: typeof resolveFfmpegPath
  retainInput?: typeof retainMediaInput
  spawn?: SpawnFfmpegProcess
  withAudio: boolean
}

function ffmpegColor(background: Rgb) {
  return `0x${background.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function buildFfmpegMediaArguments(options: FfmpegCommandOptions) {
  const {
    background,
    hardwareAcceleration,
    height,
    input,
    inputFormat,
    realtime,
    remote,
    width,
    withAudio,
  } = options
  if (!Number.isSafeInteger(width) || width < 2 || !Number.isSafeInteger(height) || height < 2) {
    throw new RangeError('Media output dimensions must be integers of at least two pixels.')
  }

  const inputOptions = remote
    ? [
        '-rw_timeout',
        '15000000',
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '2',
      ]
    : []
  const hardwareOptions = hardwareAcceleration ? ['-hwaccel', 'videotoolbox'] : []
  const imageInputOptions =
    inputFormat === 'gif'
      ? ['-f', 'gif']
      : inputFormat === 'png' || inputFormat === 'jpeg'
        ? ['-f', 'image2', '-c:v', inputFormat === 'png' ? 'png' : 'mjpeg']
        : []
  const videoFilter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=bilinear`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${ffmpegColor(background)}`,
    'format=rgba',
    'setpts=PTS-STARTPTS',
  ].join(',')

  const arguments_ = [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    realtime ? 'error' : 'info',
    '-nostats',
    ...(realtime ? ['-re'] : []),
    ...inputOptions,
    ...hardwareOptions,
    ...imageInputOptions,
    '-i',
    input,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-vf',
    videoFilter,
    '-fps_mode',
    'passthrough',
    '-stats_mux_pre:v:0',
    'pipe:4',
    '-stats_mux_pre_fmt',
    '{pts} {tb}',
    '-c:v',
    'rawvideo',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ]

  if (withAudio) {
    arguments_.push(
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
      'pipe:3',
    )
  }
  return arguments_
}

function ffmpegExecutableName(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
) {
  if (platform !== 'darwin' || (architecture !== 'arm64' && architecture !== 'x64')) {
    throw new Error(
      `Termweave FFmpeg supports only macOS arm64 and x64, not ${platform}-${architecture}.`,
    )
  }
  return 'ffmpeg'
}

function developmentFfmpegName(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
) {
  ffmpegExecutableName(platform, architecture)
  const target = architecture === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  return `ffmpeg-${target}`
}

async function defaultFileExists(path: string) {
  return Bun.file(path).exists()
}

export async function resolveFfmpegPath(options: ResolveFfmpegOptions = {}) {
  const environment = options.environment ?? process.env
  const executablePath = options.executablePath ?? process.execPath
  const fileExists = options.fileExists ?? defaultFileExists
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  ffmpegExecutableName(platform, architecture)
  const configuredPath = environment.TERMWEAVE_FFMPEG_PATH?.trim()
  const packagedExecutable =
    basename(executablePath) === 'opentui-sidecar'
      ? resolve(dirname(executablePath), ffmpegExecutableName(platform, architecture))
      : undefined
  const developmentName = developmentFfmpegName(platform, architecture)
  const developmentExecutable =
    configuredPath || !options.development
      ? undefined
      : resolve(import.meta.dir, '../../src-tauri/binaries', developmentName)
  const candidates = [
    configuredPath ? resolve(configuredPath) : undefined,
    packagedExecutable,
    developmentExecutable,
  ].filter((path): path is string => Boolean(path))

  for (const path of candidates) {
    if (await fileExists(path)) return path
  }
  throw new Error(
    configuredPath
      ? `The configured FFmpeg executable does not exist: ${configuredPath}`
      : 'The bundled FFmpeg executable could not be found; run the FFmpeg preparation step before playback.',
  )
}

async function* lines(chunks: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of chunks) {
    pending += decoder.decode(chunk, { stream: true })
    while (true) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      yield pending.slice(0, newline).trim()
      pending = pending.slice(newline + 1)
    }
  }
  pending += decoder.decode()
  if (pending.trim()) yield pending.trim()
}

export async function* parseFfmpegTimestamps(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<number> {
  let firstTimestamp: number | undefined
  for await (const line of lines(chunks)) {
    const match = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(line)
    if (!match) throw new Error(`FFmpeg returned an invalid frame timestamp: ${line}`)
    const pts = Number(match[1])
    const numerator = Number(match[2])
    const denominator = Number(match[3])
    const timestamp = (pts * numerator * 1_000) / denominator
    if (!Number.isFinite(timestamp) || denominator === 0) {
      throw new Error(`FFmpeg returned an invalid frame timestamp: ${line}`)
    }
    firstTimestamp ??= timestamp
    yield Math.max(0, timestamp - firstTimestamp)
  }
}

export async function* assembleRawVideoFrames(
  chunks: AsyncIterable<Uint8Array>,
  timestamps: AsyncIterable<number>,
  dimensions: Dimensions,
  signal?: AbortSignal,
): AsyncGenerator<TimedVideoFrame> {
  const frameBytes = rgbaByteLength(dimensions)
  const timestampIterator = timestamps[Symbol.asyncIterator]()
  const pool: Uint8Array[] = []
  const acquire = () => pool.pop() ?? new Uint8Array(frameBytes)
  let data = acquire()
  let offset = 0
  let cleanupFailed = false
  let cleanupError: unknown

  try {
    for await (const chunk of chunks) {
      if (signal?.aborted) return
      let chunkOffset = 0
      while (chunkOffset < chunk.byteLength) {
        const copyLength = Math.min(frameBytes - offset, chunk.byteLength - chunkOffset)
        data.set(chunk.subarray(chunkOffset, chunkOffset + copyLength), offset)
        offset += copyLength
        chunkOffset += copyLength
        if (offset !== frameBytes) continue

        const timestamp = await timestampIterator.next()
        if (timestamp.done) throw new Error('FFmpeg omitted a timestamp for a decoded video frame.')
        const completed = data
        let released = false
        yield {
          ...dimensions,
          data: completed,
          ptsMs: timestamp.value,
          release: () => {
            if (released) return
            released = true
            if (pool.length < VIDEO_BUFFER_POOL_SIZE) pool.push(completed)
          },
        }
        data = acquire()
        offset = 0
      }
    }

    if (!signal?.aborted && offset !== 0) {
      throw new Error(`FFmpeg ended with a partial video frame (${offset}/${frameBytes} bytes).`)
    }
  } finally {
    try {
      await timestampIterator.return?.()
    } catch (error) {
      cleanupFailed = true
      cleanupError = error
    }
  }
  if (cleanupFailed) throw cleanupError
}

async function readBoundedDiagnostic(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  const halfLimit = MAX_FFMPEG_DIAGNOSTIC_LENGTH / 2
  let beginning = ''
  let ending = ''
  let totalLength = 0
  const append = (text: string) => {
    totalLength += text.length
    if (beginning.length < halfLimit) beginning += text.slice(0, halfLimit - beginning.length)
    ending = `${ending}${text}`.slice(-halfLimit)
  }
  const chunks = stream as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>
  for await (const chunk of chunks) append(decoder.decode(chunk, { stream: true }))
  append(decoder.decode())
  if (totalLength <= MAX_FFMPEG_DIAGNOSTIC_LENGTH) {
    const overlap = Math.max(0, beginning.length + ending.length - totalLength)
    return `${beginning}${ending.slice(overlap)}`.trim()
  }
  return `${beginning}\n…\n${ending}`.trim()
}

function streamForDescriptor(descriptor: unknown, name: 'audio' | 'timestamp') {
  if (typeof descriptor !== 'number') {
    throw new Error(`Could not create the FFmpeg ${name} pipe.`)
  }
  return Bun.file(descriptor).stream()
}

const spawnFfmpegProcess: SpawnFfmpegProcess = (command, options) =>
  Bun.spawn(command, options) as unknown as FfmpegChildProcess

async function cancelStream(stream: ReadableStream<Uint8Array> | undefined) {
  if (!stream || stream.locked) return
  try {
    await stream.cancel()
  } catch {
    // Descriptor teardown can race process exit.
  }
}

export async function openFfmpegMediaSession(
  options: OpenFfmpegMediaSessionOptions,
): Promise<FfmpegMediaSession> {
  let retained: RetainedMediaInput | undefined
  let child: FfmpegChildProcess | undefined
  let audio: ReadableStream<Uint8Array> | undefined
  let timestampStream: ReadableStream<Uint8Array> | undefined
  let abortAttached = false
  let stopped = false
  let released = false
  let setupComplete = false

  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      child?.kill()
    } catch {
      // The process may have exited between the state check and the signal.
    }
  }
  const handleAbort = () => stop()
  const detachAbort = () => {
    if (!abortAttached) return
    abortAttached = false
    options.signal.removeEventListener('abort', handleAbort)
  }
  const releaseInput = async () => {
    if (released) return
    released = true
    await retained?.release()
  }
  const releaseInputSafely = async () => {
    try {
      await releaseInput()
    } catch (error) {
      console.warn(`Termweave could not release a temporary media input: ${errorMessage(error)}`)
    }
  }
  const rollbackSetup = async () => {
    stop()
    detachAbort()
    await Promise.all([
      cancelStream(audio),
      cancelStream(timestampStream),
      cancelStream(child?.stdout),
      cancelStream(child?.stderr),
    ])
    await releaseInputSafely()
  }

  try {
    throwIfMediaAborted(options.signal)
    retained = await (options.retainInput ?? retainMediaInput)(options.source)
    throwIfMediaAborted(options.signal)
    const ffmpegPath =
      options.ffmpegPath ??
      (await (options.resolvePath ?? resolveFfmpegPath)({
        development: options.source.kind !== 'remote',
      }))
    throwIfMediaAborted(options.signal)
    child = (options.spawn ?? spawnFfmpegProcess)(
      [
        ffmpegPath,
        ...buildFfmpegMediaArguments({
          background: options.background,
          hardwareAcceleration: options.hardwareAcceleration ?? false,
          height: options.height,
          input: retained.path,
          inputFormat: options.source.format,
          realtime: options.realtime ?? true,
          remote: options.source.kind === 'remote',
          width: options.width,
          withAudio: options.withAudio,
        }),
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    options.signal.addEventListener('abort', handleAbort, { once: true })
    abortAttached = true
    if (options.signal.aborted) stop()
    throwIfMediaAborted(options.signal)

    const openDescriptor = options.openDescriptor ?? streamForDescriptor
    audio = options.withAudio ? openDescriptor(child.stdio[3], 'audio') : undefined
    timestampStream = openDescriptor(child.stdio[4], 'timestamp')
    throwIfMediaAborted(options.signal)
    const timestamps = parseFfmpegTimestamps(timestampStream as FfmpegByteStream)
    const diagnostic = readBoundedDiagnostic(child.stderr)

    const result = Promise.all([child.exited, diagnostic])
      .then(([exitCode, message]) => ({ exitCode, diagnostic: message }))
      .finally(async () => {
        detachAbort()
        await releaseInputSafely()
      })

    setupComplete = true
    return {
      audio,
      frames: assembleRawVideoFrames(
        child.stdout as FfmpegByteStream,
        timestamps,
        { width: options.width, height: options.height },
        options.signal,
      ),
      result,
      dispose: stop,
    }
  } catch (error) {
    await rollbackSetup()
    if (options.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) {
      throw options.signal.reason ?? createMediaAbortError()
    }
    throw error
  } finally {
    if (!setupComplete && child) void child.exited.catch(() => {})
  }
}

export function isMissingAudioDiagnostic(diagnostic: string) {
  return /Stream map ['"]?0:a:0|matches no streams|does not contain any stream/i.test(diagnostic)
}

export function isVideoToolboxDiagnostic(diagnostic: string) {
  return /videotoolbox|hardware device|hwaccel/i.test(diagnostic)
}
