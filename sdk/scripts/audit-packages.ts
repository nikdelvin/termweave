import { resolve } from 'node:path'

type Audit = {
  command: string[]
  cwd: string
  label: string
  stdout?: 'ignore' | 'inherit'
}

const SDK_ROOT = resolve(import.meta.dir, '..')
const CARGO_MANIFEST_PATH = resolve(SDK_ROOT, 'src-tauri/Cargo.toml')
const audits: Audit[] = [
  {
    command: ['bun', 'scripts/update-dependencies.ts', '--check'],
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
  const subprocess = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdin: 'inherit',
    stdout,
    stderr: 'inherit',
  })
  const exitCode = await subprocess.exited
  if (exitCode !== 0) throw new Error(`${label} audit failed with exit code ${exitCode}`)
}

async function main() {
  for (const audit of audits) await runAudit(audit)
  process.stdout.write('All Tauri, sidecar, and project template package versions are locked.\n')
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
