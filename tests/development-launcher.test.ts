import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  runDevelopmentLauncher,
  type DevelopmentChild,
  type DevelopmentSignal,
  type SpawnDevelopmentChild,
} from '../scripts/development-launcher'
import { Deferred } from './support/deferred'

class FakeChild implements DevelopmentChild {
  readonly exit = new Deferred<number>()
  readonly exited = this.exit.promise
  readonly signals: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals) {
    this.signals.push(signal)
  }
}

class FakeSignals {
  readonly removed: DevelopmentSignal[] = []
  private readonly listeners = new Map<DevelopmentSignal, Set<() => void>>()

  on = (signal: DevelopmentSignal, listener: () => void) => {
    const listeners = this.listeners.get(signal) ?? new Set()
    listeners.add(listener)
    this.listeners.set(signal, listeners)
  }

  off = (signal: DevelopmentSignal, listener: () => void) => {
    this.removed.push(signal)
    this.listeners.get(signal)?.delete(listener)
  }

  emit(signal: DevelopmentSignal) {
    for (const listener of [...(this.listeners.get(signal) ?? [])]) listener()
  }
}

type SpawnCall = {
  command: string[]
  options: Parameters<SpawnDevelopmentChild>[1]
}

function startFakeLauncher(child = new FakeChild()) {
  const calls: SpawnCall[] = []
  const signals = new FakeSignals()
  const completed = runDevelopmentLauncher({
    root: '/project',
    bunExecutable: '/bin/bun',
    ffmpegPath: '/project/ffmpeg',
    environment: { DEBUG: 'opentui:*', STABLE_ENV: 'kept' },
    spawn: (command, options) => {
      calls.push({ command, options })
      return child
    },
    onSignal: signals.on,
    offSignal: signals.off,
  })
  return { calls, child, completed, signals }
}

async function collectText(stream: ReadableStream<Uint8Array>, append: (text: string) => void) {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      append(decoder.decode(result.value, { stream: true }))
    }
    append(decoder.decode())
  } finally {
    reader.releaseLock()
  }
}

async function waitForText(read: () => string, pattern: RegExp, timeoutMs = 5_000) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (pattern.test(read())) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for ${pattern}; output was:\n${read()}`)
}

describe('development sidecar launcher', () => {
  test('spawns one Bun watcher with inherited pipes and stable media environment', async () => {
    const harness = startFakeLauncher()

    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.command).toEqual([
      '/bin/bun',
      '--watch',
      '--no-clear-screen',
      '--preload',
      '@opentui/solid/preload',
      resolve('/project', 'app/index.tsx'),
    ])
    expect(harness.calls[0]?.options).toMatchObject({
      cwd: '/project',
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    expect(harness.calls[0]?.options.env).toMatchObject({
      STABLE_ENV: 'kept',
      TERMWEAVE_FFMPEG_PATH: '/project/ffmpeg',
      TERMWEAVE_MEDIA_ROOT: '/project/app/media',
    })
    expect(harness.calls[0]?.options.env).not.toHaveProperty('DEBUG')

    harness.child.exit.resolve(17)
    await expect(harness.completed).resolves.toBe(17)
    expect(harness.signals.removed.sort()).toEqual(['SIGINT', 'SIGTERM'])
  })

  test('forwards the first termination signal exactly once', async () => {
    const harness = startFakeLauncher()
    harness.signals.emit('SIGINT')
    harness.signals.emit('SIGTERM')
    harness.signals.emit('SIGINT')
    expect(harness.child.signals).toEqual(['SIGINT'])

    harness.child.exit.resolve(130)
    await expect(harness.completed).resolves.toBe(130)
    harness.signals.emit('SIGTERM')
    expect(harness.child.signals).toEqual(['SIGINT'])
  })

  test('reports synchronous spawn failures as a non-zero exit', async () => {
    const diagnostics: string[] = []
    await expect(
      runDevelopmentLauncher({
        root: '/project',
        bunExecutable: '/bin/bun',
        ffmpegPath: '/project/ffmpeg',
        spawn: () => {
          throw new Error('spawn failed')
        },
        writeStderr: (message) => diagnostics.push(message),
      }),
    ).resolves.toBe(1)
    expect(diagnostics.join('')).toContain('Could not start OpenTUI: spawn failed')
  })
})

describe('real Bun watch mode', () => {
  test('hard-restarts, recovers from syntax errors, and preserves stdin and environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termweave-watch-test-'))
    const entry = join(directory, 'entry.ts')
    const dependency = join(directory, 'value.ts')
    let stdout = ''
    let stderr = ''
    let child: ReturnType<typeof Bun.spawn> | undefined

    try {
      await Bun.write(
        entry,
        [
          "import { value } from './value'",
          'console.log(`READY:${value}:${process.env.STABLE_ENV}`)',
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (chunk) => console.log(`INPUT:${value}:${chunk.trim()}`))",
        ].join('\n'),
      )
      await Bun.write(dependency, "export const value = 'one'\n")
      const watchedChild = Bun.spawn([process.execPath, '--watch', '--no-clear-screen', entry], {
        cwd: directory,
        env: { ...process.env, STABLE_ENV: 'kept' },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      child = watchedChild
      const stdoutDone = collectText(watchedChild.stdout, (text) => {
        stdout += text
      })
      const stderrDone = collectText(watchedChild.stderr, (text) => {
        stderr += text
      })

      await waitForText(() => stdout, /READY:one:kept/)
      watchedChild.stdin.write('before\n')
      await watchedChild.stdin.flush()
      await waitForText(() => stdout, /INPUT:one:before/)

      await Bun.write(dependency, "export const value = 'two'\n")
      await waitForText(() => stdout, /READY:two:kept/)
      watchedChild.stdin.write('after\n')
      await watchedChild.stdin.flush()
      await waitForText(() => stdout, /INPUT:two:after/)

      await Bun.write(dependency, 'export const value =\n')
      await waitForText(() => stderr, /error|SyntaxError/i)
      await Bun.write(dependency, "export const value = 'recovered'\n")
      await waitForText(() => stdout, /READY:recovered:kept/)

      watchedChild.kill('SIGTERM')
      await watchedChild.exited
      await Promise.all([stdoutDone, stderrDone])
    } finally {
      try {
        child?.kill('SIGTERM')
      } catch {
        // The watcher normally exits before cleanup.
      }
      await rm(directory, { force: true, recursive: true })
    }
  }, 15_000)
})
