export async function runRequired(command: string[], cwd: string, description: string) {
  const child = Bun.spawn(command, {
    cwd,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${description} failed with exit code ${exitCode}.`)
}

export async function getRustHostTuple() {
  const child = Bun.spawn(['rustc', '--print', 'host-tuple'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const triple = stdout.trim()
  if (exitCode !== 0 || triple === '') {
    throw new Error(
      `Could not determine the Rust host tuple: ${stderr.trim() || `exit ${exitCode}`}`,
    )
  }
  return triple
}
