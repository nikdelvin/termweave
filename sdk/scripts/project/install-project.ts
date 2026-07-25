import { copyFile, cp, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { createInterface, type Interface } from 'node:readline/promises'
import { parseAppConfig } from '../app/app-config'
import { runCli, runRequired } from '../lib/process'
import {
  setManagedSdkDependency,
  TERMWEAVE_SDK_DEPENDENCY,
  TERMWEAVE_SDK_TEMPLATE_DEPENDENCY,
  type JsonObject,
} from '../packages/managed-package'
import { isSdkManagedSidecarSource } from './source-sync'

const SDK_ROOT = resolve(import.meta.dir, '../..')
const SCAFFOLD_CONFLICTS = [
  'src',
  'app.config.json',
  'app.icon.png',
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'eslint.config.js',
  'patches',
  '.prettierrc.json',
  '.prettierignore',
]

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  )
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
}

export function titleFromSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function getGitAuthor(projectRoot: string) {
  const result = Bun.spawnSync(['git', 'config', 'user.name'], {
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  return result.exitCode === 0 ? result.stdout.toString().trim() : ''
}

async function appendIgnoreRules(projectRoot: string) {
  const ignorePath = resolve(projectRoot, '.gitignore')
  const existing = await readFile(ignorePath, 'utf8').catch(() => '')
  const rules = ['/termweave/', '/node_modules/', '/build/']
  const lines = new Set(existing.split(/\r?\n/))
  const additions = rules.filter((rule) => !lines.has(rule))
  if (additions.length === 0) return

  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  const heading = existing.includes('# Termweave') ? '' : '# Termweave\n'
  await writeFile(ignorePath, `${existing}${separator}${heading}${additions.join('\n')}\n`)
}

export function setLockfileWorkspaceName(content: string, packageName: string) {
  const rootWorkspaceName = /("workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*)"(?:[^"\\]|\\.)*"/
  if (!rootWorkspaceName.test(content)) {
    throw new Error('Template bun.lock does not contain a root workspace name')
  }
  return content.replace(
    rootWorkspaceName,
    (_, prefix: string) => `${prefix}${JSON.stringify(packageName)}`,
  )
}

export function setLockfileSdkDependency(content: string) {
  if (!content.includes(TERMWEAVE_SDK_TEMPLATE_DEPENDENCY)) {
    throw new Error('Template bun.lock does not contain the managed Termweave SDK dependency')
  }
  return content.replaceAll(TERMWEAVE_SDK_TEMPLATE_DEPENDENCY, TERMWEAVE_SDK_DEPENDENCY)
}

export async function assertScaffoldAvailable(projectRoot: string) {
  const conflicts = (
    await Promise.all(
      SCAFFOLD_CONFLICTS.map(async (path) => ({
        path,
        exists: await exists(resolve(projectRoot, path)),
      })),
    )
  )
    .filter((entry) => entry.exists)
    .map((entry) => entry.path)

  if (conflicts.length > 0) {
    throw new Error(
      `Refusing to overwrite existing project scaffold files: ${conflicts.join(', ')}`,
    )
  }
}

export async function createScaffold(
  projectRoot: string,
  metadata: {
    name: string
    packageName: string
    bundleIdentifier: string
    author: string
    description: string
  },
  sdkRoot = SDK_ROOT,
) {
  await assertScaffoldAvailable(projectRoot)

  const templateRoot = resolve(sdkRoot, 'template')
  const sidecarRoot = resolve(sdkRoot, 'sidecar')
  const sidecarSource = resolve(sidecarRoot, 'src')
  await Promise.all([
    cp(sidecarSource, resolve(projectRoot, 'src'), {
      recursive: true,
      filter: (source) =>
        !isSdkManagedSidecarSource(relative(sidecarSource, source)) &&
        basename(source) !== '.DS_Store',
    }),
    cp(resolve(templateRoot, 'patches'), resolve(projectRoot, 'patches'), { recursive: true }),
    ...['tsconfig.json', 'eslint.config.js', '.prettierignore'].map((path) =>
      copyFile(resolve(templateRoot, path), resolve(projectRoot, path)),
    ),
    copyFile(resolve(sidecarRoot, '.prettierrc.json'), resolve(projectRoot, '.prettierrc.json')),
    copyFile(resolve(sdkRoot, 'app.icon.png'), resolve(projectRoot, 'app.icon.png')),
    copyFile(resolve(sdkRoot, 'install.sh'), resolve(projectRoot, 'install.sh')),
  ])

  const packageJson = JSON.parse(
    await readFile(resolve(templateRoot, 'package.json'), 'utf8'),
  ) as JsonObject
  packageJson.name = metadata.packageName
  packageJson.description = metadata.description
  setManagedSdkDependency(packageJson)

  const templateConfig = parseAppConfig(
    JSON.parse(await readFile(resolve(templateRoot, 'app.config.json'), 'utf8')) as unknown,
  )
  const appConfig = {
    ...templateConfig,
    name: metadata.name,
    description: metadata.description,
    packageName: metadata.packageName,
    bundleIdentifier: metadata.bundleIdentifier,
    authors: [metadata.author],
  }
  const templateLock = await readFile(resolve(templateRoot, 'bun.lock'), 'utf8')
  await Promise.all([
    writeFile(resolve(projectRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(
      resolve(projectRoot, 'bun.lock'),
      setLockfileSdkDependency(setLockfileWorkspaceName(templateLock, metadata.packageName)),
    ),
    writeFile(resolve(projectRoot, 'app.config.json'), `${JSON.stringify(appConfig, null, 2)}\n`),
    appendIgnoreRules(projectRoot),
  ])
}

async function ask(terminal: Interface, question: string, defaultValue: string) {
  const answer = (await terminal.question(`${question} [${defaultValue}]: `)).trim()
  return answer || defaultValue
}

async function main() {
  const projectRoot = resolve(process.argv[2] ?? process.cwd())
  const gitAuthor = getGitAuthor(projectRoot) || 'awesome-dev'
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  let packageName: string
  let name: string
  let bundleIdentifier: string
  let author: string
  let description: string

  try {
    const directorySlug = slugify(basename(projectRoot)) || 'termweave-app'
    packageName = slugify(await ask(terminal, 'Package name', directorySlug))
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(packageName)) {
      throw new Error('Package name must be lowercase kebab-case and start with a letter')
    }

    name = await ask(terminal, 'Application name', titleFromSlug(packageName))
    bundleIdentifier = await ask(terminal, 'Bundle identifier', `com.${gitAuthor}.${packageName}`)
    if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleIdentifier)) {
      throw new Error('Bundle identifier must be a reverse-domain identifier')
    }

    author = await ask(terminal, 'Author', gitAuthor)
    description = await ask(
      terminal,
      'Description',
      'A terminal desktop application built with Termweave.',
    )
  } finally {
    terminal.close()
  }

  await createScaffold(projectRoot, {
    name,
    packageName,
    bundleIdentifier,
    author,
    description,
  })
  await runRequired(
    ['bun', 'install', '--frozen-lockfile'],
    projectRoot,
    'Project dependency installation',
  )
  await runRequired(['bun', 'run', 'format'], projectRoot, 'Project scaffold formatting')
  await runRequired(
    ['bun', 'install', '--frozen-lockfile'],
    SDK_ROOT,
    'SDK dependency installation',
  )
  await runRequired(
    ['bun', 'install', '--frozen-lockfile'],
    resolve(SDK_ROOT, 'sidecar'),
    'Sidecar dependency installation',
  )
  await runRequired(
    ['bun', resolve(SDK_ROOT, 'scripts/project/manage-project.ts'), 'sync'],
    projectRoot,
    'Project synchronization',
  )
  await runRequired(['bun', 'run', 'config:sync'], SDK_ROOT, 'App configuration sync')

  process.stdout.write(
    `\nTermweave project ready in ${projectRoot}\nRun \`bun run dev\` to start the application.\n`,
  )
}

if (import.meta.main) runCli(main)
