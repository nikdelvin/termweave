import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  TERMWEAVE_SDK_PACKAGE,
  TERMWEAVE_SDK_SIDECAR_DEPENDENCY,
  TERMWEAVE_SDK_TEMPLATE_DEPENDENCY,
} from './managed-package'
import { runCli } from '../lib/process'

type DependencySection =
  'dependencies' | 'devDependencies' | 'optionalDependencies' | 'overrides' | 'peerDependencies'

export type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  overrides?: Record<string, string>
  patchedDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export type Manifest = {
  label: string
  packageJson: PackageJson
}

const SDK_ROOT = resolve(import.meta.dir, '../..')
const CARGO_MANIFEST_PATH = resolve(SDK_ROOT, 'src-tauri/Cargo.toml')
const DEPENDENCY_SECTIONS: DependencySection[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'overrides',
  'peerDependencies',
]
const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const MANIFEST_PATHS = [
  { label: 'SDK', path: resolve(SDK_ROOT, 'package.json') },
  { label: 'sidecar', path: resolve(SDK_ROOT, 'sidecar/package.json') },
  { label: 'managed SDK', path: resolve(SDK_ROOT, 'sidecar/sdk/package.json') },
  { label: 'project template', path: resolve(SDK_ROOT, 'template/package.json') },
] as const

async function readManifest(label: string, path: string): Promise<Manifest> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} package.json must contain an object`)
  }

  return { label, packageJson: value as PackageJson }
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

export function validatePinnedDependencies(manifests: Manifest[]) {
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

export function validatePinnedCargoDependencies(contents: string) {
  const manifest = Bun.TOML.parse(contents) as Record<string, unknown>
  const errors: string[] = []

  for (const section of ['build-dependencies', 'dependencies', 'dev-dependencies']) {
    const dependencies = manifest[section]
    if (dependencies === undefined) continue
    if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
      errors.push(`Cargo.toml [${section}] must contain a table`)
      continue
    }

    for (const [dependency, specifier] of Object.entries(dependencies)) {
      const constraint =
        typeof specifier === 'string'
          ? specifier
          : typeof specifier === 'object' &&
              specifier !== null &&
              !Array.isArray(specifier) &&
              typeof (specifier as Record<string, unknown>).version === 'string'
            ? (specifier as Record<string, string>).version
            : undefined

      if (
        constraint === undefined ||
        !constraint.startsWith('=') ||
        !EXACT_VERSION.test(constraint.slice(1))
      ) {
        errors.push(
          `Cargo.toml ${section}.${dependency} must use an exact version prefixed with =; found ${constraint ?? 'no version'}`,
        )
      }
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'))
}

async function main() {
  const [manifests, cargoManifest] = await Promise.all([
    Promise.all(MANIFEST_PATHS.map(({ label, path }) => readManifest(label, path))),
    readFile(CARGO_MANIFEST_PATH, 'utf8'),
  ])

  validatePinnedDependencies(manifests)
  validatePinnedCargoDependencies(cargoManifest)
  process.stdout.write(
    'Managed Bun and Cargo dependency versions are exact; shared Bun versions are aligned across the SDK.\n',
  )
}

if (import.meta.main) runCli(main)
