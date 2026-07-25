import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCli } from '../lib/process'

export type ProcessSnapshot = {
  command: string
  pid: number
  ppid: number
  uid: number
}

export function parseProcessSnapshot(output: string) {
  return output
    .split('\n')
    .map((line): ProcessSnapshot | undefined => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
      if (!match) return undefined

      const [, pid, ppid, uid, command] = match
      if (!pid || !ppid || !uid || !command) return undefined
      return {
        command,
        pid: Number(pid),
        ppid: Number(ppid),
        uid: Number(uid),
      }
    })
    .filter((candidate): candidate is ProcessSnapshot => candidate !== undefined)
}

export function getProtectedProcessIds(
  processes: ProcessSnapshot[],
  currentPid: number,
  parentPid: number,
) {
  const processesByPid = new Map(processes.map((candidate) => [candidate.pid, candidate]))
  const protectedPids = new Set<number>([currentPid])
  let ancestorPid = parentPid

  while (ancestorPid > 1 && !protectedPids.has(ancestorPid)) {
    protectedPids.add(ancestorPid)
    ancestorPid = processesByPid.get(ancestorPid)?.ppid ?? 0
  }

  return protectedPids
}

export function selectBunProcessTargets(
  processes: ProcessSnapshot[],
  currentPid: number,
  parentPid: number,
) {
  const protectedPids = getProtectedProcessIds(processes, currentPid, parentPid)
  return processes.filter(({ command, pid }) => {
    const executable = basename(command).toLowerCase()
    return (executable === 'bun' || executable === 'bun.exe') && !protectedPids.has(pid)
  })
}

async function getProcessSnapshot() {
  const subprocess = Bun.spawn(['ps', '-axo', 'pid=,ppid=,uid=,comm='], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`Unable to inspect running processes: ${stderr.trim() || `exit ${exitCode}`}`)
  }

  return parseProcessSnapshot(stdout)
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const elevatedRun = process.argv.includes('--app-kill-elevated')
  const currentUid = process.getuid?.()

  if (currentUid === undefined) {
    throw new Error('app:kill currently requires a Unix-like operating system')
  }
  if (elevatedRun && currentUid !== 0) {
    throw new Error('app:kill requested elevation, but it is not running as root')
  }
  if (!dryRun && currentUid !== 0) {
    process.stdout.write(
      'Administrator access is required to terminate Bun processes for all users.\n',
    )
    const elevatedProcess = Bun.spawn(
      ['sudo', '--', process.execPath, fileURLToPath(import.meta.url), '--app-kill-elevated'],
      { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
    )
    process.exitCode = await elevatedProcess.exited
    return
  }

  const processes = await getProcessSnapshot()
  const targets = selectBunProcessTargets(processes, process.pid, process.ppid)
  if (targets.length === 0) {
    process.stdout.write('No active Bun processes were found across any user.\n')
    return
  }

  process.stdout.write(
    `${dryRun ? 'Would terminate' : 'Terminating'} ${targets.length} Bun process${targets.length === 1 ? '' : 'es'} across all users:\n`,
  )
  for (const target of targets) {
    process.stdout.write(
      `  PID ${target.pid} (parent ${target.ppid}, UID ${target.uid}) ${target.command}\n`,
    )
  }
  if (dryRun) return

  const failures: Array<{ error: unknown; pid: number }> = []
  for (const target of targets) {
    try {
      process.kill(target.pid, 'SIGTERM')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        failures.push({ error, pid: target.pid })
      }
    }
  }

  await Bun.sleep(750)
  const survivors = targets.filter((target) => isRunning(target.pid))
  for (const survivor of survivors) {
    try {
      process.kill(survivor.pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        failures.push({ error, pid: survivor.pid })
      }
    }
  }

  await Bun.sleep(100)
  const remaining = targets.filter((target) => isRunning(target.pid))
  for (const failure of failures) {
    process.stderr.write(`Failed to terminate PID ${failure.pid}: ${String(failure.error)}\n`)
  }
  if (remaining.length > 0) {
    process.stderr.write(
      `Bun processes still running: ${remaining.map(({ pid }) => pid).join(', ')}\n`,
    )
  }

  if (failures.length > 0 || remaining.length > 0) {
    process.exitCode = 1
  } else {
    process.stdout.write(
      `Terminated ${targets.length} Bun process${targets.length === 1 ? '' : 'es'}.\n`,
    )
  }
}

if (import.meta.main) runCli(main)
