import { expect, test } from 'bun:test'
import { replaceBunRootWorkspaceName } from '../../../scripts/app/sync-app-config'

test('updates only the root Bun workspace name', () => {
  const lockfile = `{"workspaces":{"":{"name":"old-name"},"packages/demo":{"name":"demo"}}}`
  expect(replaceBunRootWorkspaceName(lockfile, 'new-name')).toBe(
    `{"workspaces":{"":{"name":"new-name"},"packages/demo":{"name":"demo"}}}`,
  )
})
