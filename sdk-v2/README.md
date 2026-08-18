# Termweave SDK v2 template

This directory is a complete macOS application template. Its central rule is a visible ownership
boundary: application work belongs in `app/`; SDK/runtime work belongs in `termweave/`; conventional
build and native infrastructure remains at the root.

## Quick start

Install Bun 1.3+, stable Rust, and the Xcode Command Line Tools, then run:

```sh
bun install
bun run dev
```

The supported release targets are macOS arm64 and x64.

## First-day files

Application authors normally edit:

- `app.config.json` and `app.icon.png`
- `app/store.ts` for durable application data and actions
- `app/screens.ts`
- files under `app/screens/`, `app/components/`, and `app/assets/`
- `app/App.tsx` when changing global keyboard navigation

They normally do not edit `app/index.tsx`, `termweave/`, `scripts/`,
`src-tauri/`, build configuration, manifests, lockfiles, or generated output.

`app.icon.png` is only the packaged application icon. Animation demonstrates
`app/assets/campfire.gif`, Picture renders the committed first-frame `campfire.png`, and Plain shows
ordinary OpenTUI content without native media drawing. The starter counter and input are global
application state, so their values persist while navigating among all three screens.

Animation and Picture share one application-level `PixelRenderer`, allowing their overlays to
remount while the prior media frame remains visible during a source change. Successful decodes are
also retained in a bounded frame cache so later visits at the same terminal size start immediately.

## Ownership map

| Path                            | Responsibility                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `app/`                          | User-owned state, composition, screens, controls, assets, and navigation policy. |
| `termweave/components/`         | SDK Solid components and the source/frame/decoder/playback image pipeline.       |
| `termweave/host/`               | WebView host, xterm/session ownership, monitor presentation, and CRT effects.    |
| `termweave/config.ts`           | Internal application-config parsing and the narrow public resolved view.         |
| `termweave/constants.ts`        | Fixed terminal, color, error, and native-asset policy.                           |
| `termweave/navigation-store.ts` | Reusable generic screen-selection mechanics.                                     |
| `termweave/sidecar-runtime.tsx` | fd 0, OpenTUI renderer, raw stdout, and shutdown lifecycle.                      |
| `scripts/`, `src-tauri/`        | Build preparation and native packaging.                                          |

Ordinary `app/` files import SDK features only from `#termweave`. `app/index.tsx` is the sole
composition root and passes `App` to the runtime bootstrap. `termweave/` never imports application
components.

## Application configuration

`app.config.json` has this schema:

```json
{
  "name": "Termweave App",
  "description": "A terminal desktop application built with Termweave.",
  "packageName": "termweave-app",
  "bundleIdentifier": "com.example.termweave-app",
  "version": "0.1.0",
  "authors": ["Example Author"],
  "themeColor": "#010416",
  "icon": "app.icon.png"
}
```

`themeColor` must be a six-digit hexadecimal color. It unifies the native startup/window space,
monitor filtering, xterm/OpenTUI backgrounds, application examples, PixelRenderer composition, and
CRT clears/sampling. Unknown fields are ignored, but old `backgroundColor` is not an alias for a
missing `themeColor`.

Terminal geometry, 20px font size, foreground/cursor color, monitor geometry, CSS noise, and CRT
optical calibration are SDK-owned and fixed.

## Public SDK API

```ts
import { PixelRenderer, createScreenNavigation, getTermweaveConfig } from '#termweave'
```

The runtime exports exactly `PixelRenderer`, `getTermweaveConfig`, and `createScreenNavigation`.
The public types are `PixelRendererProps`, `TermweaveConfig`, and `ScreenNavigation`. Configuration
still returns only:

```ts
interface TermweaveConfig {
  readonly themeColor: string
  readonly terminalForegroundColor: string
}
```

`createScreenNavigation<Screen>(initialScreen)` is a generic signal-backed selector with a readonly
`screen` accessor and typed `navigate(destination)` action. `app/store.ts` creates the starter's
`ScreenKey`-typed instance, while `app/screens.ts` remains the sole registry and `App.tsx` owns all
keyboard transition choices. This is screen selection, not URL routing, history, or a provider.

Application state also lives in `app/store.ts`. Keep focus handles, timers, renderer objects, and
other mount-bound resources inside components; use the store only for data that should survive
screen remounts.

## Commands

| Command                | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `bun run dev`          | Prepare generated inputs, build the development launcher, and start Tauri. |
| `bun run test`         | Run all behavior, lifecycle, transport, renderer, and boundary tests.      |
| `bun run typecheck`    | Type-check TypeScript without emitting.                                    |
| `bun run lint`         | Lint application, runtime, scripts, tests, and Vite configuration.         |
| `bun run format:check` | Verify Prettier and Rust formatting.                                       |
| `bun run check`        | Run the full test/static/Rust validation sequence.                         |
| `bun run build`        | Validate, prepare, compile the sidecar, and build the native `.app`.       |

Generated icons/overrides, the compiled sidecar, frontend output, schemas, Rust targets, and
dependencies are ignored. Preparation replaces stale generated inputs and never rewrites tracked
manifests.
