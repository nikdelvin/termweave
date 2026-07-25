export type JsonObject = Record<string, unknown>

export const TERMWEAVE_SDK_PACKAGE = '@termweave/sdk'
export const TERMWEAVE_SDK_DEPENDENCY = 'file:termweave/sdk/sidecar/sdk'
export const TERMWEAVE_SDK_SIDECAR_DEPENDENCY = 'file:./sdk'
export const TERMWEAVE_SDK_TEMPLATE_DEPENDENCY = 'file:../sidecar/sdk'

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

export function mergeManagedPackage(projectPackage: JsonObject, templatePackage: JsonObject) {
  const merged = structuredClone(projectPackage)

  for (const section of [
    'scripts',
    'dependencies',
    'devDependencies',
    'overrides',
    'patchedDependencies',
  ] as const) {
    const current =
      typeof merged[section] === 'object' && merged[section] !== null
        ? (merged[section] as JsonObject)
        : {}
    const managed =
      typeof templatePackage[section] === 'object' && templatePackage[section] !== null
        ? (templatePackage[section] as JsonObject)
        : {}

    merged[section] = { ...current, ...managed }
  }

  return setManagedSdkDependency(merged)
}
