import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type ActiveProcess = {
  command: 'dev' | 'build'
  pid: number
  projectRoot: string
}

const ACTIVE_PROCESS_FILE = '.termweave-active.json'

export async function readActiveProcess(sdkRoot: string): Promise<ActiveProcess | undefined> {
  try {
    const value = JSON.parse(
      await readFile(resolve(sdkRoot, ACTIVE_PROCESS_FILE), 'utf8'),
    ) as Partial<ActiveProcess>
    if (
      (value.command === 'dev' || value.command === 'build') &&
      typeof value.pid === 'number' &&
      typeof value.projectRoot === 'string'
    ) {
      return value as ActiveProcess
    }
  } catch {
    return undefined
  }
  return undefined
}

export function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function assertNoActiveProcess(sdkRoot: string, action: string) {
  const active = await readActiveProcess(sdkRoot)
  if (active && active.pid !== process.pid && processIsRunning(active.pid)) {
    throw new Error(
      `${action}: Termweave ${active.command} is running for ${active.projectRoot} (PID ${active.pid})`,
    )
  }
}

export async function withActiveProcess<T>(
  sdkRoot: string,
  command: ActiveProcess['command'],
  projectRoot: string,
  task: () => Promise<T>,
) {
  await assertNoActiveProcess(sdkRoot, 'Cannot start another command')
  const lockPath = resolve(sdkRoot, ACTIVE_PROCESS_FILE)
  await writeFile(
    lockPath,
    `${JSON.stringify({ command, pid: process.pid, projectRoot } satisfies ActiveProcess, null, 2)}\n`,
  )

  try {
    return await task()
  } finally {
    await rm(lockPath, { force: true })
  }
}
