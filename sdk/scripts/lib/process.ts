export type RunCommandOptions = {
  env?: NodeJS.ProcessEnv
  stderr?: 'ignore' | 'inherit'
  stdin?: 'ignore' | 'inherit'
  stdout?: 'ignore' | 'inherit'
}

export async function runCommand(
  command: string[],
  cwd: string,
  {
    env = process.env,
    stdin = 'inherit',
    stdout = 'inherit',
    stderr = 'inherit',
  }: RunCommandOptions = {},
) {
  return Bun.spawn(command, { cwd, env, stdin, stdout, stderr }).exited
}

export async function runRequired(
  command: string[],
  cwd: string,
  description: string,
  options?: RunCommandOptions,
) {
  const exitCode = await runCommand(command, cwd, options)
  if (exitCode !== 0) throw new Error(`${description} failed with exit code ${exitCode}`)
}

export function runCli(main: () => Promise<unknown>) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
