export interface SidecarRuntimeConfig {
  clientToken: string
  instanceId: string
  port: number
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function readSidecarRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SidecarRuntimeConfig {
  const instanceId = requiredEnvironment(environment, 'TUI_SIDECAR_INSTANCE_ID')
  const clientToken = requiredEnvironment(environment, 'TUI_SIDECAR_TOKEN')
  const port = Number(environment.TUI_SIDECAR_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('TUI_SIDECAR_PORT must be a valid TCP port')
  }

  return {
    clientToken,
    instanceId,
    port,
  }
}
