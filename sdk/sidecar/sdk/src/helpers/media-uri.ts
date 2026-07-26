import { extname } from 'node:path'

function uriPath(uri: string) {
  try {
    return new URL(uri).pathname
  } catch {
    return uri
  }
}

export function isRemoteUri(uri: string) {
  return /^https?:\/\//i.test(uri)
}

export function isMp4Uri(uri: string) {
  return extname(uriPath(uri).trim()).toLowerCase() === '.mp4'
}
