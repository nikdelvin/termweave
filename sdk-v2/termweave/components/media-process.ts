import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import { retainMediaInput, type ResolvedMediaSource, type RetainedMediaInput } from './image-source'
import { rgbaByteLength, type Dimensions, type Rgb, type RgbaFrame } from './pixel-frame'

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

interface ResolveFfmpegOptions {
  environment?: NodeJS.ProcessEnv
  executablePath?: string
  fileExists?: (path: string) => Promise<boolean>
  platform?: NodeJS.Platform
}

export interface FfmpegCommandOptions extends Dimensions {
  background: Rgb
  hardwareAcceleration: boolean
  input: string
  remote: boolean
  withAudio: boolean
}

export interface OpenFfmpegMediaSessionOptions extends Dimensions {
  background: Rgb
  ffmpegPath?: string
  hardwareAcceleration?: boolean
  signal: AbortSignal
  source: ResolvedMediaSource
  withAudio: boolean
}

function ffmpegColor(background: Rgb) {
  return `0x${background.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function buildFfmpegMediaArguments(options: FfmpegCommandOptions) {
  const { background, hardwareAcceleration, height, input, remote, width, withAudio } = options
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
  const videoFilter = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${ffmpegColor(background)}`,
    'format=rgba',
    'setpts=PTS-STARTPTS',
  ].join(',')

  const arguments_ = [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostats',
    '-re',
    ...inputOptions,
    ...hardwareOptions,
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
      : 'The bundled FFmpeg executable could not be found next to the OpenTUI sidecar; run the FFmpeg preparation step before playback.',
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
}

async function readBoundedDiagnostic(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let message = ''
  const chunks = stream as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>
  for await (const chunk of chunks) {
    message += decoder.decode(chunk, { stream: true })
    if (message.length > MAX_FFMPEG_DIAGNOSTIC_LENGTH) {
      message = message.slice(-MAX_FFMPEG_DIAGNOSTIC_LENGTH)
    }
  }
  message += decoder.decode()
  return message.trim()
}

function streamForDescriptor(descriptor: number | null, name: string) {
  if (descriptor === null) throw new Error(`Could not create the FFmpeg ${name} pipe.`)
  return Bun.file(descriptor).stream()
}

export async function openFfmpegMediaSession(
  options: OpenFfmpegMediaSessionOptions,
): Promise<FfmpegMediaSession> {
  let retained: RetainedMediaInput | undefined
  try {
    retained = await retainMediaInput(options.source)
    const ffmpegPath = options.ffmpegPath ?? (await resolveFfmpegPath())
    const child = Bun.spawn(
      [
        ffmpegPath,
        ...buildFfmpegMediaArguments({
          background: options.background,
          hardwareAcceleration: options.hardwareAcceleration ?? false,
          height: options.height,
          input: retained.path,
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
    const audio = options.withAudio ? streamForDescriptor(child.stdio[3], 'audio') : undefined
    const timestampStream = streamForDescriptor(
      child.stdio[4],
      'timestamp',
    ) as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>
    const timestamps = parseFfmpegTimestamps(timestampStream)
    const diagnostic = readBoundedDiagnostic(child.stderr)
    let disposed = false
    const stop = () => {
      if (disposed) return
      disposed = true
      try {
        child.kill()
      } catch {
        // The process may have exited between the state check and the signal.
      }
    }
    const handleAbort = () => stop()
    options.signal.addEventListener('abort', handleAbort, { once: true })
    if (options.signal.aborted) stop()

    const retainedInput = retained
    const result = Promise.all([child.exited, diagnostic])
      .then(([exitCode, message]) => ({ exitCode, diagnostic: message }))
      .finally(async () => {
        options.signal.removeEventListener('abort', handleAbort)
        await retainedInput.release()
      })

    return {
      audio,
      frames: assembleRawVideoFrames(
        child.stdout as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>,
        timestamps,
        options,
        options.signal,
      ),
      result,
      dispose: stop,
    }
  } catch (error) {
    await retained?.release()
    throw error
  }
}

export function isMissingAudioDiagnostic(diagnostic: string) {
  return /Stream map ['"]?0:a:0|matches no streams|does not contain any stream/i.test(diagnostic)
}

export function isVideoToolboxDiagnostic(diagnostic: string) {
  return /videotoolbox|hardware device|hwaccel/i.test(diagnostic)
}
