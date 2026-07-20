type JsonObject = Record<string, unknown>

export const TERMWEAVE_SDK_PACKAGE = '@termweave/sdk'
export const TERMWEAVE_SDK_DEPENDENCY = 'file:termweave/sdk/sidecar/sdk'
export const TERMWEAVE_SDK_SIDECAR_DEPENDENCY = 'file:./sdk'
export const TERMWEAVE_SDK_TEMPLATE_DEPENDENCY = 'file:../../sidecar/sdk'

export function setManagedSdkDependency(packageJson: JsonObject) {
  const dependencies =
    typeof packageJson.dependencies === 'object' &&
    packageJson.dependencies !== null &&
    !Array.isArray(packageJson.dependencies)
      ? (packageJson.dependencies as JsonObject)
      : {}

  packageJson.dependencies = {
    ...dependencies,
    [TERMWEAVE_SDK_PACKAGE]: TERMWEAVE_SDK_DEPENDENCY,
  }

  return packageJson
}
