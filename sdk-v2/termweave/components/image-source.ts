import { fileURLToPath } from 'node:url'

const MAX_TYPED_ARRAY_LENGTH = 0xffff_ffff
const windowsDrivePattern = /^[A-Za-z]:[\\/]/
const uriSchemePattern = /^([A-Za-z][A-Za-z0-9+.-]*):/

export type ImageFormat = 'gif' | 'jpeg' | 'png'

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
