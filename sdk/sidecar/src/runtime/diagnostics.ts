export type SidecarLog = (message: string, details?: unknown) => void

type DiagnosticSender = (line: string) => boolean

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return String(error)
}

export function createSidecarDiagnostics(enabled: boolean, startedAt = performance.now()) {
  let sender: DiagnosticSender | undefined

  const log: SidecarLog = (message, details) => {
    if (!enabled) return

    const elapsed = (performance.now() - startedAt).toFixed(1).padStart(8)
    let suffix = ''
    if (details !== undefined) {
      try {
        suffix = ` ${JSON.stringify(details)}`
      } catch {
        suffix = ` ${String(details)}`
      }
    }

    const line = `[${elapsed}ms] [sidecar] ${message}${suffix}`
    if (sender?.(line)) return
    process.stderr.write(`${line}\n`)
  }

  return {
    log,
    setSender(nextSender: DiagnosticSender | undefined) {
      sender = nextSender
    },
  }
}
