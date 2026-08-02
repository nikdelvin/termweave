import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import solidPlugin from '@opentui/solid/bun-plugin'

const projectRoot = resolve(import.meta.dir, '..')

type BuildRunner = (
  options: Parameters<typeof Bun.build>[0],
) => Promise<{ success: boolean; logs: readonly unknown[] }>

type BuildSidecarOptions = {
  root?: string
  triple?: string
  platform?: NodeJS.Platform
  build?: BuildRunner
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function getSidecarOutputPath(
  root: string,
  triple: string,
  platform: NodeJS.Platform = process.platform,
) {
  const extension = platform === 'win32' ? '.exe' : ''
  return resolve(root, `src-tauri/binaries/opentui-sidecar-${triple}${extension}`)
}

export async function getHostTuple() {
  const child = Bun.spawn(['rustc', '--print', 'host-tuple'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  const triple = stdout.trim()
  if (exitCode !== 0 || triple === '') {
    throw new Error(
      `Could not determine the Rust host tuple: ${stderr.trim() || `exit ${exitCode}`}`,
    )
  }
  return triple
}

export async function buildProductionSidecar({
  root = projectRoot,
  triple,
  platform = process.platform,
  build = Bun.build,
}: BuildSidecarOptions = {}) {
  const hostTuple = triple ?? (await getHostTuple())
  const outputPath = getSidecarOutputPath(root, hostTuple, platform)
  await mkdir(resolve(root, 'src-tauri/binaries'), { recursive: true })

  const result = await build({
    entrypoints: [resolve(root, 'app/index.tsx')],
    compile: { outfile: outputPath },
    define: {
      'process.env.DEBUG': 'undefined',
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    plugins: [solidPlugin],
  })

  if (!result.success) {
    const diagnostics = result.logs.map(String).join('\n').trim()
    throw new Error(`OpenTUI sidecar build failed${diagnostics ? `:\n${diagnostics}` : ''}`)
  }

  return outputPath
}

if (import.meta.main) {
  try {
    const outputPath = await buildProductionSidecar()
    process.stdout.write(`Built production sidecar ${outputPath}\n`)
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}
