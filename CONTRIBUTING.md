# 🤝 Contributing to Termweave

Thanks for helping make Termweave better. Bug fixes, documentation, examples, and focused feature
improvements are all welcome.

## 🚀 Set up

Development currently requires macOS, [Bun 1.3+](https://bun.sh/), a stable
[Rust toolchain](https://www.rust-lang.org/tools/install), and the Xcode Command Line Tools.

Clone the repository and install the workspaces:

```sh
git clone https://github.com/nikdelvin/termweave.git
cd termweave/sdk
bun run deps:install
```

Run the development app:

```sh
bun run app:dev
```

## 🗺️ Find your way around

| Path         | What lives there                                      |
| ------------ | ----------------------------------------------------- |
| `src/`       | Webview entry point and UI runtime.                   |
| `sidecar/`   | OpenTUI app, public SDK package, and sidecar tooling. |
| `src-tauri/` | Native Tauri application.                             |
| `scripts/`   | App, package, and project tooling.                    |
| `shared/`    | Shared terminal configuration and protocol.           |
| `template/`  | Standalone project package and configuration.         |

## ✅ Check your work

Run the standard checks before opening a pull request:

```sh
bun run app:format
bun run app:check
bun run deps:audit
bun run app:build
sh -n install.sh
```

Use `bun run app:format` to format the SDK and sidecar.
Tests live under `tests/` in both workspaces and run as part of `app:check`.

For native or sidecar lifecycle changes, also verify:

- The development app starts and shuts down cleanly.
- Source changes restart the sidecar and reconnect.
- `bun run app:build` creates a production bundle.
- The packaged application launches and exits normally.

## 🧩 Keep changes focused

- Preserve the named `App` export used by `sidecar/src/index.tsx`.
- Keep `sidecar/src/index.tsx` and `sidecar/src/runtime/` SDK-only; they are not copied into
  standalone projects.
- Keep the project watcher and development launcher separate. Standalone source lives outside the
  SDK checkout, so Bun's sidecar watch mode cannot see it.
- Change product metadata in `app.config.json`; generated Tauri, Cargo, HTML, and CSS values are
  synchronized by `scripts/app/sync-app-config.ts`.
- Keep direct Bun and Cargo dependency versions exact.
- Guard and document platform-specific behavior.
- Update the README when public commands, requirements, configuration, or layout change.
- Do not commit generated output, dependency directories, or synchronized standalone-project
  files.

## 📦 Audit dependencies

Check direct dependency versions, lockfiles, and known vulnerabilities with:

```sh
cargo install cargo-audit --locked
bun run deps:audit
```

When updating dependencies manually, review upstream changelogs and test the native lifecycle
before committing the changes.

## 📬 Open a pull request

Keep each pull request small and explain:

- What changed and why.
- What users will notice.
- Which automated and manual checks you ran.
- Any follow-up work or known limitations.

Add screenshots or a short recording for visible interface changes. Link related issues when
available.
