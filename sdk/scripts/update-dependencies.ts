import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  TERMWEAVE_SDK_PACKAGE,
  TERMWEAVE_SDK_SIDECAR_DEPENDENCY,
  TERMWEAVE_SDK_TEMPLATE_DEPENDENCY,
} from './managed-package'

type DependencySection = 'dependencies' | 'devDependencies' | 'overrides'

type PackageJson = {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  overrides?: Record<string, string>
  patchedDependencies?: Record<string, string>
}

type Manifest = {
  label: string
  path: string
  packageJson: PackageJson
}

type DependencyChange = {
  dependency: string
  from: string
  manifest: string
  section: string
  to: string
}

type CargoDependency = {
  dependency: string
  section: 'build-dependencies' | 'dependencies'
  version: string
}

type StableVersion = {
  major: number
  minor: number
  patch: number
  version: string
}

const SDK_ROOT = resolve(import.meta.dir, '..')
const CARGO_MANIFEST_PATH = resolve(SDK_ROOT, 'src-tauri/Cargo.toml')
const DEPENDENCY_SECTIONS: DependencySection[] = ['dependencies', 'devDependencies', 'overrides']
const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const MANIFEST_PATHS = [
  { label: 'SDK', path: resolve(SDK_ROOT, 'package.json') },
  { label: 'sidecar', path: resolve(SDK_ROOT, 'sidecar/package.json') },
  { label: 'managed SDK', path: resolve(SDK_ROOT, 'sidecar/sdk/package.json') },
  { label: 'project template', path: resolve(SDK_ROOT, 'templates/project/package.json') },
] as const
const CARGO_DEPENDENCIES = [
  { dependency: 'tauri-build', section: 'build-dependencies' },
  { dependency: 'getrandom', section: 'dependencies' },
  { dependency: 'tauri', section: 'dependencies' },
  { dependency: 'serde', section: 'dependencies' },
  { dependency: 'tauri-plugin-shell', section: 'dependencies' },
] as const

async function readManifest(label: string, path: string): Promise<Manifest> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} package.json must contain an object`)
  }

  return { label, path, packageJson: value as PackageJson }
}

function dependencyEntries(manifest: Manifest) {
  return DEPENDENCY_SECTIONS.flatMap((section) =>
    Object.entries(manifest.packageJson[section] ?? {}).map(([dependency, version]) => ({
      dependency,
      manifest: manifest.label,
      section,
      version,
    })),
  )
}

function registryDependencyEntries(manifest: Manifest) {
  const patchedDependencies = new Set(
    Object.keys(manifest.packageJson.patchedDependencies ?? {}).map((specifier) => {
      const versionSeparator = specifier.lastIndexOf('@')
      return versionSeparator > 0 ? specifier.slice(0, versionSeparator) : specifier
    }),
  )

  return dependencyEntries(manifest).filter(
    ({ dependency }) =>
      dependency !== TERMWEAVE_SDK_PACKAGE && !patchedDependencies.has(dependency),
  )
}

function validatePinnedDependencies(manifests: Manifest[]) {
  const errors: string[] = []
  const sharedVersions = new Map<string, { manifest: string; version: string }>()

  for (const manifest of manifests) {
    for (const specifier of Object.keys(manifest.packageJson.patchedDependencies ?? {})) {
      const versionSeparator = specifier.lastIndexOf('@')
      const dependency = versionSeparator > 0 ? specifier.slice(0, versionSeparator) : specifier
      const version = versionSeparator > 0 ? specifier.slice(versionSeparator + 1) : ''
      const declaredVersion = manifest.packageJson.dependencies?.[dependency]

      if (!declaredVersion || declaredVersion !== version) {
        errors.push(
          `${manifest.label} patched dependency ${specifier} must match dependencies.${dependency}`,
        )
      }
    }

    for (const entry of dependencyEntries(manifest)) {
      if (entry.dependency === TERMWEAVE_SDK_PACKAGE) {
        const expectedVersion =
          entry.manifest === 'sidecar'
            ? TERMWEAVE_SDK_SIDECAR_DEPENDENCY
            : entry.manifest === 'project template'
              ? TERMWEAVE_SDK_TEMPLATE_DEPENDENCY
              : undefined
        if (
          entry.section !== 'dependencies' ||
          expectedVersion === undefined ||
          entry.version !== expectedVersion
        ) {
          errors.push(
            `${entry.manifest} ${TERMWEAVE_SDK_PACKAGE} must use its managed local dependency path`,
          )
        }
        continue
      }

      if (!EXACT_VERSION.test(entry.version)) {
        errors.push(
          `${entry.manifest} ${entry.section}.${entry.dependency} must use an exact semantic version; found ${entry.version}`,
        )
        continue
      }

      const existing = sharedVersions.get(entry.dependency)
      if (existing && existing.version !== entry.version) {
        errors.push(
          `${entry.dependency} must use one version across all manifests; ${existing.manifest} has ${existing.version} and ${entry.manifest} has ${entry.version}`,
        )
      } else {
        sharedVersions.set(entry.dependency, {
          manifest: entry.manifest,
          version: entry.version,
        })
      }
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'))
}

function cargoSection(contents: string, section: CargoDependency['section']) {
  const header = `[${section}]`
  const start = contents.indexOf(`${header}\n`)
  if (start < 0) throw new Error(`Cargo.toml is missing ${header}`)

  const bodyStart = start + header.length + 1
  const nextSection = contents.indexOf('\n[', bodyStart)
  return {
    body: contents.slice(bodyStart, nextSection < 0 ? contents.length : nextSection),
    bodyStart,
  }
}

function cargoDependencyVersion(
  contents: string,
  dependency: string,
  section: CargoDependency['section'],
) {
  const { body } = cargoSection(contents, section)
  const escapedDependency = dependency.replaceAll('-', String.raw`\-`)
  const line = new RegExp(
    String.raw`^${escapedDependency}\s*=\s*(?:"([^"]+)"|\{[^\n]*\bversion\s*=\s*"([^"]+)")`,
    'm',
  ).exec(body)
  const constraint = line?.[1] ?? line?.[2]
  if (!constraint) throw new Error(`Cargo.toml is missing ${section}.${dependency}`)
  if (!constraint.startsWith('=') || !EXACT_VERSION.test(constraint.slice(1))) {
    throw new Error(
      `Cargo.toml ${section}.${dependency} must use an exact version prefixed with =; found ${constraint}`,
    )
  }

  return constraint.slice(1)
}

function readCargoDependencies(contents: string): CargoDependency[] {
  return CARGO_DEPENDENCIES.map(({ dependency, section }) => ({
    dependency,
    section,
    version: cargoDependencyVersion(contents, dependency, section),
  }))
}

function replaceCargoDependencyVersion(
  contents: string,
  dependency: string,
  section: CargoDependency['section'],
  currentVersion: string,
  nextVersion: string,
) {
  const { body, bodyStart } = cargoSection(contents, section)
  const escapedDependency = dependency.replaceAll('-', String.raw`\-`)
  const linePattern = new RegExp(String.raw`^${escapedDependency}\s*=.*$`, 'm')
  const match = linePattern.exec(body)
  if (!match || match.index === undefined) {
    throw new Error(`Cargo.toml is missing ${section}.${dependency}`)
  }

  const updatedLine = match[0].replace(`"=${currentVersion}"`, `"=${nextVersion}"`)
  if (updatedLine === match[0]) {
    throw new Error(`Could not update Cargo.toml ${section}.${dependency}`)
  }

  const lineStart = bodyStart + match.index
  return `${contents.slice(0, lineStart)}${updatedLine}${contents.slice(lineStart + match[0].length)}`
}

function parseStableVersion(version: string): StableVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!match) return undefined

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    version,
  }
}

function compareVersions(left: StableVersion, right: StableVersion) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch
}

async function resolveVersion(
  dependency: string,
  currentVersion: string,
  includeBreaking: boolean,
) {
  const current = parseStableVersion(currentVersion)
  if (!current) {
    throw new Error(
      `${dependency} must use a stable major.minor.patch version before it can be updated`,
    )
  }

  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(dependency)}`, {
    headers: {
      Accept: 'application/vnd.npm.install-v1+json',
      'User-Agent': 'termweave-dependency-updater',
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(
      `Could not resolve ${dependency}: npm registry returned ${response.status} ${response.statusText}`,
    )
  }

  const value = (await response.json()) as { versions?: unknown }
  if (typeof value.versions !== 'object' || value.versions === null) {
    throw new Error(`Could not resolve ${dependency}: npm returned no package versions`)
  }

  const candidates = Object.keys(value.versions)
    .map(parseStableVersion)
    .filter((version): version is StableVersion => {
      if (!version) return false
      if (includeBreaking) return true
      if (current.major === 0) {
        return version.major === current.major && version.minor === current.minor
      }
      return version.major === current.major
    })
    .sort(compareVersions)

  const resolved = candidates[candidates.length - 1]
  if (!resolved) {
    throw new Error(`Could not resolve a compatible stable version for ${dependency}`)
  }

  return resolved.version
}

async function resolveExactNpmPeer(dependency: string, version: string, peerDependency: string) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(dependency)}/${encodeURIComponent(version)}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'termweave-dependency-updater',
      },
      signal: AbortSignal.timeout(30_000),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Could not resolve ${dependency}@${version}: npm registry returned ${response.status} ${response.statusText}`,
    )
  }

  const value = (await response.json()) as {
    peerDependencies?: Record<string, unknown>
  }
  const peerVersion = value.peerDependencies?.[peerDependency]
  return typeof peerVersion === 'string' && EXACT_VERSION.test(peerVersion)
    ? peerVersion
    : undefined
}

async function resolveCargoVersion(
  dependency: string,
  currentVersion: string,
  includeBreaking: boolean,
) {
  const current = parseStableVersion(currentVersion)
  if (!current) {
    throw new Error(
      `${dependency} must use a stable major.minor.patch version before it can be updated`,
    )
  }

  const response = await fetch(
    `https://crates.io/api/v1/crates/${encodeURIComponent(dependency)}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'termweave-dependency-updater',
      },
      signal: AbortSignal.timeout(30_000),
    },
  )

  if (!response.ok) {
    throw new Error(
      `Could not resolve ${dependency}: crates.io returned ${response.status} ${response.statusText}`,
    )
  }

  const value = (await response.json()) as {
    versions?: Array<{ num?: unknown; yanked?: unknown }>
  }
  if (!Array.isArray(value.versions)) {
    throw new Error(`Could not resolve ${dependency}: crates.io returned no package versions`)
  }

  const candidates = value.versions
    .filter(({ yanked }) => yanked !== true)
    .map(({ num }) => (typeof num === 'string' ? parseStableVersion(num) : undefined))
    .filter((version): version is StableVersion => {
      if (!version) return false
      if (includeBreaking) return true
      if (current.major === 0) {
        return version.major === current.major && version.minor === current.minor
      }
      return version.major === current.major
    })
    .sort(compareVersions)

  const resolved = candidates[candidates.length - 1]
  if (!resolved) {
    throw new Error(`Could not resolve a compatible stable version for ${dependency}`)
  }

  return resolved.version
}

async function runRequired(command: string[], cwd: string, description: string) {
  const subprocess = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await subprocess.exited
  if (exitCode !== 0) throw new Error(`${description} failed with exit code ${exitCode}`)
}

function parseMode() {
  const arguments_ = process.argv.slice(2)
  const supported = new Set(['--check', '--dry-run', '--latest'])
  const unsupported = arguments_.filter((argument) => !supported.has(argument))
  const uniqueArguments = new Set(arguments_)

  if (
    unsupported.length > 0 ||
    uniqueArguments.size !== arguments_.length ||
    (uniqueArguments.has('--check') && uniqueArguments.size > 1)
  ) {
    throw new Error('Usage: bun scripts/update-dependencies.ts [--check | [--dry-run] [--latest]]')
  }

  return {
    check: uniqueArguments.has('--check'),
    dryRun: uniqueArguments.has('--dry-run'),
    includeBreaking: uniqueArguments.has('--latest'),
  }
}

async function main() {
  const mode = parseMode()
  const [manifests, originalCargoManifest] = await Promise.all([
    Promise.all(MANIFEST_PATHS.map(({ label, path }) => readManifest(label, path))),
    readFile(CARGO_MANIFEST_PATH, 'utf8'),
  ])
  const cargoDependencies = readCargoDependencies(originalCargoManifest)

  validatePinnedDependencies(manifests)
  if (mode.check) {
    process.stdout.write(
      'Managed Bun and Cargo dependency versions are exact; shared Bun versions are aligned across the SDK.\n',
    )
    return
  }

  const currentVersions = new Map(
    manifests
      .flatMap(registryDependencyEntries)
      .map(({ dependency, version }) => [dependency, version] as const),
  )
  const dependencies = [...currentVersions].sort(([left], [right]) => left.localeCompare(right))
  process.stdout.write(
    `Resolving ${dependencies.length} direct Bun packages from npm and ${cargoDependencies.length} Rust crates from crates.io${mode.includeBreaking ? ', including breaking releases' : ''}...\n`,
  )

  const resolvedVersions = new Map(
    await Promise.all(
      dependencies.map(
        async ([dependency, currentVersion]) =>
          [
            dependency,
            await resolveVersion(dependency, currentVersion, mode.includeBreaking),
          ] as const,
      ),
    ),
  )
  const resolvedCargoVersions = new Map(
    await Promise.all(
      cargoDependencies.map(
        async ({ dependency, version }) =>
          [
            dependency,
            await resolveCargoVersion(dependency, version, mode.includeBreaking),
          ] as const,
      ),
    ),
  )
  const openTuiSolidVersion = resolvedVersions.get('@opentui/solid')
  if (openTuiSolidVersion && resolvedVersions.has('solid-js')) {
    const exactSolidPeer = await resolveExactNpmPeer(
      '@opentui/solid',
      openTuiSolidVersion,
      'solid-js',
    )
    if (exactSolidPeer) resolvedVersions.set('solid-js', exactSolidPeer)
  }
  const changes: DependencyChange[] = []

  for (const manifest of manifests) {
    for (const entry of registryDependencyEntries(manifest)) {
      const nextVersion = resolvedVersions.get(entry.dependency)
      if (!nextVersion) throw new Error(`No resolved version for ${entry.dependency}`)
      if (entry.version === nextVersion) continue

      changes.push({
        dependency: entry.dependency,
        from: entry.version,
        manifest: entry.manifest,
        section: entry.section,
        to: nextVersion,
      })
      manifest.packageJson[entry.section]![entry.dependency] = nextVersion
    }
  }

  let nextCargoManifest = originalCargoManifest
  for (const entry of cargoDependencies) {
    const nextVersion = resolvedCargoVersions.get(entry.dependency)
    if (!nextVersion) throw new Error(`No resolved version for Rust crate ${entry.dependency}`)
    if (entry.version === nextVersion) continue

    changes.push({
      dependency: entry.dependency,
      from: entry.version,
      manifest: 'Cargo',
      section: entry.section,
      to: nextVersion,
    })
    nextCargoManifest = replaceCargoDependencyVersion(
      nextCargoManifest,
      entry.dependency,
      entry.section,
      entry.version,
      nextVersion,
    )
  }

  if (changes.length === 0) {
    process.stdout.write(
      `All direct dependencies already use the latest ${mode.includeBreaking ? '' : 'compatible '}stable versions.\n`,
    )
    return
  }

  for (const change of changes) {
    process.stdout.write(
      `${change.manifest} ${change.section}.${change.dependency}: ${change.from} -> ${change.to}\n`,
    )
  }

  validatePinnedDependencies(manifests)
  if (mode.dryRun) {
    process.stdout.write(`\nDry run complete; ${changes.length} manifest entries would change.\n`)
    return
  }

  await Promise.all([
    ...manifests.map(({ path, packageJson }) =>
      writeFile(path, `${JSON.stringify(packageJson, null, 2)}\n`),
    ),
    writeFile(CARGO_MANIFEST_PATH, nextCargoManifest),
  ])
  const managedSdkChanged = changes.some((change) => change.manifest === 'managed SDK')
  await runRequired(['bun', 'install'], SDK_ROOT, 'SDK dependency installation')
  if (managedSdkChanged) {
    await rm(resolve(SDK_ROOT, 'sidecar/bun.lock'), { force: true })
  }
  await runRequired(
    ['bun', 'install'],
    resolve(SDK_ROOT, 'sidecar'),
    'Sidecar dependency installation',
  )
  if (managedSdkChanged) {
    await rm(resolve(SDK_ROOT, 'templates/project/bun.lock'), { force: true })
  }
  await runRequired(
    ['bun', 'install', '--lockfile-only'],
    resolve(SDK_ROOT, 'templates/project'),
    'Project template lockfile generation',
  )
  await runRequired(
    ['cargo', 'generate-lockfile', '--manifest-path', CARGO_MANIFEST_PATH],
    SDK_ROOT,
    'Cargo lockfile generation',
  )
  await runRequired(['bun', 'run', 'app:check'], SDK_ROOT, 'Updated dependency checks')
  await runRequired(
    [
      'cargo',
      'metadata',
      '--manifest-path',
      CARGO_MANIFEST_PATH,
      '--no-deps',
      '--locked',
      '--format-version',
      '1',
    ],
    SDK_ROOT,
    'Cargo manifest validation',
  )

  process.stdout.write(
    `\nUpdated ${changes.length} manifest entries and regenerated the Bun and Cargo lockfiles.\n`,
  )
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
