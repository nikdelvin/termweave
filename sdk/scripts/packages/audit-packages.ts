import { resolve } from 'node:path'
import { runCli, runRequired } from '../lib/process'

type Audit = {
  command: string[]
  cwd: string
  label: string
  stdout?: 'ignore' | 'inherit'
}

type JsonObject = Record<string, unknown>

export type AllowedBunAuditFinding = {
  advisories: JsonObject[]
  packageName: string
}

export const ALLOWED_BUN_AUDIT_PACKAGES: ReadonlySet<string> = new Set(['brace-expansion'])

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
const bunVulnerabilityAudits = [
  {
    cwd: SDK_ROOT,
    label: 'Tauri Bun dependencies',
  },
  {
    cwd: resolve(SDK_ROOT, 'sidecar'),
    label: 'Sidecar Bun dependencies',
  },
  {
    cwd: resolve(SDK_ROOT, 'template'),
    label: 'Project template Bun dependencies',
  },
]

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseBunAuditOutput(
  output: string,
  allowedPackages: ReadonlySet<string> = ALLOWED_BUN_AUDIT_PACKAGES,
) {
  let report: unknown
  try {
    report = JSON.parse(output)
  } catch {
    throw new Error('Bun audit returned malformed JSON')
  }

  if (!isObject(report)) throw new Error('Bun audit report must be a JSON object')

  const allowedFindings: AllowedBunAuditFinding[] = []
  const blockedPackages: string[] = []
  for (const [packageName, advisories] of Object.entries(report)) {
    if (!Array.isArray(advisories) || advisories.some((advisory) => !isObject(advisory))) {
      throw new Error(`Bun audit report for ${packageName} must be an array of advisory objects`)
    }
    if (advisories.length === 0) continue

    if (allowedPackages.has(packageName)) {
      allowedFindings.push({ advisories, packageName })
    } else {
      blockedPackages.push(packageName)
    }
  }

  if (blockedPackages.length > 0) {
    throw new Error(
      `Bun audit found non-allowlisted vulnerable packages: ${blockedPackages.sort().join(', ')}`,
    )
  }

  return allowedFindings
}

async function runAudit({ command, cwd, label, stdout = 'inherit' }: Audit) {
  process.stdout.write(`Auditing ${label}...\n`)
  await runRequired(command, cwd, `${label} audit`, { stdout })
}

function advisorySummary(advisory: JsonObject) {
  const severity = typeof advisory.severity === 'string' ? advisory.severity : 'unknown severity'
  let identifier = String(advisory.id ?? 'unknown advisory')
  if (typeof advisory.url === 'string') {
    const urlSegments = advisory.url.split('/').filter(Boolean)
    identifier = urlSegments[urlSegments.length - 1] ?? identifier
  }
  return `${identifier} (${severity})`
}

async function runBunVulnerabilityAudit({ cwd, label }: { cwd: string; label: string }) {
  process.stdout.write(`Auditing ${label} for vulnerabilities...\n`)
  const subprocess = Bun.spawn(['bun', 'audit', '--json'], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, output, errorOutput] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ])

  if (exitCode !== 0 && exitCode !== 1) {
    const details = errorOutput.trim()
    throw new Error(
      `${label} vulnerability audit failed with exit code ${exitCode}${details ? `: ${details}` : ''}`,
    )
  }

  let allowedFindings: AllowedBunAuditFinding[]
  try {
    allowedFindings = parseBunAuditOutput(output)
  } catch (error) {
    throw new Error(
      `${label} vulnerability audit failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (exitCode === 1 && allowedFindings.length === 0) {
    throw new Error(`${label} vulnerability audit failed without reporting a vulnerability`)
  }

  for (const finding of allowedFindings) {
    const advisories = finding.advisories.map(advisorySummary).join(', ')
    process.stdout.write(
      `Allowed ${label} vulnerability package ${finding.packageName}: ${advisories} ` +
        '(package-scoped exception).\n',
    )
  }
}

async function main() {
  for (const audit of audits) await runAudit(audit)
  process.stdout.write('All Tauri, sidecar, and project template package versions are locked.\n')
  for (const audit of bunVulnerabilityAudits) await runBunVulnerabilityAudit(audit)
  process.stdout.write('All non-allowlisted Bun dependency vulnerability audits passed.\n')
}

if (import.meta.main) runCli(main)
