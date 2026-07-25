import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import solidPlugin from '@opentui/solid/bun-plugin'

export type SidecarBuildMode = 'development' | 'production'

const SIDECAR_ROOT = resolve(import.meta.dir, '..')

export function getSidecarOutputPath(
  sdkRoot: string,
  triple: string,
  platform: NodeJS.Platform = process.platform,
) {
  const extension = platform === 'win32' ? '.exe' : ''
  return resolve(sdkRoot, `src-tauri/binaries/opentui-sidecar-${triple}${extension}`)
}

async function getHostTuple() {
  const subprocess = Bun.spawn(['rustc', '--print', 'host-tuple'], {
    cwd: SIDECAR_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(
      `Could not determine the Rust host tuple: ${stderr.trim() || `exit ${exitCode}`}`,
    )
  }
  return stdout.trim()
}

export async function buildSidecar(mode: SidecarBuildMode, sidecarRoot = SIDECAR_ROOT) {
  const sdkRoot = resolve(sidecarRoot, '..')
  const outfile = getSidecarOutputPath(sdkRoot, await getHostTuple())
  await mkdir(resolve(sdkRoot, 'src-tauri/binaries'), { recursive: true })

  const buildOptions: Parameters<typeof Bun.build>[0] = {
    entrypoints: [
      resolve(sidecarRoot, mode === 'production' ? 'src/index.tsx' : 'scripts/dev-launcher.ts'),
    ],
    compile: { outfile },
  }
  if (mode === 'production') {
    buildOptions.plugins = [solidPlugin]
  } else {
    buildOptions.define = {
      __TERMWEAVE_SIDECAR_ROOT__: JSON.stringify(sidecarRoot),
    }
  }

  const result = await Bun.build(buildOptions)
  if (!result.success) {
    throw new Error(result.logs.map(String).join('\n'))
  }

  process.stdout.write(
    `Built ${mode === 'production' ? 'production sidecar' : 'development sidecar launcher'} ${outfile}\n`,
  )
}

if (import.meta.main) {
  const mode = process.argv[2] ?? 'production'
  if (mode !== 'production' && mode !== 'development') {
    throw new Error('Usage: bun scripts/build-sidecar.ts [production|development]')
  }
  await buildSidecar(mode)
}
