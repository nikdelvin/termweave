import { mkdir } from 'node:fs/promises'
import solidPlugin from '@opentui/solid/bun-plugin'

const triple = (await Bun.$`rustc --print host-tuple`.text()).trim()
const extension = process.platform === 'win32' ? '.exe' : ''
const outfile = `../src-tauri/binaries/opentui-sidecar-${triple}${extension}`

await mkdir('../src-tauri/binaries', { recursive: true })

const result = await Bun.build({
  entrypoints: ['./src/index.tsx'],
  plugins: [solidPlugin],
  compile: { outfile },
})

if (!result.success) {
  for (const log of result.logs) process.stderr.write(`${log}\n`)
  process.exit(1)
}

process.stdout.write(`Built ${outfile}\n`)
