# Termweave

Termweave turns an [OpenTUI](https://github.com/anomalyco/opentui) and
[Solid](https://www.solidjs.com/) interface into a native
[Tauri](https://tauri.app/) desktop application. The repository root is a complete Termweave SDK
v2 application template for macOS on Apple Silicon and Intel.

The terminal is presented on a fixed 2560×1440, 128×72 grid inside an always-on monitor and CRT
effect. Application authors own `app/`, application metadata, the theme color, and the icon;
Termweave owns the renderer, transport, presentation, and packaging implementation.

## Quick start

Install Bun 1.3+, stable Rust, and the Xcode Command Line Tools, then run:

```sh
git clone https://github.com/nikdelvin/termweave.git
cd termweave
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
- opted-in production media under `app/media/`
- `app/App.tsx` when changing global keyboard navigation

They normally do not edit `app/index.tsx`, `termweave/`, `scripts/`, `src-tauri/`, build
configuration, manifests, lockfiles, or generated output.

`app.icon.png` is only the packaged application icon. Animation demonstrates
`app/assets/campfire.gif`, Picture renders the committed first-frame `campfire.png`, and Remote
Video streams the Sintel trailer over HTTPS. The starter input is global application state, so its
value persists while navigating among all three screens.

The screens share one application-level `PixelRenderer`, allowing their overlays to remount while
the prior media frame remains visible during a source change. Successful local image decodes are
also retained in a bounded frame cache so later visits at the same terminal size start immediately.

After the native sidecar and CRT renderer start, Termweave plays the SDK-owned turn-on sound once,
then loops the CRT noise ambience at 0.3 volume. CRT ambience and streamed media share one native
audio engine and are both released during sidecar shutdown.

## PixelRenderer media

`PixelRenderer` accepts ordinary local PNG, JPEG, and GIF paths, local MP4 paths, direct HTTPS URLs
ending in `.mp4`, `.gif`, `.png`, `.jpg`, or `.jpeg`, and bundled `media:` resources. Local images
keep the lightweight in-process decoder and bounded cache. MP4, HTTPS, and explicit bundled media
stream through the packaged FFmpeg process, so compressed sources are not loaded into JavaScript
memory.

The demo's Remote Video screen streams
[Blender Foundation's CC-BY Sintel trailer](https://studio.blender.org/projects/sintel/) directly
over HTTPS. The sample is a 1920×1080 MP4 containing H.264 High Profile video and AAC-LC stereo
audio.

To opt a large file into Tauri resources, place it below `app/media/` and create its stable URI:

```ts
import { bundledMediaUri } from '#termweave'

const intro = bundledMediaUri('video/intro.mp4')
// media:video/intro.mp4
```

The same URI resolves to `app/media/` in development and the copied Tauri resource in a packaged
application. Supported streamed video is H.264 or HEVC in MP4 with optional AAC audio. Video,
animated GIFs, and remote animations loop after EOF; PNG and JPEG sources hold their single frame.
Audio-less MP4 files play silently. Playback intentionally has no seek or transport controls.

The media process uses HTTPS through macOS Secure Transport, source timestamps without a fixed FPS
filter, optional VideoToolbox decoding with software fallback, an audio-primary clock, a two-frame
presentation queue, bounded diagnostics, and RGB332 conversion immediately before publication.
Late video frames are discarded so rendering does not stall keyboard input.

## Ownership map

| Path                            | Responsibility                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `app/`                          | User-owned state, composition, screens, controls, assets, and navigation policy. |
| `termweave/components/`         | SDK Solid components and finite/streaming media playback pipelines.              |
| `termweave/assets/`             | SDK-owned CRT startup and ambient audio.                                         |
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
import {
  PixelRenderer,
  bundledMediaUri,
  createScreenNavigation,
  getTermweaveConfig,
} from '#termweave'
```

The runtime exports `PixelRenderer`, `bundledMediaUri`, `getTermweaveConfig`, and
`createScreenNavigation`. The public types are `PixelRendererProps`, `TermweaveConfig`, and
`ScreenNavigation`. Configuration returns only:

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

Run these commands from the repository root:

| Command                | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `bun run dev`          | Prepare generated inputs, build the development launcher, and start Tauri. |
| `bun run test`         | Run all behavior, lifecycle, transport, renderer, and boundary tests.      |
| `bun run typecheck`    | Type-check TypeScript without emitting.                                    |
| `bun run lint`         | Lint application, runtime, scripts, tests, and Vite configuration.         |
| `bun run format:check` | Verify Prettier and Rust formatting.                                       |
| `bun run ffmpeg:build` | Verify or build the pinned LGPL FFmpeg binary for the current Mac target.  |
| `bun run check`        | Run the full test/static/Rust validation sequence.                         |
| `bun run build`        | Validate, prepare, compile the sidecar, and build the native `.app`.       |

Generated icons/overrides, compiled sidecars, frontend output, schemas, Rust targets, and
dependencies are ignored. Preparation replaces stale generated inputs and never rewrites tracked
manifests.

Issues and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing.
Termweave is available under the [MIT License](./LICENSE).
