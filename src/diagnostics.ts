import { SHOW_DIAGNOSTICS } from '../shared/terminal-config'

export type DiagnosticLevel = 'info' | 'warn' | 'error'

const startedAt = performance.now()
const maxLines = 1000
const lines: string[] = []
const reportedCspViolations = new Set<string>()
const diagnosticsElement = document.querySelector<HTMLElement>('#diagnostics')
const diagnosticsEnabled = import.meta.env.DEV || SHOW_DIAGNOSTICS

if (SHOW_DIAGNOSTICS) {
  diagnosticsElement?.removeAttribute('hidden')
} else {
  diagnosticsElement?.remove()
}

const logElement = SHOW_DIAGNOSTICS
  ? document.querySelector<HTMLPreElement>('#diagnostic-log')
  : null
const statusElement = SHOW_DIAGNOSTICS
  ? document.querySelector<HTMLElement>('#diagnostic-status')
  : null
const nativeConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

function serialize(value: unknown): string {
  if (value instanceof Error) {
    return (
      JSON.stringify({
        name: value.name,
        message: value.message,
        stack: value.stack,
      }) ?? String(value)
    )
  }

  if (typeof value === 'string') return value

  try {
    return (
      JSON.stringify(value, (_key, nestedValue: unknown) => {
        if (nestedValue instanceof Error) {
          return {
            name: nestedValue.name,
            message: nestedValue.message,
            stack: nestedValue.stack,
          }
        }
        return nestedValue
      }) ?? String(value)
    )
  } catch {
    return String(value)
  }
}

function append(line: string) {
  lines.push(line)
  if (lines.length > maxLines) lines.splice(0, lines.length - maxLines)

  if (logElement) {
    logElement.textContent = lines.join('\n')
    logElement.scrollTop = logElement.scrollHeight
  }

  if (statusElement) statusElement.textContent = line
}

function writeToConsole(level: DiagnosticLevel, line: string) {
  if (level === 'error') {
    nativeConsole.error(line)
  } else if (level === 'warn') {
    nativeConsole.warn(line)
  } else {
    nativeConsole.log(line)
  }
}

export function diagnostic(
  scope: string,
  message: string,
  details?: unknown,
  level: DiagnosticLevel = 'info',
) {
  if (!diagnosticsEnabled) return

  const elapsed = (performance.now() - startedAt).toFixed(1).padStart(8)
  const suffix = details === undefined ? '' : ` ${serialize(details)}`
  const line = `[${elapsed}ms] [${level.toUpperCase()}] [${scope}] ${message}${suffix}`

  append(line)
  writeToConsole(level, line)
}

function captureConsole(
  level: DiagnosticLevel,
  nativeMethod: (...values: unknown[]) => void,
  values: unknown[],
) {
  const elapsed = (performance.now() - startedAt).toFixed(1).padStart(8)
  const renderedValues = values.map(serialize).join(' ')
  append(`[${elapsed}ms] [${level.toUpperCase()}] [console] ${renderedValues}`)
  nativeMethod(...values)
}

if (diagnosticsEnabled) {
  console.log = (...values: unknown[]) => {
    captureConsole('info', nativeConsole.log, values)
  }
  console.warn = (...values: unknown[]) => {
    captureConsole('warn', nativeConsole.warn, values)
  }
  console.error = (...values: unknown[]) => {
    captureConsole('error', nativeConsole.error, values)
  }

  window.addEventListener('error', (event) => {
    diagnostic(
      'window',
      'uncaught error',
      {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        error: event.error,
      },
      'error',
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    diagnostic('window', 'unhandled promise rejection', event.reason, 'error')
  })

  document.addEventListener('securitypolicyviolation', (event) => {
    const signature = [
      event.effectiveDirective,
      event.blockedURI,
      event.sourceFile,
      event.lineNumber,
    ].join(':')
    if (reportedCspViolations.has(signature)) return
    reportedCspViolations.add(signature)

    diagnostic(
      'csp',
      'security policy violation',
      {
        directive: event.effectiveDirective,
        blockedUri: event.blockedURI,
        source: event.sourceFile,
        line: event.lineNumber,
      },
      'error',
    )
  })

  window.addEventListener('online', () => diagnostic('window', 'online'))
  window.addEventListener('offline', () => diagnostic('window', 'offline', undefined, 'warn'))

  document.querySelector<HTMLButtonElement>('#diagnostic-copy')?.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => diagnostic('diagnostics', 'log copied to clipboard'))
      .catch((error: unknown) => diagnostic('diagnostics', 'copy failed', error, 'error'))
  })

  document.querySelector<HTMLButtonElement>('#diagnostic-clear')?.addEventListener('click', () => {
    lines.splice(0)
    if (logElement) logElement.textContent = ''
    diagnostic('diagnostics', 'log cleared')
  })

  diagnostic('webview', 'diagnostics initialized', {
    href: window.location.href,
    readyState: document.readyState,
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
    devicePixelRatio: window.devicePixelRatio,
    visibility: document.visibilityState,
  })
}
