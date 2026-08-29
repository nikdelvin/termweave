import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import {
  collectBundledMediaAssets,
  desktopIconFiles,
  getOpenTuiNativeAsset,
  prepareProject,
  type IconGenerator,
} from '../scripts/prepare'
import { getFfmpegResourceDirectory } from '../scripts/build-ffmpeg'
import { FFMPEG_RESOURCE_DIRECTORY } from '../termweave/constants'
import { validAppConfig } from './support/app-config'

let root = ''

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function createProject(
  config: Record<string, unknown> = validAppConfig(),
  includeNativeAsset = true,
) {
  await mkdir(resolve(root, 'src-tauri'), { recursive: true })
  await writeJson(resolve(root, 'app.config.json'), config)
  await writeFile(resolve(root, 'app.icon.png'), 'test icon')
  await writeFile(resolve(root, 'package.json'), '{"private":true}\n')
  await writeFile(resolve(root, 'bun.lock'), 'lockfile\n')
  await writeFile(resolve(root, 'src-tauri/tauri.conf.json'), '{"bundle":{}}\n')
  if (includeNativeAsset) {
    const asset = getOpenTuiNativeAsset(root)
    await mkdir(dirname(asset.sourcePath), { recursive: true })
    await writeFile(asset.sourcePath, 'native runtime')
  }
}

async function createIcons(outputDirectory: string) {
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all(
    desktopIconFiles.map((icon) => writeFile(resolve(outputDirectory, icon), `generated ${icon}`)),
  )
}

async function listFiles(directory: string) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => relative(directory, resolve(entry.parentPath, entry.name)))
    .sort()
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'termweave-v2-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('preparation', () => {
  test('selects only the Apple Silicon and Intel macOS native runtimes', () => {
    expect(getOpenTuiNativeAsset('/sdk', 'darwin', 'arm64')).toMatchObject({
      packageName: '@opentui/core-darwin-arm64',
      fileName: 'libopentui.dylib',
      resourcePath: 'opentui-assets/@opentui/core-darwin-arm64/libopentui.dylib',
    })
    expect(getOpenTuiNativeAsset('/sdk', 'darwin', 'x64')).toMatchObject({
      packageName: '@opentui/core-darwin-x64',
      fileName: 'libopentui.dylib',
    })
    expect(() => getOpenTuiNativeAsset('/sdk', 'linux', 'x64')).toThrow(
      'supports only macOS arm64 and x64',
    )
    expect(() => getOpenTuiNativeAsset('/sdk', 'darwin', 'ia32')).toThrow(
      'supports only macOS arm64 and x64',
    )
  })

  test('writes only generated icons and the exact Tauri override', async () => {
    await createProject()
    const originalFiles = await listFiles(root)
    const originalContents = new Map(
      await Promise.all(
        originalFiles.map(
          async (file) => [file, await readFile(resolve(root, file), 'utf8')] as const,
        ),
      ),
    )
    const calls: Parameters<IconGenerator>[0][] = []
    const generateIcons: IconGenerator = async (options) => {
      calls.push(options)
      await createIcons(options.outputDirectory)
    }

    const result = await prepareProject({ root, generateIcons })

    expect(calls).toEqual([
      {
        root,
        iconPath: resolve(root, 'app.icon.png'),
        outputDirectory: resolve(root, 'src-tauri/.generated/icons'),
      },
    ])
    expect(JSON.parse(await readFile(result.overridePath, 'utf8'))).toEqual({
      productName: 'Termweave App',
      version: '0.1.0',
      identifier: 'com.example.termweave-app',
      app: {
        windows: [
          {
            label: 'main',
            title: 'Termweave App',
            backgroundColor: '#010416',
          },
        ],
      },
      bundle: {
        icon: desktopIconFiles.map((icon) => `.generated/icons/${icon}`),
        externalBin: ['binaries/opentui-sidecar', 'binaries/ffmpeg'],
        resources: {
          [getOpenTuiNativeAsset(root).sourcePath]: getOpenTuiNativeAsset(root).resourcePath,
          [getFfmpegResourceDirectory(root)]: FFMPEG_RESOURCE_DIRECTORY,
        },
      },
    })

    for (const [file, contents] of originalContents) {
      expect(await readFile(resolve(root, file), 'utf8')).toBe(contents)
    }
    const addedFiles = (await listFiles(root)).filter((file) => !originalContents.has(file))
    expect(addedFiles).toEqual([
      'src-tauri/.generated/icons/128x128.png',
      'src-tauri/.generated/icons/128x128@2x.png',
      'src-tauri/.generated/icons/32x32.png',
      'src-tauri/.generated/icons/icon.icns',
      'src-tauri/.generated/icons/icon.ico',
      'src-tauri/.generated/override.json',
    ])
  })

  test('packages only opted-in supported app/media files at stable resource paths', async () => {
    await createProject()
    await mkdir(resolve(root, 'app/media/clips'), { recursive: true })
    await writeFile(resolve(root, 'app/media/cover.jpg'), 'jpeg')
    await writeFile(resolve(root, 'app/media/clips/demo 世界.mp4'), 'mp4')

    expect(await collectBundledMediaAssets(root)).toEqual([
      {
        sourcePath: resolve(root, 'app/media/clips/demo 世界.mp4'),
        resourcePath: 'termweave-media/clips/demo 世界.mp4',
      },
      {
        sourcePath: resolve(root, 'app/media/cover.jpg'),
        resourcePath: 'termweave-media/cover.jpg',
      },
    ])

    await writeFile(resolve(root, 'app/media/readme.txt'), 'unsupported')
    await expect(collectBundledMediaAssets(root)).rejects.toThrow('Unsupported bundled media file')
  })

  test('replaces stale generated output', async () => {
    await createProject()
    const stalePath = resolve(root, 'src-tauri/.generated/icons/stale.png')
    await mkdir(resolve(stalePath, '..'), { recursive: true })
    await writeFile(stalePath, 'stale')

    await prepareProject({
      root,
      generateIcons: async ({ outputDirectory }) => createIcons(outputDirectory),
    })

    expect(Bun.file(stalePath).exists()).resolves.toBe(false)
  })

  test('fails invalid configuration before icon generation', async () => {
    await createProject(validAppConfig({ name: '   ' }))
    let generated = false

    await expect(
      prepareProject({
        root,
        generateIcons: async () => {
          generated = true
        },
      }),
    ).rejects.toThrow('name must be a non-empty string')
    expect(generated).toBe(false)
    expect(Bun.file(resolve(root, 'src-tauri/.generated/override.json')).exists()).resolves.toBe(
      false,
    )
  })

  test('reports malformed JSON concisely', async () => {
    await createProject()
    await writeFile(resolve(root, 'app.config.json'), '{')

    await expect(prepareProject({ root, generateIcons: async () => {} })).rejects.toThrow(
      'Invalid app.config.json: expected valid JSON',
    )
  })

  test('reports a missing configuration file', async () => {
    await mkdir(resolve(root, 'src-tauri'), { recursive: true })
    await expect(prepareProject({ root, generateIcons: async () => {} })).rejects.toThrow(
      'Missing app.config.json',
    )
  })

  test('reports a missing icon before generation', async () => {
    await createProject()
    await rm(resolve(root, 'app.icon.png'))
    let generated = false

    await expect(
      prepareProject({
        root,
        generateIcons: async () => {
          generated = true
        },
      }),
    ).rejects.toThrow('icon file does not exist: app.icon.png')
    expect(generated).toBe(false)
  })

  test('reports a missing platform-native OpenTUI runtime before generation', async () => {
    await createProject(validAppConfig(), false)
    let generated = false

    await expect(
      prepareProject({
        root,
        generateIcons: async () => {
          generated = true
        },
      }),
    ).rejects.toThrow('OpenTUI native runtime is missing')
    expect(generated).toBe(false)
  })

  test('rejects an icon symlink that resolves outside the project root', async () => {
    await createProject()
    const outsideIcon = resolve(root, '..', `${root.split('/').pop()}-outside.png`)
    await writeFile(outsideIcon, 'outside icon')
    await rm(resolve(root, 'app.icon.png'))
    await symlink(outsideIcon, resolve(root, 'app.icon.png'))

    try {
      await expect(prepareProject({ root, generateIcons: async () => {} })).rejects.toThrow(
        'icon must resolve inside the project root',
      )
    } finally {
      await rm(outsideIcon, { force: true })
    }
  })

  test('cleans partial output and stale overrides when icon generation fails', async () => {
    await createProject()
    const generatedDirectory = resolve(root, 'src-tauri/.generated')
    await mkdir(generatedDirectory, { recursive: true })
    await writeFile(resolve(generatedDirectory, 'override.json'), 'stale')

    await expect(
      prepareProject({
        root,
        generateIcons: async ({ outputDirectory }) => {
          await mkdir(outputDirectory, { recursive: true })
          await writeFile(resolve(outputDirectory, 'partial.png'), 'partial')
          throw new Error('generator failed')
        },
      }),
    ).rejects.toThrow('generator failed')
    await expect(stat(generatedDirectory)).rejects.toThrow()
  })

  test('rejects incomplete generated icon output', async () => {
    await createProject()
    const generatedDirectory = resolve(root, 'src-tauri/.generated')

    await expect(
      prepareProject({
        root,
        generateIcons: async ({ outputDirectory }) => {
          await mkdir(outputDirectory, { recursive: true })
          await writeFile(resolve(outputDirectory, '32x32.png'), 'one icon')
        },
      }),
    ).rejects.toThrow('Icon generation did not produce 128x128.png')
    await expect(stat(generatedDirectory)).rejects.toThrow()
  })
})
