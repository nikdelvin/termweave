# Termweave SDK v2 Migration Plan

**Status:** Ready for implementation after review  
**SDK target:** 2.0.0  
**Initial platform:** macOS  
**Document date:** 2026-07-29

## 1. Purpose

Termweave SDK v2 is a clean rewrite of the SDK runtime and template. Its goal is to keep the
parts that define the product while removing infrastructure that is not required to display an
OpenTUI application in a native Tauri window.

The retained product surface is:

- A flat `app.config.json`.
- A configurable monitor overlay.
- Streamlined CRT effects.
- A `PixelRenderer` for bundled PNG, JPEG, and animated GIF assets.
- A copyable OpenTUI + Solid template using Solid Router.
- Native macOS development and application bundling.

The rewrite is successful when a copied `sdk-v2` directory can install dependencies, run the
template in development, and build a self-contained `.app` without any nested SDK checkout,
local WebSocket server, FFmpeg binary, video/audio subsystem, or source synchronization layer.

SDK v1 remains unchanged under `sdk/`. SDK v2 does not modify, update, or automatically migrate
existing v1 projects.

## 2. Design principles

Implementation decisions must follow these priorities in order:

1. Prefer the smallest direct implementation that meets the documented behavior.
2. Use existing Tauri, xterm, OpenTUI, Solid, and Bun primitives instead of introducing a custom
   protocol or framework.
3. Keep one package, one lockfile, one configuration parser, and one copy of application source.
4. Make process ownership and shutdown behavior explicit.
5. Fail visibly and locally instead of adding background reconnect or recovery loops.
6. Add abstractions only when there is more than one real implementation or call-site need.
7. Keep generated files ignored and never rewrite tracked manifests during development or build.

The rewrite must not copy v1 subsystems wholesale. Small assets, configuration values, and
well-scoped image-decoding logic may be migrated, but the surrounding architecture must be
implemented from the v2 design in this document.

## 3. Scope and v1 disposition

| V1 capability                               | V2 decision                                      |
| ------------------------------------------- | ------------------------------------------------ |
| Tauri window and WebView                    | Keep                                             |
| xterm terminal emulation                    | Keep                                             |
| xterm WebGL addon                           | Keep with a simple fallback                      |
| OpenTUI compiled sidecar                    | Keep                                             |
| Flat app configuration                      | Keep                                             |
| Fixed logical terminal grid                 | Keep                                             |
| Monitor illustration                        | Keep one overlay asset                           |
| CRT scanlines/noise                         | CSS in Phase 4; shader scanlines in Phase 4.5    |
| V1 chromatic-aberration framebuffer capture | Remove                                           |
| Same-canvas CRT optical postprocessor       | Plan separately in Phase 4.5                     |
| Mirrored monitor-surround assets            | Remove                                           |
| V1 glyph-atlas reset/handoff machinery      | Replace with bounded stock-addon recycling       |
| WebSocket terminal server                   | Remove                                           |
| Port allocation and authentication tokens   | Remove                                           |
| Frame IDs and acknowledgements              | Remove                                           |
| Sidecar reconnect/recovery cycles           | Remove                                           |
| Rust frontend-runtime command/state         | Remove                                           |
| MP4 playback                                | Remove                                           |
| FFmpeg binary and source resources          | Remove                                           |
| Video frame scheduler and media clock       | Remove                                           |
| Video audio playback                      | Remove                      |
| CRT startup and ambient audio             | Remove                      |
| Remote image fetching                     | Remove                      |
| Image preload APIs and retained cache     | Remove                      |
| Nested managed SDK Git checkout           | Remove                      |
| Project-to-sidecar source synchronization | Remove                      |
| SDK update manager                        | Remove                      |
| Global Bun process termination command    | Remove                      |
| Manifest and lockfile rewriting           | Remove                      |
| Installer/publishing workflow             | Defer                       |
| Dynamic terminal grid resize/PTY support  | Defer                       |
| Windows and Linux release support         | Defer                       |

## 4. Target architecture

```text
┌──────────────────────── Tauri application ────────────────────────┐
│                                                                   │
│  WebView                                                          │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ xterm.js                                                   │   │
│  │ + one monitor overlay                                      │   │
│  │ + CSS CRT effects                                          │   │
│  └────────────────────────────────────────────────────────────┘   │
│               ▲ raw stdout                   │ serialized stdin   │
│               │                              ▼                    │
│        @tauri-apps/plugin-shell child-process channel             │
│               ▲                              │                    │
│               │                              ▼                    │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ Compiled Bun sidecar                                       │   │
│  │ OpenTUI over process.stdin + fixed stdout adapter          │   │
│  │ Solid application + local #termweave module                │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

A Tauri sidecar is a subprocess, not a terminal display. OpenTUI produces terminal-control
sequences, so xterm remains responsible for interpreting those sequences and rendering pixels
inside the WebView. The simplification comes from connecting the two with Tauri's existing raw
child-process streams instead of running a second application protocol.

### Component responsibilities

**WebView host**

- Create and size xterm.
- Load the WebGL addon and fall back to xterm's default renderer if it fails.
- Spawn the configured sidecar.
- Forward raw stdout bytes to xterm without decoding.
- Forward xterm input to the sidecar in order.
- Apply monitor and CRT presentation.
- Own application-window visibility and child-process lifetime.

**Sidecar**

- Create OpenTUI over `process.stdin` and a fixed-geometry stdout adapter that delegates every
  write unchanged to `process.stdout` and selects OpenTUI's callback-aware `NativeSpanFeed` path.
- Render the Solid template.
- Read the shared app configuration at compile time/runtime.
- Exit cleanly after OpenTUI is destroyed.
- Write diagnostics only to stderr.

**Rust host**

- Initialize Tauri.
- Initialize `tauri-plugin-shell`.
- Run the application.

Rust must not allocate ports, tokens, protocol identities, or frontend runtime state.

## 5. Planned project structure

`sdk-v2` is both the reference application and the copyable project template. It uses one package
and one dependency installation.

```text
sdk-v2/
├── app/
│   ├── assets/
│   │   ├── example.gif
│   │   └── example.png
│   ├── routes/
│   │   ├── HomeRoute.tsx
│   │   └── GalleryRoute.tsx
│   ├── termweave/
│   │   ├── image.ts
│   │   ├── index.ts
│   │   └── PixelRenderer.tsx
│   ├── App.tsx
│   ├── index.tsx
│   └── routes.ts
├── docs/
│   ├── migration-plan.md
│   ├── migration-prompts.md
│   └── phase-4.5-webgl-postprocessing.md
├── scripts/
│   ├── build-sidecar.ts
│   ├── dev-sidecar.ts
│   └── prepare.ts
├── shared/
│   └── config.ts
├── src/
│   ├── assets/
│   │   ├── crt-noise.png
│   │   ├── font.ttf
│   │   └── monitor-overlay.webp
│   ├── main.ts
│   ├── styles.css
│   └── terminal.ts
├── src-tauri/
│   ├── capabilities/
│   │   └── default.json
│   ├── src/
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── tests/
├── app.config.json
├── app.icon.png
├── bun.lock
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

Generated sidecar binaries, Tauri overrides, generated icons, frontend output, Rust targets, and
dependencies are ignored. There is no `template/`, nested `sidecar/package.json`, local workspace
package, or copied project source.

The root `package.json` defines the standard package-internal import:

```json
{
  "imports": {
    "#termweave": "./app/termweave/index.ts"
  }
}
```

Template routes import the local SDK surface from `#termweave`. Nothing is published as
`@termweave/sdk` in v2.

## 6. Configuration contract

V2 keeps the existing flat configuration shape:

```json
{
  "name": "Termweave App",
  "description": "A terminal desktop application built with Termweave.",
  "packageName": "termweave-app",
  "bundleIdentifier": "com.example.termweave-app",
  "version": "0.1.0",
  "authors": ["Example Author"],
  "fontSize": 8,
  "backgroundColor": "#010416",
  "foregroundColor": "#F59B5A",
  "monitorOverlay": true,
  "crtEffects": true,
  "icon": "app.icon.png"
}
```

### Validation

`shared/config.ts` is a pure TypeScript module that imports, validates, and exposes the config.
It must not use Node-only APIs so the same module can be included by the WebView, scripts, and
sidecar.

Validation rules:

- `name`, `description`, and every author are non-empty strings after trimming.
- `packageName` is lowercase kebab case and starts with a letter.
- `bundleIdentifier` is a reverse-domain identifier with at least two segments.
- `version` is a valid three-part semantic version with an optional prerelease/build suffix.
- `authors` contains at least one author.
- `fontSize` is finite and greater than zero.
- Both `2560 / fontSize` and `1440 / fontSize` are integers.
- Colors are six-digit hexadecimal strings.
- `monitorOverlay` and `crtEffects` are booleans.
- `icon` is a non-empty project-relative PNG or SVG path that cannot escape the project root.
- The preparation script additionally verifies that the icon file exists.

The fixed logical surface is:

```ts
const terminalSurface = { width: 2560, height: 1440 };
const terminalGrid = {
  cols: terminalSurface.width / config.fontSize,
  rows: terminalSurface.height / config.fontSize,
  fontSize: config.fontSize,
  width: terminalSurface.width,
  height: terminalSurface.height,
};
```

The host scales this complete logical surface to fit the window. Resizing the native window does
not change OpenTUI rows or columns and does not send a resize message to the sidecar.

### Generated Tauri configuration

`scripts/prepare.ts` performs the only configuration preparation:

1. Validate `app.config.json`.
2. Verify the configured icon.
3. Generate icons under ignored `src-tauri/.generated/icons/`.
4. Write ignored `src-tauri/.generated/override.json`.

The override supplies:

- Product name.
- Application version.
- Bundle identifier.
- Main-window title and background.
- Generated bundle icon paths.

Development and build commands pass the override using Tauri's `--config` option. Cargo package
metadata, `package.json`, `bun.lock`, HTML, and CSS are never rewritten. The host applies visual
colors as CSS custom properties at startup.

Changing application source restarts only the development sidecar. Changing `app.config.json` or
the icon requires stopping and rerunning `bun run dev` so preparation and native window settings
are reapplied.

## 7. Local SDK interface

`app/termweave/index.ts` exports only:

```ts
export { PixelRenderer, type PixelRendererProps } from "./PixelRenderer";

export { getTermweaveConfig, type TermweaveConfig } from "../../shared/config";
```

The exact public configuration view is:

```ts
interface TermweaveConfig {
  backgroundColor: string;
  foregroundColor: string;
  terminalGrid: {
    cols: number;
    rows: number;
    fontSize: number;
    width: 2560;
    height: 1440;
  };
}

function getTermweaveConfig(): Readonly<TermweaveConfig>;
```

Application metadata remains available through the internal parsed config but is not part of the
local SDK's public component-facing interface.

There are no preload, cache-control, media, audio, transport, or lifecycle exports.

## 8. PixelRenderer contract

```ts
type PixelRendererDimension = NonNullable<RenderableOptions["width"]>;

interface PixelRendererProps {
  uri: string;
  width?: PixelRendererDimension;
  height?: PixelRendererDimension;
}
```

`PixelRenderer` also accepts Solid children and paints them after the image so routes can overlay
OpenTUI controls and text.

### Supported inputs

- Bundled PNG.
- Bundled JPEG (`.jpg` and `.jpeg`).
- Bundled GIF, including animated GIFs.
- File paths and `file:` URLs produced by Bun file imports.

Template usage:

```tsx
import background from "../assets/example.gif" with { type: "file" };
import { PixelRenderer } from "#termweave";

export function HomeRoute() {
  return (
    <PixelRenderer uri={background} width="100%" height="100%">
      <text>Overlay content</text>
    </PixelRenderer>
  );
}
```

HTTP and HTTPS URLs are rejected with a clear local-only error. Format detection is based on
decoded content/signatures rather than trusting the file extension.

### Rendering rules

- The component owns a background-filled OpenTUI box.
- The image is fitted with `contain` behavior and retains its aspect ratio.
- Output dimensions are even source-pixel dimensions because OpenTUI maps a 2×2 pixel sample to
  one terminal cell.
- The fitted image is centered in the component's current cell bounds.
- RGBA transparency is composited against the configured background color.
- Opaque output is reduced to a uniform RGB333 cube plus the exact configured background color.
  This bounds custom-glyph atlas growth while retaining materially better blue and shadow detail
  than RGB332; the background anchor keeps transparent edges seamless with the component box.
- Decoded pixel bytes are drawn directly with OpenTUI's native
  `OptimizedBuffer.drawSuperSampleBuffer`.
- No manual glyph selection, quadrant fitting, intermediate `OptimizedBuffer`, or framebuffer
  copying is implemented in TypeScript.
- Changing `uri` or component dimensions cancels the current load/playback and starts a new one.
- An empty URI renders the background and a concise error banner.
- Decode errors render a concise error banner without terminating the sidecar.
- There is no module-level preload API or retained global image cache.

PNG and JPEG decoding use Jimp's core PNG/JPEG plugins. GIF parsing uses `gifuct-js`.

### GIF behavior

- Frames are composited onto a full RGBA canvas.
- Disposal mode 2 clears the previous frame rectangle.
- Disposal mode 3 restores the previous canvas snapshot.
- Transparency is preserved until final background composition.
- A missing, zero, negative, or invalid frame delay becomes 100 ms.
- Valid delays are rounded and clamped to a minimum of 10 ms.
- Playback loops indefinitely.
- Scheduling uses a monotonic clock and skips expired frames after a long event-loop pause rather
  than rapidly replaying every missed frame.
- Timers and pending work are cancelled on cleanup, URI change, and dimension change.

## 9. Raw sidecar transport

### Host startup sequence

1. Validate/read the shared config.
2. Create xterm with the fixed grid, configured font, colors, no scrollback, and no cursor blink.
3. Open xterm while the native window remains hidden.
4. Attempt to load `@xterm/addon-webgl`; continue with xterm's default renderer on failure.
5. Construct `Command.sidecar("binaries/opentui-sidecar", [], { encoding: "raw" })`.
6. Register stdout, stderr, error, and close listeners before spawning.
7. Spawn the child.
8. Subscribe to xterm input.
9. Reveal the window after xterm's callback confirms the first stdout bytes were parsed.

`stdout` payloads remain `Uint8Array` values all the way into `terminal.write`. They must never be
decoded to strings because UTF-8 characters and terminal sequences may be split across pipe
chunks.

Input writes use one promise chain:

```ts
inputWrite = inputWrite.then(() => child.write(data)).catch(reportInputFailure);
```

This preserves ordering without a custom queue class or protocol. Once an input failure is
reported, later input is ignored.

Stderr uses one streaming `TextDecoder` and is shown as a concise startup/runtime diagnostic. An
error received before the first terminal frame reveals the window so startup failures are never
hidden.

### Sidecar renderer

The production sidecar passes `process.stdin` and a distinct fixed-geometry stdout adapter to
`createCliRenderer`. The adapter delegates `write` unchanged to `process.stdout`; because it is a
distinct object, pinned OpenTUI uses its callback-aware `NativeSpanFeed` and waits for pending pipe
writes instead of overrunning the sidecar channel. This is byte-preserving flow control, not a
custom transport or framing protocol. Renderer options also include:

- Fixed width and height from the shared grid.
- `remote: true`.
- Alternate-screen mode.
- Disabled console overlay.
- Disabled mouse input and movement.
- Disabled Kitty keyboard negotiation unless later required by a demonstrated template behavior.
- Ctrl+C exit enabled.
- Explicit clean shutdown for SIGINT and SIGTERM.

Terminal capability responses emitted by xterm return over the same stdin pipe. Sidecar logs and
diagnostics use stderr so they cannot corrupt terminal output.

### Lifecycle rules

- Closing the native window disposes xterm, removes subscriptions, and kills the child before
  allowing the window to close.
- A normal production sidecar exit (`code === 0`) closes the native window.
- An abnormal production exit writes a concise terminal error and leaves the window open for the
  user to inspect and close.
- Spawn failure reveals the window and displays the error.
- Production does not reconnect or restart a failed sidecar.
- Sidecar shutdown destroys OpenTUI before exiting so terminal modes are reset.
- Cleanup is idempotent and tolerates an already-exited child.

### Backpressure policy

V2 does not implement frame acknowledgements. OpenTUI remains request-driven, GIF rendering
honors source frame delays, and xterm owns its write buffer. The sustained GIF test must verify
that this remains bounded in the supported template.

If the performance gate fails, reduce/coalesce rendering at the producer. Do not reintroduce a
WebSocket server or general acknowledgement protocol.

## 10. Development launcher

Production compiles `app/index.tsx` into the target-suffixed sidecar binary. Development compiles
one small launcher into that same external-binary location.

The launcher:

- Watches `app/` and `shared/` recursively.
- Debounces changes for 75 ms.
- Runs the OpenTUI entry with Bun and `@opentui/solid/preload`.
- Inherits stdin, stdout, and stderr so Tauri's outer sidecar pipes remain stable.
- Sends SIGTERM to the current child before a source-triggered restart.
- Coalesces additional changes received during a restart.
- Exits when the child exits successfully outside a source-triggered restart.
- Remains alive after a non-zero child exit and waits for the next source change.
- Forwards SIGINT and SIGTERM, waits for the child, closes watchers, and exits.
- Watches source directly; it does not copy files or create restart-signal files.

This provides restart-on-save without preserving application state. Stateful hot reload is out of
scope.

## 11. Visual host

### Terminal

- One fixed 2560×1440 logical stage.
- Grid derived from `fontSize`.
- Included local font.
- Configured foreground/background colors.
- Zero scrollback.
- Wheel scrolling disabled.
- WebGL addon loaded with a small context-loss disposal handler.
- Default xterm renderer is the only fallback.

### Monitor overlay

- Migrate only `monitor-overlay.webp`.
- Scale the complete artboard uniformly to fit the available window.
- Keep the terminal screen positioned beneath the monitor image.
- Fill unused window space with the configured background.
- Do not reproduce mirrored horizontal, vertical, or diagonal surround images.
- When `monitorOverlay` is false, the terminal occupies the logical surface edge to edge.

### CRT effects

CRT effects are WebView overlays and do not copy or sample xterm's WebGL canvas.

The streamlined effect consists of:

- Scanlines.
- Low-opacity tiled noise.

Use the iconic 240p console raster. A normal 480i signal alternates two approximately 240-line
fields at different vertical positions; 240p console output repeats one field parity instead, so
only 240 active line positions are illuminated and the alternate positions remain dark.

The remaining 45 lines in the 525-line timing belong to the vertical blanking interval. They form
one off-picture retrace interval rather than 45 dark gaps distributed through the visible image,
so they are not rendered inside the CSS aperture.

Use the mass-market 16:9 Philips 28PW6006 consumer television as the physical reference rather
than a rare professional broadcast monitor. Its nominal 28-inch tube has a 660 mm visible
diagonal, giving a 575.240 × 323.572 mm picture. At 240p, illuminated line starts are
`323.572 mm / 240 = 1.348218 mm` apart. Author the scanline grid directly in this 240-line source
raster: every source-raster pixel is one complete bright/dark period. At a 1440-line output this
naturally becomes a 6 px illuminated-line pitch, but 6 px is an output scale factor rather than the
physical calibration. Render the first half of each period as untouched terminal and darken the
alternate half by `15%`. Derivative antialiasing avoids moiré when the output height is not an
integer multiple of 240. Keep the scanline grid stationary; raster refresh does not make the grid
crawl vertically for a viewer.

Noise may shift spatially, but its opacity stays constant to avoid reintroducing a whole-screen
flicker. Retain the 128×128 grayscale v1 texture: it has an opaque, near-neutral luminance
distribution and therefore does not bias the image brighter or darker through the blend mode.
Cycle eight integer-pixel texture phases over 133.467 ms, producing approximately 59.94 spatial
updates per second without interpolation. This follows the NTSC/240p field cadence while avoiding
the slow directional drift and low-frequency opacity pulse of the earlier CSS. Under reduced
motion, retain one static low-opacity phase.

References: [ITU-T J.182](https://www.itu.int/rec/T-REC-J.182-200103-I/en),
[Analog Devices' interlaced-video explanation](https://www.analog.com/en/resources/technical-articles/basics-of-analog-video.html),
and [HD Retrovision's 240p technical overview](https://www.hdretrovision.com/240p).

Use CSS pseudo-elements and at most one dedicated noise element. Respect
`prefers-reduced-motion` by disabling animations. When `crtEffects` is false, the entire effect
host is hidden.

The v1 chromatic-aberration shader, second WebGL context, texture upload, and rendered-frame
handoff are intentionally not migrated. V2 separately monitors the public stock-addon atlas events
and recreates that addon before its reported WebGL texture-page limit; it does not retain captured
frames or introduce another render surface.

Phase 4.5 may later replace the stock WebGL addon with a pinned same-canvas renderer fork. That
work is additive and separately reviewed; it does not reinterpret the v1 capture pipeline as part
of Phase 4. See [Phase 4.5 — Same-Canvas WebGL CRT Optics](./phase-4.5-webgl-postprocessing.md).

## 12. Solid Router template

The template contains two routes:

- `/` displays a bundled animated GIF.
- `/gallery` displays a bundled PNG or JPEG.

It uses Solid Router's memory integration because there is no browser URL:

- `MemoryRouter` owns route state.
- `Route` declares each component directly.
- `useNavigate` changes routes.
- OpenTUI's `useKeyboard` maps up/down or tab keys to route changes.
- Left/right keys update a small Solid signal to demonstrate reactive state.

There is no connected-route graph, image preload, manual history adapter, or keyed router remount.
Repeated navigation must preserve correct focus and render the destination route without a
workaround. The existing small package-export patch may be retained only if the pinned Solid
Router release still requires its universal export; no behavioral fork of Solid Router is added.

## 13. Build and command surface

V2 exposes only ordinary project commands:

| Command                | Behavior                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `bun run dev`          | Prepare config/icons, compile the development launcher, and run Tauri dev           |
| `bun run build`        | Run checks, prepare config/icons, compile the production sidecar, and build bundles |
| `bun run check`        | Run tests, type checking, lint, and formatting checks                               |
| `bun run test`         | Run Bun tests                                                                       |
| `bun run typecheck`    | Run TypeScript without emit                                                         |
| `bun run lint`         | Run ESLint                                                                          |
| `bun run format`       | Format tracked source/configuration                                                 |
| `bun run format:check` | Check formatting without writing                                                    |

There is no `update`, `sync`, `terminate`, or custom build-output copy command. Native outputs stay
in Tauri's standard bundle directory.

### Sidecar build

`scripts/build-sidecar.ts`:

- Gets the host tuple from `rustc --print host-tuple`.
- Adds `.exe` only on Windows, although Windows is not initially supported.
- Writes `src-tauri/binaries/opentui-sidecar-$TARGET_TRIPLE`.
- Uses the OpenTUI Solid Bun build plugin for production.
- Compiles `scripts/dev-sidecar.ts` instead for development.
- Fails with Bun build diagnostics and no fallback behavior.

The production `.app` must contain the compiled sidecar and run without a separately installed
Bun.

### Tauri configuration

The base `tauri.conf.json` contains stable build paths, window defaults, and:

```json
{
  "bundle": {
    "externalBin": ["binaries/opentui-sidecar"]
  }
}
```

The CSP permits only bundled content and Tauri IPC. It contains no loopback WebSocket or remote
media source.

The main-window capability grants:

- Core defaults required by the host.
- Window show/close/focus operations used by startup and cleanup.
- `shell:allow-spawn` scoped to the one sidecar.
- `shell:allow-stdin-write`.
- `shell:allow-kill`.

No general shell execution permission is granted.

## 14. Implementation phases

Every phase must leave checks passing before the next begins.

### Phase 0 — Documentation

- Add only this document.
- Review architecture, interfaces, exclusions, and acceptance criteria.
- Do not create v2 manifests or source until the document is approved.

### Phase 1 — Skeleton and configuration

- Create the single-package directory structure.
- Add the flat config, pure parser, Tauri base, generated override preparation, and ignored paths.
- Add config and preparation tests.

**Exit:** Invalid config fails clearly; valid config produces only ignored Tauri outputs.

### Phase 2 — Direct terminal transport

- Add the minimal Tauri Rust host.
- Add xterm initialization.
- Compile and spawn a minimal OpenTUI sidecar over raw pipes.
- Implement startup reveal, ordered input, errors, and cleanup.

**Exit:** A keyboard-driven text screen works without any TCP/WebSocket listener or custom Rust
runtime state.

### Phase 3 — Development lifecycle

- Add the development sidecar launcher and watcher.
- Cover source restarts, syntax-error waiting, normal exit, and signal forwarding.

**Exit:** Saving OpenTUI source restarts it inside the existing Tauri window; fixing a syntax error
recovers on the next save.

### Phase 4 — Streamlined visuals

- Migrate the font, noise texture, and one monitor overlay.
- Add fixed-surface scaling, xterm WebGL fallback, and CSS CRT effects.
- Exercise every overlay/effects configuration combination.

**Exit:** The template retains Termweave's visual identity without framebuffer capture or mirrored
surround assets.

### Phase 4.5 — Same-canvas WebGL CRT optics

- Begin only after Phase 4 is committed as an independently shippable baseline.
- Use one GPU-resident render target and one final pass inside xterm's existing WebGL canvas.
- Add restrained barrel distortion, separable-axis chromatic aberration, and phosphor glow/bloom.
- Move Phase 4's straight CSS scanlines into the curved shader pass and retain low-opacity CSS
  noise.
- Keep OpenTUI mouse tracking disabled and add no postprocessor input-remapping layer.
- Preserve the stock default-renderer fallback on activation failure and context loss.
- Follow the detailed architecture, exclusions, implementation order, and verification gates in
  [the Phase 4.5 plan](./phase-4.5-webgl-postprocessing.md).

**Exit:** Static CRT optics render through the one xterm canvas without CPU frame capture,
preserved default-framebuffer contents, a second canvas/context, a postprocessor input-remapping
layer, or loss of Phase 4 fallback behavior.

### Phase 5 — Image and GIF PixelRenderer

- Add local decoding, contain sizing, background composition, native supersampled drawing, GIF
  disposal/timing, and error UI.
- Add focused unit and component tests.

**Exit:** Local PNG, JPEG, and animated GIF assets render correctly with child overlays and clean
up on route changes.

### Phase 6 — Solid Router template

- Add the two routes, local assets, navigation component, and reactive signal example.
- Verify repeated navigation and route disposal.

**Exit:** The copyable template demonstrates every retained public v2 feature.

### Phase 7 — Packaging and audit

- Run the complete check/build suite.
- Inspect the `.app` contents and launch it outside the development shell.
- Compare tracked runtime/automation code with v1 and remove unnecessary wrappers or duplication.
- Confirm every excluded subsystem is absent.

**Exit:** The release acceptance criteria below are satisfied.

## 15. Test plan

### Unit tests

**Configuration**

- Valid default configuration.
- Empty required strings and authors.
- Invalid package name, bundle identifier, semantic version, colors, and booleans.
- Missing/invalid icon path.
- Icon path traversal.
- Font sizes producing fractional rows or columns.
- Correct derived grid.

**Image helpers**

- PNG and JPEG decoding.
- Content-based GIF detection.
- Contain fitting for landscape, portrait, exact, and very small images.
- Even output pixel dimensions.
- Transparency over a configured background.
- GIF disposal modes 2 and 3.
- Missing/invalid GIF frame delays.
- GIFs with no image frames.
- Cleanup and cancellation.

**Build helpers**

- Apple Silicon and Intel macOS target-suffixed sidecar paths.
- `.exe` suffix behavior as a portability check.
- Failed build diagnostics.

### Transport and lifecycle tests

- Raw stdout bytes reach xterm unchanged.
- A multibyte character split across chunks remains valid because stdout is not decoded.
- Terminal escape sequences split across chunks are accepted.
- Rapid input writes preserve order.
- Spawn failure reveals a readable error.
- Stderr is decoded incrementally.
- First parsed stdout reveals the window exactly once.
- Clean sidecar exit closes the window.
- Abnormal exit remains visible.
- Closing the window kills a running sidecar.
- Repeated cleanup is harmless.

### Development launcher tests

- One edit causes one debounced restart.
- Multiple edits during restart coalesce.
- Syntax-error exit waits for the next edit.
- The next valid edit starts successfully.
- Clean child exit closes the launcher.
- SIGINT/SIGTERM reach the child and close watchers.

### Router and component tests

- Both routes render.
- Repeated forward/back navigation works.
- Route changes stop the previous GIF timer.
- Left/right signal changes render without navigation.
- PixelRenderer children remain above the image.
- Decode failure displays the component error without crashing the app.

### Visual matrix

Test all combinations:

| Monitor | CRT | Expected                                  |
| ------- | --- | ----------------------------------------- |
| On      | On  | Monitor frame and animated CRT effects    |
| On      | Off | Monitor frame with a clean terminal image |
| Off     | On  | Edge-to-edge terminal with CRT effects    |
| Off     | Off | Plain edge-to-edge terminal               |

Also verify reduced-motion behavior, common window aspect ratios, fullscreen scaling, WebGL
success, and default-renderer fallback.

Phase 4.5 additionally verifies same-canvas topology, shader/FBO failures, context loss, barrel
mapping, the disabled mouse-input contract, 1×/2× display scale, GPU resource lifetime, and the
performance gate defined in
[`phase-4.5-webgl-postprocessing.md`](./phase-4.5-webgl-postprocessing.md).

### Performance smoke test

Run an animated GIF route continuously for at least ten minutes while repeatedly navigating and
sending input. Confirm:

- Input remains responsive.
- The xterm write queue does not grow without bound.
- Memory stabilizes after initial GIF decoding.
- Timers do not multiply after route changes.
- No output frames are routed through a WebSocket/TCP server.

This is a correctness gate, not a request for a new scheduling subsystem.

### Production package test

- `bun run build` produces a macOS `.app`.
- The bundle contains exactly the Tauri executable, compiled OpenTUI sidecar, required frontend
  assets, and ordinary macOS metadata.
- It contains no FFmpeg binary/source archive or media/audio assets.
- Launching from Finder works without Bun on `PATH`.
- Keyboard input, routing, PNG/JPEG/GIF rendering, overlay flags, and clean shutdown work.
- No loopback listener is opened.

## 16. Release acceptance criteria

SDK v2.0 is ready when:

- `sdk-v2` is a runnable and copyable self-contained project.
- `bun install`, `bun run dev`, `bun run check`, and `bun run build` succeed on supported macOS.
- Raw sidecar output and ordered input work without a custom protocol.
- The first terminal frame controls window reveal.
- Development source changes restart the sidecar without restarting Tauri.
- The flat config drives metadata, colors, grid, icon, monitor, and CRT options.
- PNG, JPEG, and GIF PixelRenderer behavior matches this document.
- The Solid memory-router template navigates reliably.
- The production `.app` requires no separately installed Bun.
- No v1 files under `sdk/` were modified.
- No v2 implementation contains WebSocket transport, port/token allocation, FFmpeg, MP4, audio,
  image preloading, managed SDK Git operations, project source copying, manifest rewriting, or
  automatic process recovery.
- Generated files are ignored and tracked files remain unchanged after `bun run dev`.

## 17. Migration guidance for v1 users

V2 is not an in-place upgrade. A v1 project migrates manually:

1. Copy a clean SDK v2 template.
2. Copy compatible values into the new flat `app.config.json`.
3. Copy the icon.
4. Move OpenTUI route/component source into `app/`.
5. Replace `@termweave/sdk` imports with `#termweave`.
6. Keep only PNG, JPEG, and GIF PixelRenderer usage.
7. Replace custom route history/preloading with the v2 memory-router pattern.
8. Rebuild and verify the visual matrix.

Video, remote-image, audio, updater, and managed-checkout behaviors have no v2 compatibility
adapter.

## 18. Risks and fixed responses

| Risk                                             | Response                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Tauri raw channel is too slow for a GIF          | Reduce/coalesce producer rendering; do not restore WebSockets                                  |
| xterm WebGL fails                                | Dispose the addon and use xterm's default renderer                                             |
| Phase 4.5 shader or framebuffer fails            | Dispose the enhanced addon and retain the Phase 4/default-renderer fallback                     |
| Mouse tracking is enabled under curved optics    | Keep it disabled; require accepted coordinate mapping before future mouse support               |
| Full-resolution Phase 4.5 target is too costly   | Use one deterministic visible-resolution target; do not add a multi-pass framebuffer chain     |
| Sidecar crashes in production                    | Show the error and let the user close; do not auto-restart                                     |
| Sidecar has a syntax error in development        | Keep launcher alive and retry on the next source edit                                          |
| GIF consumes excessive memory                    | Validate dimensions/frame data and document practical asset limits; do not add video streaming |
| Solid Router requires its universal export patch | Retain the minimal package-export patch only                                                   |
| Config changes during development                | Require restarting `bun run dev`                                                               |
| Future platform needs require a PTY              | Treat that as a separately designed post-v2 feature                                            |

## 19. Explicit assumptions

- SDK/template version is 2.0.0.
- `app.config.json` controls the generated application's version independently.
- macOS is the only initial release requirement.
- Code remains portable where doing so adds no architecture or dependency.
- The logical terminal surface remains fixed at 2560×1440.
- xterm remains the embedded terminal emulator.
- A PTY is not required for the owned OpenTUI sidecar and is out of scope.
- The monitor is a single scaled overlay; exact v1 surround behavior is not required.
- CRT effects are visual-only; all audio is removed.
- PixelRenderer supports bundled local PNG, JPEG, and GIF files only.
- V1 compatibility, installers, publishing, managed updates, and remote content are out of scope.

## 20. Reference documentation

- [Tauri: Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- [Tauri Shell Plugin](https://v2.tauri.app/plugin/shell/)
- [Tauri Architecture](https://v2.tauri.app/concept/architecture/)
- [OpenTUI Renderer and Custom Streams](https://opentui.com/docs/core-concepts/renderer/)
- [OpenTUI Lifecycle and Cleanup](https://opentui.com/docs/core-concepts/lifecycle/)
- [Phase 4.5 — Same-Canvas WebGL CRT Optics](./phase-4.5-webgl-postprocessing.md)
