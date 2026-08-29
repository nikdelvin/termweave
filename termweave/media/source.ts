import { mkdtemp, rm } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { errorMessage } from '../error-message'

// Source owns URI policy and temporary input retention; it never owns process or playback state.
const windowsDrivePattern = /^[A-Za-z]:[\\/]/
const uriSchemePattern = /^([A-Za-z][A-Za-z0-9+.-]*):/

type ImageFormat = 'gif' | 'jpeg' | 'png'
export type MediaFormat = ImageFormat | 'mp4'
type MediaSourceKind = 'bundled' | 'local' | 'remote'

export interface ResolvedMediaSource {
  format: MediaFormat
  input: string
  kind: MediaSourceKind
  loop: boolean
  uri: string
}

interface ResolveMediaSourceOptions {
  environment?: NodeJS.ProcessEnv
  fileExists?: (path: string) => Promise<boolean>
  readSignature?: (path: string) => Promise<Uint8Array>
}

export interface RetainedMediaInput {
  path: string
  release(): Promise<void>
}

interface MaterializedMedia {
  directory: string
  path: string
}

interface MaterializedMediaEntry {
  pending: Promise<MaterializedMedia>
  references: number
  removeDirectory: typeof rm
}

interface RetainMediaInputOptions {
  removeDirectory?: typeof rm
}

const materializedMedia = new Map<string, MaterializedMediaEntry>()
const mediaExtensionFormat = new Map<string, MediaFormat>([
  ['.gif', 'gif'],
  ['.jpeg', 'jpeg'],
  ['.jpg', 'jpeg'],
  ['.mp4', 'mp4'],
  ['.png', 'png'],
])

export function createMediaAbortError() {
  return new DOMException('The media operation was cancelled.', 'AbortError')
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function throwIfMediaAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? createMediaAbortError()
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
  if (!value) throw new Error('Media URI is required.')
  const scheme = windowsDrivePattern.test(value) ? undefined : uriSchemePattern.exec(value)?.[1]
  if (scheme && /^https?$/i.test(scheme)) {
    throw new Error(
      'HTTP and HTTPS images are not supported; PixelRenderer accepts local files only.',
    )
  }
  if (scheme && !/^file$/i.test(scheme)) {
    throw new Error('PixelRenderer accepts only local file paths and file: URLs.')
  }
  if (!scheme) return value
  try {
    return fileURLToPath(new URL(value))
  } catch {
    throw new Error('The image file: URL is invalid or is not local.')
  }
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

export async function readLocalImageSignature(path: string) {
  return new Uint8Array(await Bun.file(path).slice(0, 8).arrayBuffer())
}

export async function resolveMediaSource(
  uri: string,
  options: ResolveMediaSourceOptions = {},
): Promise<ResolvedMediaSource> {
  const value = uri.trim()
  if (!value) throw new Error('Media URI is required.')
  const fileExists = options.fileExists ?? defaultFileExists
  const readSignature = options.readSignature ?? readLocalImageSignature
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
    format = formatFromPath(input) === 'mp4' ? 'mp4' : undefined
  }

  if (kind !== 'local' && !format) {
    throw new Error('Unsupported media type; expected MP4, GIF, PNG, or JPEG.')
  }
  if (kind !== 'remote' && !(await fileExists(input))) {
    const subject = kind === 'bundled' ? 'Bundled media resource' : 'Media file'
    throw new Error(`${subject} does not exist: ${input}`)
  }
  if (kind === 'local' && format === undefined)
    format = detectImageFormat(await readSignature(input))

  return {
    uri: value,
    input,
    format: format!,
    kind,
    loop: format === 'mp4' || format === 'gif',
  }
}

export function isBunVirtualFilePath(path: string) {
  return path.includes('$bunfs') || /^B:[\\/]~BUN/i.test(path)
}

export async function retainMediaInput(
  source: ResolvedMediaSource,
  options: RetainMediaInputOptions = {},
): Promise<RetainedMediaInput> {
  if (source.kind === 'remote') return { path: source.input, release: async () => {} }
  if (!isBunVirtualFilePath(source.input)) {
    return { path: source.input, release: async () => {} }
  }

  let entry = materializedMedia.get(source.input)
  if (!entry) {
    const removeDirectory = options.removeDirectory ?? rm
    const pending = (async () => {
      const directory = await mkdtemp(join(tmpdir(), 'termweave-media-'))
      const extension = extname(source.input) || `.${source.format}`
      const path = join(directory, `${basename(source.input, extname(source.input))}${extension}`)
      try {
        await Bun.write(path, Bun.file(source.input))
        return { directory, path }
      } catch (error) {
        try {
          await removeDirectory(directory, { force: true, recursive: true })
        } catch (cleanupError) {
          console.warn(
            `Termweave could not remove a failed bundled-media extraction: ${errorMessage(cleanupError)}`,
          )
        }
        throw new Error(`Could not extract bundled media for FFmpeg: ${errorMessage(error)}`, {
          cause: error,
        })
      }
    })()
    entry = { pending, references: 0, removeDirectory }
    materializedMedia.set(source.input, entry)
  }

  // Reserve the lease before awaiting extraction so a final release cannot remove it meanwhile.
  entry.references += 1
  let materialized: MaterializedMedia
  try {
    materialized = await entry.pending
  } catch (error) {
    entry.references -= 1
    if (entry.references === 0 && materializedMedia.get(source.input) === entry) {
      materializedMedia.delete(source.input)
    }
    throw error
  }
  let released = false
  return {
    path: materialized.path,
    release: async () => {
      if (released) return
      released = true
      entry.references -= 1
      if (entry.references > 0) return
      if (materializedMedia.get(source.input) === entry) materializedMedia.delete(source.input)
      await entry.removeDirectory(materialized.directory, { force: true, recursive: true })
    },
  }
}
