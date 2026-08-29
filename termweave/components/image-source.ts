import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const MAX_TYPED_ARRAY_LENGTH = 0xffff_ffff
const windowsDrivePattern = /^[A-Za-z]:[\\/]/
const uriSchemePattern = /^([A-Za-z][A-Za-z0-9+.-]*):/

export type ImageFormat = 'gif' | 'jpeg' | 'png'
export type MediaFormat = ImageFormat | 'mp4'
export type MediaSourceKind = 'bundled' | 'local' | 'remote'
export type MediaPipeline = 'decoder' | 'ffmpeg'

export interface ResolvedMediaSource {
  format: MediaFormat
  input: string
  kind: MediaSourceKind
  loop: boolean
  pipeline: MediaPipeline
  uri: string
}

export interface ResolveMediaSourceOptions {
  environment?: NodeJS.ProcessEnv
  fileExists?: (path: string) => Promise<boolean>
}

export interface RetainedMediaInput {
  path: string
  release(): Promise<void>
}

interface MaterializedMedia {
  directory: string
  path: string
  references: number
}

const materializedMedia = new Map<string, Promise<MaterializedMedia>>()
const mediaExtensionFormat = new Map<string, MediaFormat>([
  ['.gif', 'gif'],
  ['.jpeg', 'jpeg'],
  ['.jpg', 'jpeg'],
  ['.mp4', 'mp4'],
  ['.png', 'png'],
])

export function createImageAbortError() {
  return new DOMException('The image operation was cancelled.', 'AbortError')
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function throwIfImageAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? createImageAbortError()
}

export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length === 0) throw new Error('The image file is empty.')

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png'
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'gif'
  }

  throw new Error('Unsupported image format; expected PNG, JPEG, or GIF content.')
}

export function resolveLocalImagePath(uri: string) {
  const value = uri.trim()
  if (!value) throw new Error('Image URI is required.')

  const scheme = windowsDrivePattern.test(value) ? undefined : uriSchemePattern.exec(value)?.[1]
  if (scheme && /^https?$/i.test(scheme)) {
    throw new Error(
      'HTTP and HTTPS images are not supported; PixelRenderer accepts local files only.',
    )
  }
  if (scheme && !/^file$/i.test(scheme)) {
    throw new Error('PixelRenderer accepts only local file paths and file: URLs.')
  }

  if (scheme) {
    try {
      return fileURLToPath(new URL(value))
    } catch {
      throw new Error('The image file: URL is invalid or is not local.')
    }
  }
  return value
}

function normalizedBundledPath(uri: string) {
  let path: string
  try {
    path = decodeURIComponent(uri.slice('media:'.length)).replaceAll('\\', '/')
  } catch {
    throw new Error('The bundled media URI contains invalid escaping.')
  }
  path = path.replace(/^\/+/, '')
  const segments = path.split('/')
  if (!path || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Bundled media URIs must be safe paths below app/media.')
  }
  return segments.join('/')
}

export function bundledMediaUri(path: string) {
  const normalized = normalizedBundledPath(`media:${path.trim()}`)
  return `media:${normalized.split('/').map(encodeURIComponent).join('/')}`
}

function formatFromPath(path: string) {
  return mediaExtensionFormat.get(extname(path).toLowerCase())
}

async function defaultFileExists(path: string) {
  return Bun.file(path).exists()
}

export async function resolveMediaSource(
  uri: string,
  options: ResolveMediaSourceOptions = {},
): Promise<ResolvedMediaSource> {
  const value = uri.trim()
  if (!value) throw new Error('Image URI is required.')
  const fileExists = options.fileExists ?? defaultFileExists
  const environment = options.environment ?? process.env
  const scheme = windowsDrivePattern.test(value) ? undefined : uriSchemePattern.exec(value)?.[1]

  let input: string
  let kind: MediaSourceKind
  let format: MediaFormat | undefined
  if (scheme?.toLowerCase() === 'media') {
    const path = normalizedBundledPath(value)
    const root = environment.TERMWEAVE_MEDIA_ROOT?.trim()
    if (!root) throw new Error('The bundled media resource root is unavailable.')
    input = resolve(root, ...path.split('/'))
    kind = 'bundled'
    format = formatFromPath(path)
  } else if (scheme?.toLowerCase() === 'https') {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error('The HTTPS media URL is invalid.')
    }
    input = url.href
    kind = 'remote'
    format = formatFromPath(url.pathname)
  } else {
    if (scheme?.toLowerCase() === 'http') {
      throw new Error('Insecure HTTP media is not supported; use HTTPS.')
    }
    if (scheme && scheme.toLowerCase() !== 'file') {
      throw new Error('PixelRenderer accepts local files, file: URLs, media: resources, and HTTPS.')
    }
    input = resolveLocalImagePath(value)
    kind = 'local'
    format = formatFromPath(input)
  }

  if (kind !== 'local' && !format) {
    throw new Error('Unsupported media type; expected MP4, GIF, PNG, or JPEG.')
  }
  if (kind !== 'remote' && !(await fileExists(input))) {
    const subject = kind === 'bundled' ? 'Bundled media resource' : 'Media file'
    throw new Error(`${subject} does not exist: ${input}`)
  }

  const resolvedFormat = format ?? 'png'
  return {
    uri: value,
    input,
    format: resolvedFormat,
    kind,
    pipeline: resolvedFormat === 'mp4' || kind !== 'local' ? 'ffmpeg' : 'decoder',
    loop: resolvedFormat === 'mp4' || resolvedFormat === 'gif',
  }
}

export function isBunVirtualFilePath(path: string) {
  return path.includes('$bunfs') || /^B:[\\/]~BUN/i.test(path)
}

export async function retainMediaInput(source: ResolvedMediaSource): Promise<RetainedMediaInput> {
  if (source.kind === 'remote') return { path: source.input, release: async () => {} }
  if (!isBunVirtualFilePath(source.input)) {
    return { path: source.input, release: async () => {} }
  }

  let pending = materializedMedia.get(source.input)
  if (!pending) {
    pending = (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'termweave-media-'))
      const extension = extname(source.input) || `.${source.format}`
      const path = join(directory, `${basename(source.input, extname(source.input))}${extension}`)
      try {
        await mkdir(directory, { recursive: true })
        await Bun.write(path, Bun.file(source.input))
        return { directory, path, references: 0 }
      } catch (error) {
        await rm(directory, { force: true, recursive: true })
        throw new Error(
          `Could not extract bundled media for FFmpeg: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })()
    materializedMedia.set(source.input, pending)
  }

  let entry: MaterializedMedia
  try {
    entry = await pending
  } catch (error) {
    if (materializedMedia.get(source.input) === pending) materializedMedia.delete(source.input)
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
      if (materializedMedia.get(source.input) === pending) materializedMedia.delete(source.input)
      await rm(entry.directory, { force: true, recursive: true })
    },
  }
}

export async function readLocalImageBytes(uri: string, signal?: AbortSignal) {
  const path = resolveLocalImagePath(uri)
  throwIfImageAborted(signal)

  const reader = Bun.file(path).stream().getReader()
  const chunks: Uint8Array[] = []
  let totalLength = 0
  const cancel = () => {
    void reader.cancel(signal?.reason ?? createImageAbortError()).catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })

  try {
    while (true) {
      throwIfImageAborted(signal)
      const result = await reader.read()
      if (result.done) break
      const chunk = result.value
      totalLength += chunk.byteLength
      if (!Number.isSafeInteger(totalLength) || totalLength > MAX_TYPED_ARRAY_LENGTH) {
        throw new Error('The image file is too large to read safely.')
      }
      chunks.push(chunk)
    }
    throwIfImageAborted(signal)

    const bytes = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}
