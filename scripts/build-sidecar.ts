import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import solidPlugin from '@opentui/solid/bun-plugin'
import { errorMessage } from '../termweave/error-message'
import { ensureFfmpegBinary } from './build-ffmpeg'
import { getRustHostTuple } from './tooling'

const projectRoot = resolve(import.meta.dir, '..')

export type SidecarBuildMode = 'development' | 'production'

type BuildRunner = (
  options: Parameters<typeof Bun.build>[0],
) => Promise<{ success: boolean; logs: readonly unknown[] }>

type BuildSidecarOptions = {
  mode?: SidecarBuildMode
  root?: string
  triple?: string
  platform?: NodeJS.Platform
  bunExecutable?: string
  build?: BuildRunner
  prepareFfmpeg?: (root: string, triple: string) => Promise<string>
}

export function getSidecarBinaryPath(root: string, triple: string) {
  return resolve(root, `src-tauri/binaries/opentui-sidecar-${triple}`)
}

export async function buildSidecarBinary({
  mode = 'production',
  root = projectRoot,
  triple,
  platform = process.platform,
  bunExecutable = process.execPath,
  build = Bun.build,
  prepareFfmpeg = ensureFfmpegBinary,
}: BuildSidecarOptions = {}) {
  if (platform !== 'darwin') {
    throw new Error(`Termweave v2 sidecars support only macOS, not ${platform}`)
  }
  const hostTuple = triple ?? (await getRustHostTuple())
  if (!hostTuple.includes('apple-darwin')) {
    throw new Error(`Termweave v2 requires an Apple Darwin host tuple, not ${hostTuple}`)
  }
  const ffmpegPath = await prepareFfmpeg(root, hostTuple)
  const outputPath = getSidecarBinaryPath(root, hostTuple)
  await mkdir(resolve(root, 'src-tauri/binaries'), { recursive: true })

  const buildOptions: Parameters<typeof Bun.build>[0] = {
    entrypoints: [
      resolve(root, mode === 'production' ? 'app/index.tsx' : 'scripts/development-launcher.ts'),
    ],
    compile: { outfile: outputPath },
  }

  if (mode === 'production') {
    buildOptions.define = {
      'process.env.NODE_ENV': JSON.stringify('production'),
    }
    buildOptions.plugins = [solidPlugin]
  } else {
    buildOptions.define = {
      __TERMWEAVE_BUN_EXECUTABLE__: JSON.stringify(bunExecutable),
      __TERMWEAVE_FFMPEG_PATH__: JSON.stringify(ffmpegPath),
      __TERMWEAVE_PROJECT_ROOT__: JSON.stringify(root),
    }
  }

  const result = await build(buildOptions)

  if (!result.success) {
    const diagnostics = result.logs.map(String).join('\n').trim()
    const subject = mode === 'production' ? 'OpenTUI sidecar' : 'Development launcher'
    throw new Error(`${subject} build failed${diagnostics ? `:\n${diagnostics}` : ''}`)
  }

  return outputPath
}

export function buildProductionSidecar(options: Omit<BuildSidecarOptions, 'mode'> = {}) {
  return buildSidecarBinary({ ...options, mode: 'production' })
}

if (import.meta.main) {
  try {
    const requestedMode = process.argv[2] ?? 'production'
    if (requestedMode !== 'development' && requestedMode !== 'production') {
      throw new Error('Usage: bun scripts/build-sidecar.ts [development|production]')
    }

    const outputPath = await buildSidecarBinary({ mode: requestedMode })
    const subject =
      requestedMode === 'production' ? 'production sidecar' : 'development sidecar launcher'
    process.stdout.write(`Built ${subject} ${outputPath}\n`)
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}
