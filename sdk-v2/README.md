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
- `app/screens.ts`
- files under `app/screens/`, `app/components/`, and `app/assets/`
- `app/App.tsx` when changing global keyboard navigation

They normally do not edit `app/index.tsx`, `app/app-store.ts`, `termweave/`, `scripts/`,
`src-tauri/`, build configuration, manifests, lockfiles, or generated output.

`app.icon.png` intentionally has two roles in the starter: it is the packaged application icon and
the Gallery screen's bundled PNG example. The Home screen demonstrates a bundled GIF; Plain shows
ordinary OpenTUI content without native media drawing.

## Ownership map

| Path                     | Responsibility                                                                 |
| ------------------------ | ------------------------------------------------------------------------------ |
| `app/`                   | User-owned application composition, screens, controls, assets, and navigation. |
| `termweave/components/`  | SDK Solid components and image decoding/rendering.                             |
| `termweave/host/`        | WebView terminal, CRT postprocessor, monitor presentation, and SDK assets.     |
| `termweave/config.ts`    | Internal application-config parsing and the narrow public resolved view.       |
| `termweave/constants.ts` | Fixed terminal, color, error, and native-asset policy.                         |
| `termweave/sidecar.tsx`  | fd 0, OpenTUI renderer, raw stdout, and shutdown lifecycle.                    |
| `scripts/`, `src-tauri/` | Build preparation and native packaging.                                        |

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

## Public component API

```ts
import { PixelRenderer, getTermweaveConfig } from '#termweave'
```

The runtime exports exactly `PixelRenderer` and `getTermweaveConfig`. The latter returns only:

```ts
interface TermweaveConfig {
  readonly themeColor: string
  readonly terminalForegroundColor: string
}
```

Navigation remains application-owned: `app/screens.ts` is the sole registry, `ScreenKey` is inferred
from it, and `navigate(destination)` is callable directly from screens or nested components.

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
