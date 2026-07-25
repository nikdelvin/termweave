import { describe, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readActiveProcess, withActiveProcess } from '../../../scripts/project/active-process'
import { copyBuildOutputs } from '../../../scripts/project/manage-project'
import { withTemporaryDirectory } from '../../helpers/temporary-directory'

describe('project lifecycle', () => {
  test('records and removes the active command', () =>
    withTemporaryDirectory(async (sdkRoot) => {
      await withActiveProcess(sdkRoot, 'dev', '/project', async () => {
        expect(await readActiveProcess(sdkRoot)).toEqual({
          command: 'dev',
          pid: process.pid,
          projectRoot: '/project',
        })
      })
      expect(await readActiveProcess(sdkRoot)).toBeUndefined()
    }))

  test('replaces old project build outputs', () =>
    withTemporaryDirectory(async (root) => {
      const projectRoot = resolve(root, 'project')
      const sdkRoot = resolve(root, 'sdk')
      await Promise.all([
        mkdir(resolve(projectRoot, 'build'), { recursive: true }),
        mkdir(resolve(sdkRoot, 'src-tauri/target/release/bundle'), { recursive: true }),
      ])
      await Promise.all([
        writeFile(resolve(projectRoot, 'build/old.txt'), 'old'),
        writeFile(resolve(sdkRoot, 'src-tauri/target/release/bundle/new.txt'), 'new'),
      ])

      await copyBuildOutputs(projectRoot, sdkRoot)

      expect(await Bun.file(resolve(projectRoot, 'build/old.txt')).exists()).toBe(false)
      expect(await readFile(resolve(projectRoot, 'build/new.txt'), 'utf8')).toBe('new')
    }))
})
