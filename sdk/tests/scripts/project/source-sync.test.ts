import { expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  readSourceTreeState,
  synchronizeSourceTree,
  syncProject,
} from '../../../scripts/project/source-sync'
import { validAppConfig } from '../../helpers/app-config'
import { withTemporaryDirectory } from '../../helpers/temporary-directory'

test('synchronizes project source and removes stale sidecar files', () =>
  withTemporaryDirectory(async (root) => {
    const projectRoot = resolve(root, 'project')
    const sdkRoot = resolve(root, 'sdk')
    await Promise.all([
      mkdir(resolve(projectRoot, 'src/routes'), { recursive: true }),
      mkdir(resolve(sdkRoot, 'sidecar/src/routes'), { recursive: true }),
      mkdir(resolve(sdkRoot, 'sidecar/src/runtime'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(resolve(projectRoot, 'src/App.tsx'), 'export function App() {}'),
      writeFile(resolve(projectRoot, 'src/routes/Home.tsx'), 'export const Home = 1'),
      writeFile(
        resolve(projectRoot, 'app.config.json'),
        `${JSON.stringify(validAppConfig(), null, 2)}\n`,
      ),
      writeFile(resolve(projectRoot, 'app.icon.png'), 'icon'),
      writeFile(resolve(sdkRoot, 'sidecar/src/index.tsx'), 'reserved entry'),
      writeFile(resolve(sdkRoot, 'sidecar/src/runtime/config.ts'), 'managed runtime'),
      writeFile(resolve(sdkRoot, 'sidecar/src/routes/Stale.tsx'), 'stale'),
    ])

    const result = await syncProject(projectRoot, sdkRoot)

    expect(result.files).toEqual(['App.tsx', 'routes/Home.tsx'])
    expect(await readFile(resolve(sdkRoot, 'sidecar/src/index.tsx'), 'utf8')).toBe('reserved entry')
    expect(await readFile(resolve(sdkRoot, 'sidecar/src/runtime/config.ts'), 'utf8')).toBe(
      'managed runtime',
    )
    expect(await Bun.file(resolve(sdkRoot, 'sidecar/src/routes/Stale.tsx')).exists()).toBe(false)
    expect(await readFile(resolve(sdkRoot, 'sidecar/src/routes/Home.tsx'), 'utf8')).toBe(
      'export const Home = 1',
    )
    expect(await Bun.file(resolve(sdkRoot, 'app.icon.png')).exists()).toBe(true)
  }))

test('rejects project files inside SDK-managed source paths', () =>
  withTemporaryDirectory(async (root) => {
    const projectRoot = resolve(root, 'project')
    const sdkRoot = resolve(root, 'sdk')
    await Promise.all([
      mkdir(resolve(projectRoot, 'src/runtime'), { recursive: true }),
      mkdir(resolve(sdkRoot, 'sidecar/src'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(resolve(projectRoot, 'src/App.tsx'), 'export function App() {}'),
      writeFile(resolve(projectRoot, 'src/runtime/custom.ts'), 'project runtime'),
    ])

    await expect(synchronizeSourceTree(projectRoot, sdkRoot)).rejects.toThrow(
      'src/runtime/custom.ts is managed by the Termweave SDK',
    )
  }))

test('distinguishes source edits from synchronization reads', () =>
  withTemporaryDirectory(async (root) => {
    const projectRoot = resolve(root, 'project')
    const sdkRoot = resolve(root, 'sdk')
    const assetPath = resolve(projectRoot, 'src/asset.gif')
    await Promise.all([
      mkdir(resolve(projectRoot, 'src'), { recursive: true }),
      mkdir(resolve(sdkRoot, 'sidecar/src'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(resolve(projectRoot, 'src/App.tsx'), 'export function App() {}'),
      writeFile(assetPath, new Uint8Array([1, 2, 3])),
    ])

    const initialState = await readSourceTreeState(projectRoot)
    await synchronizeSourceTree(projectRoot, sdkRoot)

    expect(await readSourceTreeState(projectRoot)).toBe(initialState)

    await writeFile(assetPath, new Uint8Array([3, 2, 1]))
    expect(await readSourceTreeState(projectRoot)).not.toBe(initialState)
  }))
