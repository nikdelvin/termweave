export async function getHostTuple() {
  const subprocess = Bun.spawn(['rustc', '--print', 'host-tuple'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(
      `Could not determine the Rust host tuple: ${stderr.trim() || `exit ${exitCode}`}`,
    )
  }
  return stdout.trim()
}
