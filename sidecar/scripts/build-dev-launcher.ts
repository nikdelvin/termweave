import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const sidecarRoot = resolve(import.meta.dir, '..')
const triple = (await Bun.$`rustc --print host-tuple`.text()).trim()
const extension = process.platform === 'win32' ? '.exe' : ''
const outfile = `../src-tauri/binaries/opentui-sidecar-${triple}${extension}`

await mkdir('../src-tauri/binaries', { recursive: true })

const result = await Bun.build({
  entrypoints: ['./scripts/dev-launcher.ts'],
  define: {
    __TERMWEAVE_SIDECAR_ROOT__: JSON.stringify(sidecarRoot),
  },
  compile: { outfile },
})

if (!result.success) {
  for (const log of result.logs) process.stderr.write(`${log}\n`)
  process.exit(1)
}

process.stdout.write(`Built development sidecar launcher ${outfile}\n`)
