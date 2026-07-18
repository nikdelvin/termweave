<div align="center">
  <img src="./sdk/readme-title.svg" width="192" height="48" alt="Termweave" />
</div>

<p align="center">
  A config-driven Tauri + OpenTUI builder for native desktop terminal apps.
</p>

<p align="center">
  <img
    src="./sdk/termweave-sdk.gif"
    width="100%"
    alt="Termweave project preview"
  />
</p>

Termweave packages an [OpenTUI](https://github.com/anomalyco/opentui) interface powered by
[Solid](https://www.solidjs.com/) into a native [Tauri](https://tauri.app/) window. The OpenTUI
application runs as a bundled sidecar, streams terminal output over a mutually authenticated local
WebSocket, and is rendered by [xterm.js](https://github.com/xtermjs/xterm.js) inside the webview.

Use it for terminal-style games, dashboards, focused productivity tools, launchers, and other
keyboard-first desktop applications without making a browser UI imitate a terminal one component
at a time.

## What is included

- OpenTUI + Solid application state in a compiled Bun sidecar.
- A native Tauri 2 window with xterm.js as the terminal renderer.
- A centered, fixed 16:9 terminal canvas that scales with the desktop window.
- A square-cell Kreative Square font and deterministic row/column calculation.
- One JSON file for product metadata, window geometry, colors, diagnostics, and icon source.
- Automatic synchronization of Tauri, Cargo, Bun, HTML, and CSS branding.
- Desktop icon generation from one SVG or PNG source; mobile icon outputs are discarded.
- A native-window startup sequence that avoids the initial white webview flash.
- A centered xterm loading indicator while OpenTUI starts.
- Per-instance sidecar identity, a random client token, an ephemeral localhost port, mutual
  authentication, and crash recovery.
- Optional production diagnostics for investigating bundled-app failures.

Termweave is not a shell or a general-purpose PTY emulator. xterm.js is the display and input
surface for the bundled OpenTUI application.

## Prerequisites

- macOS (the standalone installer and development wrapper are currently macOS-only)
- [Bun](https://bun.sh/) 1.3 or newer
- A stable Rust toolchain
- The platform dependencies listed in the
  [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)

Install Xcode Command Line Tools before building. The generated native application uses the host
toolchain and does not currently support cross-compilation.

## Quick start

Create an empty project directory, download the installer, and run it:

```sh
mkdir my-termweave-project
cd my-termweave-project
curl -fsSLo install.sh https://raw.githubusercontent.com/nikdelvin/termweave/main/sdk/install.sh
sh install.sh
```

The installer prompts for application metadata, clones the repository into the ignored
`termweave/` directory, runs the SDK from `termweave/sdk/`, creates the OpenTUI project scaffold,
and installs the project and SDK dependencies.

Start the desktop application from the project root:

```sh
bun run dev
```

Create a production bundle for the current host platform:

```sh
bun run build
```

The release bundles are copied to the project root under `build/`.

## Create your application

Most applications only need changes in three places:

1. Edit `app.config.json` for product metadata, window size, terminal grid, and base colors.
2. Replace `app.icon.svg` with one SVG or PNG source icon and update `icon` if its path changes.
3. Replace the welcome interface in `src/App.tsx` and add application modules under `src/`.

Then run:

```sh
bun run dev
```

The project root is the source of truth. Termweave copies the project source, configuration, and
icon into the ignored SDK before running its existing configuration and native build workflow.
Do not edit the copied files under `termweave/sdk/`.

While `bun run dev` is running, source changes are copied into the SDK and Bun restarts only the
OpenTUI sidecar. The Tauri window stays open and reconnects. Configuration and icon changes require
stopping and rerunning the development command.

`src/App.tsx` must export a named `App` component. `src/index.tsx` is reserved by the SDK, and
symbolic links beneath `src/` are rejected so synchronization cannot copy files from outside the
project.

Run the project checks without opening the native application:

```sh
bun run check
```

This runs ESLint, TypeScript, and a Prettier check. Use `bun run format` to apply formatting.

## Update the SDK

Projects follow the latest `main` branch only when explicitly requested:

```sh
bun run update
```

The update command discards derived changes inside the ignored SDK clone, resets it to
`origin/main`, reinstalls its dependencies, preserves user-added root package fields and
dependencies, and reapplies the root project. Changes made directly inside `termweave/` are not
preserved. The runner verifies the SDK location and its identity marker before performing the
destructive reset.

## Dependency version policy

All direct Bun and Cargo dependencies use exact versions. Security overrides for transitive Bun
packages are exact as well. Bun packages shared by the SDK, sidecar, and generated project use the
same version. Every Bun workspace—including the project template—and the native Rust crate has a
committed lockfile for transitive dependencies. The installer copies the template lockfile into new
projects before installing anything.

Application developers should receive dependency changes through `bun run update`; they should not
update packages inside `termweave/` directly.

SDK maintainers can work from the `sdk/` directory and preview or apply coordinated stable
dependency updates with:

```sh
cd sdk
bun run sdk:deps:update --dry-run
bun run sdk:deps:update
```

Install `cargo-audit` once, then audit all Bun and Rust lockfiles with:

```sh
cargo install cargo-audit --locked
bun run sdk:deps:audit
```

By default, the updater stays within the current major version, or the current minor version for
pre-1.0 packages. Use `--latest` only when intentionally reviewing breaking releases:

```sh
bun run sdk:deps:update --dry-run --latest
```

The maintainer command updates all three Bun manifests and the Cargo manifest, regenerates their
lockfiles, and runs the non-Tauri checks. Breaking dependency changes may still require code changes
and native manual verification before committing.

## Application configuration

`app.config.json` is the source of truth:

```json
{
  "name": "Termweave",
  "description": "A config-driven Tauri and OpenTUI builder for native desktop terminal apps.",
  "packageName": "termweave",
  "bundleIdentifier": "com.nikdelvin.termweave",
  "version": "0.1.0",
  "authors": ["Nik Delvin"],
  "windowWidth": 1920,
  "windowHeight": 1080,
  "fontSize": 15,
  "showDiagnostics": false,
  "themeColor": "#0B1020",
  "foregroundColor": "#E6EDF7",
  "icon": "app.icon.svg"
}
```

| Field                          | Purpose                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `name`                         | Native product name, window title, HTML title, and accessible terminal label.     |
| `description`                  | Root package and Cargo package description.                                       |
| `packageName`                  | Lowercase kebab-case Bun package and Rust package name.                           |
| `bundleIdentifier`             | Reverse-domain Tauri bundle identifier and sidecar protocol namespace.            |
| `version`                      | Semantic version synchronized across Bun, Cargo, and Tauri.                       |
| `authors`                      | Cargo package authors.                                                            |
| `windowWidth` / `windowHeight` | Reference design resolution and initial native window size. Must be exactly 16:9. |
| `fontSize`                     | Reference square cell size used to derive terminal columns and rows.              |
| `showDiagnostics`              | Shows the production diagnostics panel when `true`. Keep `false` for releases.    |
| `themeColor`                   | Background for the native window, webview, xterm.js, and OpenTUI.                 |
| `foregroundColor`              | Default xterm.js/OpenTUI text, cursor, and loading indicator color.               |
| `icon`                         | Project-relative source SVG or PNG used to generate desktop bundle icons.         |

The terminal grid is calculated as:

```text
columns = windowWidth / fontSize
rows    = windowHeight / fontSize
```

Both results must be integers or configuration synchronization stops with an error. The default
`1920 × 1080` design at `15px` produces a `128 × 72` grid. The bundled square font is deliberately
not configurable because a different font can break cell geometry.

The actual xterm font size is recalculated when the native window changes size. The terminal keeps
its configured grid, remains centered, and fits inside the largest available 16:9 area. The app
launches fullscreen by default, but the native window remains resizable and can leave fullscreen.

The icon may be stored at the project root or in a user-owned asset directory. SDK-managed
directories such as `src/`, `termweave/`, and `node_modules/` are intentionally rejected.

## Generated branding

The root `bun run dev` and `bun run build` commands copy the project configuration and run the
SDK's existing configuration synchronization automatically.

The synchronization script updates:

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/src/main.rs`
- `package.json`
- the root workspace entry in `bun.lock`
- `index.html`
- the generated theme variables in `src/styles.css`

Do not hand-edit synchronized branding values in those files. Change `app.config.json` instead.

The SDK's icon generator creates the macOS, Windows, and Linux icon files under
`termweave/sdk/src-tauri/icons/`. Generated icons, host-specific sidecar binaries, and the complete
SDK checkout are ignored by the outer project Git repository.

## Architecture

```mermaid
flowchart LR
  Native["Tauri / Rust process"] -->|starts and monitors| Sidecar["Bun sidecar"]
  Sidecar --> Solid["OpenTUI + Solid app"]
  Solid -->|ANSI output over local WebSocket| Xterm["xterm.js"]
  Xterm --> Webview["Tauri webview"]
  Webview -->|keyboard and mouse input| Sidecar
  Native -->|ephemeral port, identity, and client token| Webview
```

At startup, Tauri allocates an unused localhost port, a unique instance ID, and a random client
token. The webview passes them to the sidecar process. The sidecar must first identify itself with
the expected protocol, instance ID, and port; the webview must then prove possession of the token.
No terminal data is released until both sides are authenticated. If the sidecar exits unexpectedly,
the webview first attempts to reconnect and then starts a replacement process.

The native window stays hidden until the page background, bundled font, xterm.js, and loading frame
are ready. This avoids a white startup flash while still providing immediate feedback before the
first OpenTUI frame arrives.

Development diagnostics are enabled automatically. Production builds do not capture terminal
input or output unless `showDiagnostics` is explicitly enabled.

## Project layout

```text
src/App.tsx          OpenTUI + Solid application entry
src/                 User components and application modules
app.config.json      Product and rendering configuration
app.icon.svg         Default source icon
package.json         Root development, build, update, and quality commands
tsconfig.json        User-project TypeScript configuration
eslint.config.js     User-project ESLint configuration
termweave/sdk/       SDK runtime within the ignored repository clone
build/               Ignored native bundle output
```

## Scripts

| Command                | Purpose                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| `bun run dev`          | Check and sync the root project, then start Tauri with sidecar reload.      |
| `bun run build`        | Check and sync the project, build native bundles, and copy them to build/.  |
| `bun run update`       | Reset and update the ignored SDK clone, reinstall, and reapply the project. |
| `bun run check`        | Run root ESLint, TypeScript, and Prettier validation.                       |
| `bun run lint`         | Lint the user-owned source tree.                                            |
| `bun run typecheck`    | Type-check the user-owned source tree without emitting files.               |
| `bun run format`       | Format the user-owned project files.                                        |
| `bun run format:check` | Check formatting without modifying files.                                   |

## Platform notes

- The standalone installer and development wrapper currently support macOS only. Tauri targets
  macOS, Windows, and Linux, but installers should be validated and signed on every platform you
  plan to release.
- The sidecar build uses `rustc --print host-tuple`, so it produces a binary for the current host.
  Cross-compilation is not configured.
- Mobile targets are intentionally out of scope; the icon script removes Android and iOS outputs.
- The local WebSocket is an internal transport, not a network API. Do not bind it to a public
  interface without adding an appropriate security model.

## License

[MIT](./LICENSE)

Contributions are welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md).