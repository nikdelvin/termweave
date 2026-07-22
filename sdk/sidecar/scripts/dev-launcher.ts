import { watch } from 'node:fs'
import { resolve } from 'node:path'

declare const __TERMWEAVE_SIDECAR_ROOT__: string

const sidecarRoot = __TERMWEAVE_SIDECAR_ROOT__
const sdkRoot = resolve(sidecarRoot, '..')
const restartSignal = '.termweave-sidecar-restart'
const restartDelayMs = 50
const ownerProcessId = process.ppid

let stopping = false
let restarting = false
let restartQueued = false
let restartTimer: ReturnType<typeof setTimeout> | undefined
let sidecarProcess: ReturnType<typeof Bun.spawn> | undefined

function startSidecar() {
  const subprocess = Bun.spawn(['bun', 'run', 'src/index.tsx'], {
    cwd: sidecarRoot,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  sidecarProcess = subprocess

  void subprocess.exited.then((exitCode) => {
    if (sidecarProcess !== subprocess) return
    sidecarProcess = undefined

    if (!stopping && !restarting) {
      process.stderr.write(
        `OpenTUI sidecar exited with code ${exitCode}; waiting for a project source change.\n`,
      )
    }
  })
}

async function stopSidecar(signal: NodeJS.Signals) {
  const subprocess = sidecarProcess
  sidecarProcess = undefined
  if (!subprocess) return

  subprocess.kill(signal)
  await subprocess.exited
}

async function restartSidecar() {
  if (stopping) return
  restartQueued = true
  if (restarting) return

  restarting = true
  try {
    while (restartQueued && !stopping) {
      restartQueued = false
      await stopSidecar('SIGTERM')
      if (!stopping) startSidecar()
    }
  } finally {
    restarting = false
  }
}

const signalWatcher = watch(sdkRoot, (_event, filename) => {
  if (!filename || String(filename) !== restartSignal) return
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => void restartSidecar(), restartDelayMs)
})
const ownerProcessWatchdog = setInterval(() => {
  if (process.ppid === ownerProcessId) return
  void stop('SIGTERM')
}, 500)
ownerProcessWatchdog.unref()

signalWatcher.on('error', (error) => {
  process.stderr.write(`Sidecar restart watcher failed: ${String(error)}\n`)
})

startSidecar()

let finishShutdown: ((exitCode: number) => void) | undefined
const shutdownCompleted = new Promise<number>((resolveShutdown) => {
  finishShutdown = resolveShutdown
})

async function stop(signal: NodeJS.Signals) {
  if (stopping) return
  stopping = true
  if (restartTimer) clearTimeout(restartTimer)
  clearInterval(ownerProcessWatchdog)
  signalWatcher.close()
  await stopSidecar(signal)
  finishShutdown?.(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void stop(signal))
}

const exitCode = await shutdownCompleted
process.exit(exitCode)
