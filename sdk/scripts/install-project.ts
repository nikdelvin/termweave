import { copyFile, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createInterface, type Interface } from 'node:readline/promises'
import { basename, resolve } from 'node:path'

type JsonObject = Record<string, unknown>

const SDK_ROOT = resolve(import.meta.dir, '..')

const SCAFFOLD_CONFLICTS = [
  'src',
  'app.config.json',
  'app.icon.svg',
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'eslint.config.js',
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

function titleFromSlug(slug: string) {
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
  const path = resolve(projectRoot, '.gitignore')
  const existing = await readFile(path, 'utf8').catch(() => '')
  const rules = ['/termweave/', '/node_modules/', '/build/']
  const lines = new Set(existing.split(/\r?\n/))
  const additions = rules.filter((rule) => !lines.has(rule))
  if (additions.length === 0) return

  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  const heading = existing.includes('# Termweave') ? '' : '# Termweave\n'
  await writeFile(path, `${existing}${separator}${heading}${additions.join('\n')}\n`)
}

function setLockfileWorkspaceName(content: string, packageName: string) {
  const rootWorkspaceName = /("workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*)"(?:[^"\\]|\\.)*"/
  if (!rootWorkspaceName.test(content)) {
    throw new Error('Template bun.lock does not contain a root workspace name')
  }

  return content.replace(
    rootWorkspaceName,
    (_, prefix: string) => `${prefix}${JSON.stringify(packageName)}`,
  )
}

export async function assertScaffoldAvailable(projectRoot: string) {
  const conflicts: string[] = []
  for (const path of SCAFFOLD_CONFLICTS) {
    if (await exists(resolve(projectRoot, path))) conflicts.push(path)
  }

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

  const templateRoot = resolve(sdkRoot, 'templates/project')
  await mkdir(resolve(projectRoot, 'src'), { recursive: true })
  await cp(resolve(templateRoot, 'src'), resolve(projectRoot, 'src'), { recursive: true })

  for (const path of [
    'app.icon.svg',
    'tsconfig.json',
    'eslint.config.js',
    '.prettierrc.json',
    '.prettierignore',
  ]) {
    await copyFile(resolve(templateRoot, path), resolve(projectRoot, path))
  }

  const packageJson = JSON.parse(
    await readFile(resolve(templateRoot, 'package.json'), 'utf8'),
  ) as JsonObject
  packageJson.name = metadata.packageName
  packageJson.description = metadata.description
  await writeFile(resolve(projectRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  const templateLock = await readFile(resolve(templateRoot, 'bun.lock'), 'utf8')
  await writeFile(
    resolve(projectRoot, 'bun.lock'),
    setLockfileWorkspaceName(templateLock, metadata.packageName),
  )

  const appConfig = {
    name: metadata.name,
    description: metadata.description,
    packageName: metadata.packageName,
    bundleIdentifier: metadata.bundleIdentifier,
    version: '0.1.0',
    authors: [metadata.author],
    windowWidth: 1920,
    windowHeight: 1080,
    fontSize: 15,
    showDiagnostics: false,
    themeColor: '#0B1020',
    foregroundColor: '#E6EDF7',
    icon: 'app.icon.svg',
  }
  await writeFile(
    resolve(projectRoot, 'app.config.json'),
    `${JSON.stringify(appConfig, null, 2)}\n`,
  )

  await copyFile(resolve(sdkRoot, 'install.sh'), resolve(projectRoot, 'install.sh'))
  await appendIgnoreRules(projectRoot)
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

async function ask(terminal: Interface, question: string, defaultValue: string) {
  const answer = (await terminal.question(`${question} [${defaultValue}]: `)).trim()
  return answer || defaultValue
}

async function main() {
  const projectRoot = resolve(process.argv[2] ?? process.cwd())
  await assertScaffoldAvailable(projectRoot)

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
    bundleIdentifier = await ask(terminal, 'Bundle identifier', `com.example.${packageName}`)
    if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleIdentifier)) {
      throw new Error('Bundle identifier must be a reverse-domain identifier')
    }

    author = await ask(terminal, 'Author', getGitAuthor(projectRoot) || 'Your Name')
    description = await ask(
      terminal,
      'Description',
      `A terminal desktop application built with Termweave.`,
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
    ['bun', resolve(SDK_ROOT, 'scripts/project.ts'), 'sync'],
    projectRoot,
    'Project synchronization',
  )
  await runRequired(['bun', 'run', 'config:sync'], SDK_ROOT, 'App configuration sync')

  process.stdout.write(
    `\nTermweave project ready in ${projectRoot}\nRun \`bun run dev\` to start the application.\n`,
  )
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
