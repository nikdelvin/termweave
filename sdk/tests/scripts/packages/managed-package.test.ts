import { expect, test } from 'bun:test'
import {
  mergeManagedPackage,
  TERMWEAVE_SDK_DEPENDENCY,
} from '../../../scripts/packages/managed-package'

test('merges managed package sections without removing user entries', () => {
  const merged = mergeManagedPackage(
    {
      name: 'example',
      scripts: { custom: 'custom-command', dev: 'old-command' },
      dependencies: { custom: '1.0.0' },
    },
    {
      scripts: { dev: 'managed-command' },
      dependencies: { managed: '2.0.0' },
    },
  )

  expect(merged.scripts).toEqual({
    custom: 'custom-command',
    dev: 'managed-command',
  })
  expect(merged.dependencies).toEqual({
    custom: '1.0.0',
    managed: '2.0.0',
    '@termweave/sdk': TERMWEAVE_SDK_DEPENDENCY,
  })
})
