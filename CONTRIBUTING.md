# Contributing to Termweave

Thank you for helping improve Termweave.

## Development setup

Termweave currently targets macOS for standalone installation and development. Install Bun 1.3 or
newer, a stable Rust toolchain, and the Xcode Command Line Tools.

Clone the repository and install both JavaScript workspaces:

```sh
bun install --frozen-lockfile
bun install --cwd sidecar --frozen-lockfile
cargo install cargo-audit --locked
```

Run all non-native checks with:

```sh
bun run app:check
bun run sdk:deps:audit
sh -n install.sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Use `bun run format` and `bun run --cwd sidecar format` before committing when formatting changes
are needed.

## Updating dependencies

Do not introduce version ranges in the SDK, sidecar, project template, or Cargo manifest. Preview
registry updates before applying them:

```sh
bun run sdk:deps:update --dry-run
bun run sdk:deps:update
```

Compatible updates stay within the current major version, or the current minor version for pre-1.0
packages. Add `--latest` to the preview only when intentionally evaluating breaking releases.

The updater assigns exact versions to direct Bun packages, Bun security overrides, and Rust crates;
aligns shared Bun packages; regenerates every Bun lockfile and the Cargo lockfile; and runs the
static checks. Review upstream changelogs and the resulting lockfile diff, then perform the native
lifecycle checks described below before committing.

## Making changes

- Keep user-owned project code under the standalone project root and SDK-owned runtime code in this
  repository.
- Preserve the named `App` export expected by `sidecar/src/index.tsx`.
- Keep configuration-derived files managed by `scripts/sync-app-config.ts`.
- Avoid adding platform-specific behavior without documenting and guarding it.
- Update the README when a public command, configuration field, prerequisite, or project layout
  changes.

For native or sidecar lifecycle changes, manually verify development startup, sidecar restart and
reconnect, production bundling, and application shutdown before opening a pull request.

## Pull requests

Keep pull requests focused, describe the user-visible behavior, and include the manual verification
you performed. Do not include generated build output, dependency directories, or synchronized
standalone-project files.
