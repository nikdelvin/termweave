import { describe, expect, test } from 'bun:test'
import {
  validatePinnedCargoDependencies,
  validatePinnedDependencies,
  type Manifest,
} from '../../../scripts/packages/check-packages'

const manifests: Manifest[] = [
  {
    label: 'SDK',
    packageJson: { dependencies: { example: '1.2.3' } },
  },
  {
    label: 'sidecar',
    packageJson: {
      dependencies: {
        example: '1.2.3',
        '@termweave/sdk': 'file:./sdk',
      },
    },
  },
  {
    label: 'project template',
    packageJson: {
      dependencies: {
        example: '1.2.3',
        '@termweave/sdk': 'file:../sidecar/sdk',
      },
    },
  },
]

describe('package policy', () => {
  test('accepts exact and aligned Bun dependency versions', () => {
    expect(() => validatePinnedDependencies(manifests)).not.toThrow()
  })

  test('rejects ranges and shared version drift', () => {
    const invalid = structuredClone(manifests)
    invalid[1]!.packageJson.dependencies!.example = '^1.2.3'
    expect(() => validatePinnedDependencies(invalid)).toThrow('exact semantic version')
  })

  test('requires exact Cargo versions', () => {
    expect(() =>
      validatePinnedCargoDependencies(`
[dependencies]
serde = { version = "=1.0.0", features = ["derive"] }
`),
    ).not.toThrow()
    expect(() =>
      validatePinnedCargoDependencies(`
[dependencies]
serde = "1.0"
`),
    ).toThrow('exact version prefixed with =')
  })
})
