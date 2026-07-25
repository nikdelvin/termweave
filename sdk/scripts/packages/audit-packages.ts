import { resolve } from 'node:path'
import { runCli, runRequired } from '../lib/process'

type Audit = {
  command: string[]
  cwd: string
  label: string
  stdout?: 'ignore' | 'inherit'
}

const SDK_ROOT = resolve(import.meta.dir, '../..')
const CARGO_MANIFEST_PATH = resolve(SDK_ROOT, 'src-tauri/Cargo.toml')
const audits: Audit[] = [
  {
    command: ['bun', 'scripts/packages/check-packages.ts'],
    cwd: SDK_ROOT,
    label: 'Direct package versions',
  },
  {
    command: ['bun', 'install', '--frozen-lockfile', '--dry-run', '--ignore-scripts', '--silent'],
    cwd: SDK_ROOT,
    label: 'Tauri Bun lockfile',
  },
  {
    command: [
      'cargo',
      'metadata',
      '--manifest-path',
      CARGO_MANIFEST_PATH,
      '--no-deps',
      '--locked',
      '--format-version',
      '1',
    ],
    cwd: SDK_ROOT,
    label: 'Tauri Cargo lockfile',
    stdout: 'ignore',
  },
  {
    command: ['bun', 'install', '--frozen-lockfile', '--dry-run', '--ignore-scripts', '--silent'],
    cwd: resolve(SDK_ROOT, 'sidecar'),
    label: 'Sidecar Bun lockfile',
  },
  {
    command: ['bun', 'install', '--frozen-lockfile', '--dry-run', '--ignore-scripts', '--silent'],
    cwd: resolve(SDK_ROOT, 'template'),
    label: 'Project template Bun lockfile',
  },
]

async function runAudit({ command, cwd, label, stdout = 'inherit' }: Audit) {
  process.stdout.write(`Auditing ${label}...\n`)
  await runRequired(command, cwd, `${label} audit`, { stdout })
}

async function main() {
  for (const audit of audits) await runAudit(audit)
  process.stdout.write('All Tauri, sidecar, and project template package versions are locked.\n')
}

if (import.meta.main) runCli(main)
