import { describe, expect, test } from 'bun:test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  assertScaffoldAvailable,
  createScaffold,
  setLockfileSdkDependency,
  setLockfileWorkspaceName,
  slugify,
  titleFromSlug,
} from '../../../scripts/project/install-project'
import { TERMWEAVE_SDK_DEPENDENCY } from '../../../scripts/packages/managed-package'
import { withTemporaryDirectory } from '../../helpers/temporary-directory'

const SDK_ROOT = resolve(import.meta.dir, '../../..')

describe('project installer', () => {
  test('normalizes package names and titles', () => {
    expect(slugify('  42 My New_App  ')).toBe('my-new-app')
    expect(titleFromSlug('my-new-app')).toBe('My New App')
  })

  test('rewrites managed lockfile values', () => {
    const lockfile =
      '{"workspaces":{"":{"name":"termweave-app","dependencies":{"@termweave/sdk":"file:../sidecar/sdk"}}}}'
    const updated = setLockfileSdkDependency(setLockfileWorkspaceName(lockfile, 'example-app'))
    expect(updated).toContain('"name":"example-app"')
    expect(updated).toContain(TERMWEAVE_SDK_DEPENDENCY)
  })

  test('reports all scaffold conflicts', () =>
    withTemporaryDirectory(async (projectRoot) => {
      await Promise.all([
        mkdir(resolve(projectRoot, 'src')),
        mkdir(resolve(projectRoot, 'patches')),
      ])
      await expect(assertScaffoldAvailable(projectRoot)).rejects.toThrow('src, patches')
    }))

  test('creates a standalone project from the canonical template', () =>
    withTemporaryDirectory(async (projectRoot) => {
      await createScaffold(
        projectRoot,
        {
          name: 'Test App',
          packageName: 'test-app',
          bundleIdentifier: 'com.example.test-app',
          author: 'Test Author',
          description: 'Test description.',
        },
        SDK_ROOT,
      )

      const packageJson = JSON.parse(
        await readFile(resolve(projectRoot, 'package.json'), 'utf8'),
      ) as {
        name: string
        dependencies: Record<string, string>
      }
      const appConfig = JSON.parse(
        await readFile(resolve(projectRoot, 'app.config.json'), 'utf8'),
      ) as {
        name: string
        packageName: string
        authors: string[]
      }
      expect(packageJson.name).toBe('test-app')
      expect(packageJson.dependencies['@termweave/sdk']).toBe('file:termweave/sdk/sidecar/sdk')
      expect(appConfig).toMatchObject({
        name: 'Test App',
        packageName: 'test-app',
        authors: ['Test Author'],
      })
      expect(await Bun.file(resolve(projectRoot, 'src/App.tsx')).exists()).toBe(true)
      expect(await Bun.file(resolve(projectRoot, 'src/index.tsx')).exists()).toBe(false)
      expect(await Bun.file(resolve(projectRoot, 'src/runtime/config.ts')).exists()).toBe(false)
    }))
})
