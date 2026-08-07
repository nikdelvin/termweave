# Termweave v2 architecture and manual v1 migration

Termweave v2 is a single-package, macOS-only application template with one visible ownership
boundary:

```text
sdk-v2/
├── app/          application-owned screens, components, assets, and navigation
├── termweave/    SDK components, sidecar bootstrap, host runtime, and SDK assets
├── scripts/      SDK build, preparation, and development tooling
└── src-tauri/    conventional native host and packaging configuration
```

The v1 tree in `sdk/` remains a historical reference. v2 does not synchronize with it, patch it,
manage it as a checkout, or provide an automatic update path.

## Final runtime architecture

`app/index.tsx` is a deliberately small composition root. It imports the application `App` and the
internal `runTermweaveApp` bootstrap, then supplies `() => <App />`. All fd 0 handling, renderer
construction, raw stdout, signals, and shutdown behavior live in `termweave/sidecar.tsx`.

The WebView entry is `termweave/host/main.ts`. It creates the fixed xterm surface, always activates
the monitor/noise presentation, attempts same-canvas WebGL CRT postprocessing, launches the packaged
OpenTUI sidecar, and preserves the stock renderer as the transactional fallback.

Runtime import direction is one-way:

```text
app/index.tsx ──► app/App.tsx
      │
      └────────► termweave/sidecar.tsx

ordinary app files ──► #termweave
termweave/*          ──X app components
```

`app/screens.ts` remains the only screen registry. `ScreenKey` is inferred from it, and the global
application store exposes only the `screen` accessor and typed `navigate()` function. No router,
history, provider, binding table, or compatibility layer is present.

## Fixed presentation and transport policy

- Logical terminal surface: 2560×1440.
- Grid: 128 columns × 72 rows at a 20px font size.
- Foreground and cursor: `#F59B5A`.
- Monitor inset: 64px.
- Monitor, static optics, WebGL CRT attempt, and CSS noise: always on.
- Reduced motion freezes the CSS noise animation without hiding static noise or optics.
- Transport remains raw bytes over Tauri sidecar stdin/stdout.
- OpenTUI input remains `/dev/fd/0`; its output uses the callback-aware native feed.
- WebGL activation, context loss, resize, restoration, or presentation failure returns to the stock
  xterm renderer and performs at most one emergency handoff blit.
- Packaging supports macOS arm64 and x64 only.

## Manual migration from v1

There is no automatic migration or compatibility adapter. Migrate application intent, not v1 SDK
internals:

1. Copy a clean `sdk-v2/` tree and install its pinned dependencies normally.
2. Fill in the eight `app.config.json` fields: `name`, `description`, `packageName`,
   `bundleIdentifier`, `version`, `authors`, `themeColor`, and `icon`.
3. Replace `app.icon.png` and copy application-owned images into `app/assets/`.
4. Convert v1 routes to ordinary components under `app/screens/` and register them once in
   `app/screens.ts`.
5. Replace router calls with typed `navigate()` calls. Put global keyboard choices in `app/App.tsx`;
   focused input and local callbacks remain in screens/components.
6. Replace v1 SDK imports with `#termweave`. Only `PixelRenderer`, `PixelRendererProps`,
   `getTermweaveConfig`, and `TermweaveConfig` are component-facing.
7. Remove audio/video, remote-media, updater, managed-checkout, router-patch, and synchronization
   assumptions; v2 intentionally does not provide those architectures.
8. Run `bun run test`, `bun run check`, and `bun run build`, then complete native 1×/2× visual and
   lifecycle verification.

Do not copy v1 `termweave/`, sidecar runtime, patches, generated Tauri configuration, dependencies,
lockfiles, or build output into v2.

## Release invariants

The packaged `.app` contains the Tauri executable, `opentui-sidecar`, generated icon/metadata, and
the architecture-specific `Resources/opentui-assets/@opentui/core-darwin-*/libopentui.dylib`. It
does not contain Bun, `node_modules`, FFmpeg, audio/video resources, loopback listeners, source,
tests, or documentation.

Physical 1× and 2× display verification remains a release gate. If full-resolution CRT rendering
fails that gate, retain the historical Phase 4 fallback; do not introduce downsampling, a second
framebuffer/canvas, or a separate recovery renderer.
