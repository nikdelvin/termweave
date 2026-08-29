import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import ffmpegManifest from '../ffmpeg-artifacts.json'
import { errorMessage, getRustHostTuple, runRequired } from './tooling'

interface ArtifactMetadata {
  artifactSha256: string
  configure: string[]
  executable: string
  ffmpegVersion: string
  license: string
  sourceSha256: string
  target: string
}

const projectRoot = resolve(import.meta.dir, '..')

export function getFfmpegOutputPath(
  root: string,
  triple: string,
  platform: NodeJS.Platform = process.platform,
) {
  const extension = platform === 'win32' ? '.exe' : ''
  return resolve(root, `src-tauri/binaries/ffmpeg-${triple}${extension}`)
}

export function getFfmpegResourceDirectory(root: string) {
  return resolve(root, 'src-tauri/third-party/ffmpeg')
}

function getArtifactMetadataPath(root: string, triple: string) {
  return resolve(getFfmpegResourceDirectory(root), `artifact-${triple}.json`)
}

async function sha256(path: string) {
  const hasher = new Bun.CryptoHasher('sha256')
  const stream = Bun.file(path).stream() as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>
  for await (const chunk of stream) hasher.update(chunk)
  return hasher.digest('hex')
}

async function ensureSourceArchive(resourceDirectory: string) {
  const sourcePath = resolve(resourceDirectory, `ffmpeg-${ffmpegManifest.ffmpegVersion}.tar.xz`)
  if (
    (await Bun.file(sourcePath).exists()) &&
    (await sha256(sourcePath)) === ffmpegManifest.source.sha256
  ) {
    return sourcePath
  }

  await rm(sourcePath, { force: true })
  const response = await fetch(ffmpegManifest.source.url)
  if (!response.ok) throw new Error(`FFmpeg source download failed with HTTP ${response.status}.`)
  await writeFile(sourcePath, new Uint8Array(await response.arrayBuffer()))

  const checksum = await sha256(sourcePath)
  if (checksum !== ffmpegManifest.source.sha256) {
    await rm(sourcePath, { force: true })
    throw new Error(
      `FFmpeg source checksum mismatch: expected ${ffmpegManifest.source.sha256}, got ${checksum}.`,
    )
  }
  return sourcePath
}

async function readArtifactMetadata(path: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ArtifactMetadata
  } catch {
    return undefined
  }
}

async function existingArtifactIsValid(
  executablePath: string,
  metadataPath: string,
  triple: string,
) {
  if (!(await Bun.file(executablePath).exists())) return false
  const metadata = await readArtifactMetadata(metadataPath)
  if (
    !metadata ||
    metadata.ffmpegVersion !== ffmpegManifest.ffmpegVersion ||
    metadata.sourceSha256 !== ffmpegManifest.source.sha256 ||
    metadata.target !== triple ||
    JSON.stringify(metadata.configure) !== JSON.stringify(ffmpegManifest.configure)
  ) {
    return false
  }
  return (await sha256(executablePath)) === metadata.artifactSha256
}

async function validateFfmpegBuild(executablePath: string) {
  const child = Bun.spawn([executablePath, '-version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const output = `${stdout}\n${stderr}`
  if (exitCode !== 0 || !output.includes(`ffmpeg version ${ffmpegManifest.ffmpegVersion}`)) {
    throw new Error(`The bundled FFmpeg build could not be validated:\n${output.trim()}`)
  }
  for (const flag of ffmpegManifest.configure) {
    if (!output.includes(flag)) {
      throw new Error(`The bundled FFmpeg build is missing its pinned ${flag} configuration.`)
    }
  }
  if (output.includes('--enable-gpl') || output.includes('--enable-nonfree')) {
    throw new Error('The bundled FFmpeg build unexpectedly enables GPL or nonfree components.')
  }
}

async function writeArtifactMetadata(
  executablePath: string,
  metadataPath: string,
  triple: string,
  executable: string,
) {
  const metadata: ArtifactMetadata = {
    artifactSha256: await sha256(executablePath),
    configure: [...ffmpegManifest.configure],
    executable,
    ffmpegVersion: ffmpegManifest.ffmpegVersion,
    license: ffmpegManifest.license,
    sourceSha256: ffmpegManifest.source.sha256,
    target: triple,
  }
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
}

export async function ensureFfmpegBinary(root = projectRoot, triple?: string) {
  triple ??= await getRustHostTuple()
  const target = ffmpegManifest.targets[triple as keyof typeof ffmpegManifest.targets]
  if (!target) {
    throw new Error(`FFmpeg is prepared only for macOS arm64 and x64, not ${triple}.`)
  }

  const executablePath = getFfmpegOutputPath(root, triple)
  const resourceDirectory = getFfmpegResourceDirectory(root)
  const metadataPath = getArtifactMetadataPath(root, triple)
  await mkdir(resolve(root, 'src-tauri/binaries'), { recursive: true })
  await mkdir(resourceDirectory, { recursive: true })
  const sourceArchive = await ensureSourceArchive(resourceDirectory)
  const noticesExist =
    (await Bun.file(resolve(resourceDirectory, 'COPYING.LGPLv2.1')).exists()) &&
    (await Bun.file(resolve(resourceDirectory, 'FFMPEG-LICENSE.md')).exists())

  if (noticesExist && (await existingArtifactIsValid(executablePath, metadataPath, triple))) {
    await validateFfmpegBuild(executablePath)
    return executablePath
  }
  if (noticesExist && (await Bun.file(executablePath).exists())) {
    try {
      await validateFfmpegBuild(executablePath)
      await writeArtifactMetadata(executablePath, metadataPath, triple, target.executable)
      return executablePath
    } catch {
      await rm(executablePath, { force: true })
    }
  }

  const buildDirectory = await mkdtemp(join(tmpdir(), 'termweave-ffmpeg-build-'))
  const sourceDirectory = resolve(buildDirectory, `ffmpeg-${ffmpegManifest.ffmpegVersion}`)
  try {
    await runRequired(
      ['tar', '-xf', sourceArchive, '-C', buildDirectory],
      buildDirectory,
      'FFmpeg extraction',
    )
    await runRequired(
      [resolve(sourceDirectory, 'configure'), ...ffmpegManifest.configure],
      sourceDirectory,
      'FFmpeg configuration',
    )
    await runRequired(
      ['make', `-j${Math.max(1, availableParallelism())}`, 'ffmpeg'],
      sourceDirectory,
      'FFmpeg build',
    )
    await copyFile(resolve(sourceDirectory, 'ffmpeg'), executablePath)
    await chmod(executablePath, 0o755)
    await copyFile(
      resolve(sourceDirectory, 'COPYING.LGPLv2.1'),
      resolve(resourceDirectory, 'COPYING.LGPLv2.1'),
    )
    await copyFile(
      resolve(sourceDirectory, 'LICENSE.md'),
      resolve(resourceDirectory, 'FFMPEG-LICENSE.md'),
    )
    await validateFfmpegBuild(executablePath)
    await writeArtifactMetadata(executablePath, metadataPath, triple, target.executable)
  } finally {
    await rm(buildDirectory, { force: true, recursive: true })
  }

  process.stdout.write(
    `Prepared bundled FFmpeg ${ffmpegManifest.ffmpegVersion} at ${executablePath}\n`,
  )
  return executablePath
}

if (import.meta.main) {
  try {
    await ensureFfmpegBinary()
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}
