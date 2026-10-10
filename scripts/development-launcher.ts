import { resolve } from 'node:path'
import process from 'node:process'
import { errorMessage } from '../termweave/error-message'

declare const __TERMWEAVE_BUN_EXECUTABLE__: string
declare const __TERMWEAVE_PROJECT_ROOT__: string

export type DevelopmentSignal = 'SIGINT' | 'SIGTERM'

export interface DevelopmentChild {
  readonly exited: Promise<number>
  kill(signal: NodeJS.Signals): void
}

export type SpawnDevelopmentChild = (
  command: string[],
  options: Readonly<{
    cwd: string
    env: Record<string, string | undefined>
    stdin: 'inherit'
    stdout: 'inherit'
    stderr: 'inherit'
  }>,
) => DevelopmentChild

interface DevelopmentLauncherOptions {
  root: string
  bunExecutable: string
  environment?: NodeJS.ProcessEnv
  spawn?: SpawnDevelopmentChild
  onSignal?: (signal: DevelopmentSignal, listener: () => void) => void
  offSignal?: (signal: DevelopmentSignal, listener: () => void) => void
  writeStderr?: (message: string) => void
}

const defaultSpawn: SpawnDevelopmentChild = (command, options) => Bun.spawn(command, options)

export async function runDevelopmentLauncher({
  root,
  bunExecutable,
  environment = process.env,
  spawn = defaultSpawn,
  onSignal = (signal, listener) => process.once(signal, listener),
  offSignal = (signal, listener) => process.off(signal, listener),
  writeStderr = (message) => process.stderr.write(message),
}: DevelopmentLauncherOptions) {
  const childEnvironment: Record<string, string | undefined> = { ...environment }
  delete childEnvironment.DEBUG

  let child: DevelopmentChild
  try {
    child = spawn([bunExecutable, '--watch', '--no-clear-screen', resolve(root, 'app/index.tsx')], {
      cwd: root,
      env: childEnvironment,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
  } catch (error) {
    writeStderr(`[termweave] Could not start OpenTUI: ${errorMessage(error)}\n`)
    return 1
  }

  const parentWatch = setInterval(() => {
    if (process.ppid === 1) {
      try {
        child.kill('SIGTERM')
      } catch {}
    }
  }, 1_000)

  let forwarded = false
  const handlers = new Map<DevelopmentSignal, () => void>()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = () => {
      if (forwarded) return
      forwarded = true
      try {
        child.kill(signal)
      } catch {}
    }
    handlers.set(signal, handler)
    onSignal(signal, handler)
  }

  try {
    return await child.exited
  } finally {
    clearInterval(parentWatch)
    for (const [signal, handler] of handlers) offSignal(signal, handler)
  }
}

if (import.meta.main) {
  process.exit(
    await runDevelopmentLauncher({
      root: __TERMWEAVE_PROJECT_ROOT__,
      bunExecutable: __TERMWEAVE_BUN_EXECUTABLE__,
    }),
  )
}
