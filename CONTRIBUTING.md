# 🤝 Contributing to Termweave

Thanks for helping make Termweave better. Bug fixes, documentation, examples, and focused feature
improvements are all welcome.

## 🚀 Set up

Development currently requires macOS, [Bun 1.3+](https://bun.sh/), a stable
[Rust toolchain](https://www.rust-lang.org/tools/install), and the Xcode Command Line Tools.

Clone the repository and install both workspaces:

```sh
git clone https://github.com/nikdelvin/termweave.git
cd termweave/sdk
bun install --frozen-lockfile
bun install --cwd sidecar --frozen-lockfile
```

Run the development app:

```sh
bun run app:dev
```

## 🗺️ Find your way around

| Path                 | What lives there                                 |
| -------------------- | ------------------------------------------------ |
| `src/`               | xterm.js renderer and webview code.              |
| `sidecar/`           | OpenTUI + Solid application and sidecar tooling. |
| `src-tauri/`         | Native Tauri application.                        |
| `scripts/`           | Configuration, build, install, and update tools. |
| `templates/project/` | Files generated for a new Termweave application. |

## ✅ Check your work

Run the standard checks before opening a pull request:

```sh
bun run app:check
bun run build
sh -n install.sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo metadata --manifest-path src-tauri/Cargo.toml --no-deps --locked --format-version 1
```

Use `bun run app:format` to format the SDK and sidecar.

For native or sidecar lifecycle changes, also verify:

- The development app starts and shuts down cleanly.
- Source changes restart the sidecar and reconnect.
- `bun run app:build` creates a production bundle.
- The packaged application launches and exits normally.

## 🧩 Keep changes focused

- Preserve the named `App` export used by `sidecar/src/index.tsx`.
- Change product metadata in `app.config.json`; generated Tauri, Cargo, HTML, and CSS values are
  synchronized by `scripts/sync-app-config.ts`.
- Keep direct Bun and Cargo dependency versions exact.
- Guard and document platform-specific behavior.
- Update the README when public commands, requirements, configuration, or layout change.
- Do not commit generated output, dependency directories, or synchronized standalone-project
  files.

## 📦 Update dependencies

Preview compatible dependency updates before applying them:

```sh
bun run sdk:deps:update --dry-run
bun run sdk:deps:update
```

Use `--latest` only when intentionally reviewing breaking releases. Audit the resulting lockfiles
with:

```sh
cargo install cargo-audit --locked
bun run sdk:deps:audit
```

Review upstream changelogs and test the native lifecycle before committing dependency updates.

## 📬 Open a pull request

Keep each pull request small and explain:

- What changed and why.
- What users will notice.
- Which automated and manual checks you ran.
- Any follow-up work or known limitations.

Add screenshots or a short recording for visible interface changes. Link related issues when
available.
