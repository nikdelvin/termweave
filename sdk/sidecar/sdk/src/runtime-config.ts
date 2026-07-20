export interface TermweaveTerminalGrid {
  cols: number
  rows: number
}

export interface TermweaveConfig {
  foregroundColor: string
  terminalGrid: TermweaveTerminalGrid
  themeColor: string
}

let cachedConfig: TermweaveConfig | undefined

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function requiredPositiveInteger(name: string) {
  const value = Number(requiredEnvironment(name))
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function getTermweaveConfig(): Readonly<TermweaveConfig> {
  cachedConfig ??= {
    foregroundColor: requiredEnvironment('TERMWEAVE_FOREGROUND_COLOR'),
    terminalGrid: {
      cols: requiredPositiveInteger('TERMWEAVE_TERMINAL_COLS'),
      rows: requiredPositiveInteger('TERMWEAVE_TERMINAL_ROWS'),
    },
    themeColor: requiredEnvironment('TERMWEAVE_THEME_COLOR'),
  }

  return cachedConfig
}
