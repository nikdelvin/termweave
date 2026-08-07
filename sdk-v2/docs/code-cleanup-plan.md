# SDK v2 code cleanup and future-state naming plan

## Objective

Finish the SDK v2 cleanup around names and responsibilities that will remain accurate as applications
grow beyond the starter example. Application state belongs to the application, reusable screen
navigation belongs to the SDK, and host/runtime modules should be named after the behavior they own
rather than their historical location or implementation accident.

This is primarily a structural refactor, with one intentional starter behavior change: the example
counter and input become global application state and therefore persist across screen navigation.
Transport, rendering, fallback, packaging, and lifecycle guarantees remain unchanged.

## Final decisions

- Rename `app/app-store.ts` to `app/store.ts` and reserve it for user-owned global application data.
- Move the starter counter and input text into `app/store.ts` so the template demonstrates persistent
  global state.
- Add `termweave/navigation-store.ts` as a generic SDK-owned screen-navigation primitive.
- Instantiate SDK navigation directly in `app/store.ts` with the app-owned `ScreenKey` type; do not
  add a separate application navigation module.
- Keep `app/screens.ts` as the only screen registry and keep `ScreenKey` inferred from that registry.
- Rename `ScreenControls` to `AppStatePanel` because it demonstrates application state, focus, input,
  and screen context rather than owning navigation controls.
- Expand the `#termweave` runtime API from two to three exports by adding
  `createScreenNavigation`. This explicitly supersedes the previous exact-two-export constraint.
- Retain `getTermweaveConfig`; its name remains appropriate for a resolved component-facing SDK view
  that may grow beyond colors later.
- Split the oversized terminal and image modules along behavioral boundaries.
- Rename ambiguous host and runtime entrypoints so WebView-host and OpenTUI-sidecar responsibilities
  are immediately distinguishable.
- Preserve the fixed terminal grid, always-on monitor/CRT policy, raw byte transport, default-renderer
  fallback, native packaging contract, and application/SDK import direction.

## Scope

### In scope

- File, function, type, and variable naming under `sdk-v2/app/`, `sdk-v2/termweave/`, and
  `sdk-v2/scripts/`.
- Application global-state ownership and the starter state demonstration.
- Generic SDK screen-navigation ownership and its typed integration in `app/store.ts`.
- Cohesion-driven splits of `termweave/host/terminal.ts` and
  `termweave/components/image.ts`.
- Shared color parsing used by PixelRenderer, monitor presentation, and CRT postprocessing.
- Internal test seams and test filenames.
- Authored-source contract cleanup, import-boundary validation, documentation, and build-path updates.
- Full static, behavioral, native-build, packaging, and clean-copy validation.

### Out of scope

- Changes under `sdk/`.
- Dependency or lockfile upgrades.
- A router, history stack, URL integration, provider, binding table, or navigation framework.
- Dynamic terminal geometry, mouse remapping, remote media, audio/video, installers, publishing, or
  automatic SDK updates.
- Windows or Linux support.
- Changes to CRT calibration, monitor geometry, shaders, transport protocols, or native command names.
- Compatibility aliases for renamed internal modules.

## Architectural invariants

The cleanup must preserve these boundaries:

```text
app/store.ts
    owns user data and actions and exposes the typed navigation instance

termweave/navigation-store.ts
    owns generic navigation mechanics

app/screens.ts
    remains the sole screen registry

ordinary app files
    import SDK features only through #termweave

termweave/*
    never imports application modules
```

Additional invariants:

- `app/index.tsx` remains the sole composition-root exception to the ordinary application import
  rule.
- `app/store.ts` uses a type-only import of `ScreenKey`; it must not import the screen registry at
  runtime.
- `navigate(destination)` remains typed, key-agnostic, and a same-screen no-op through Solid signal
  equality.
- `App.tsx` retains the single global keyboard listener and owns all six starter Up/Down transitions.
- Focus handles, component references, timers, AbortControllers, renderer objects, and other
  lifecycle-bound resources never enter `app/store.ts`.
- No runtime import cycle is introduced.

## Target structure

```text
sdk-v2/
├── app/
│   ├── assets/
│   │   └── campfire.gif
│   ├── components/
│   │   └── AppStatePanel.tsx
│   ├── screens/
│   │   ├── GalleryScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   └── PlainScreen.tsx
│   ├── App.tsx
│   ├── index.tsx
│   ├── screens.ts
│   └── store.ts
├── termweave/
│   ├── components/
│   │   ├── PixelRenderer.tsx
│   │   ├── crt-palette.ts
│   │   ├── image-controller.ts
│   │   ├── image-decoder.ts
│   │   ├── image-playback.ts
│   │   ├── image-source.ts
│   │   └── pixel-frame.ts
│   ├── host/
│   │   ├── assets/
│   │   ├── crt-optics.ts
│   │   ├── crt-postprocessor.ts
│   │   ├── crt-renderer.ts
│   │   ├── glyph-atlas.ts
│   │   ├── monitor-presentation.ts
│   │   ├── sidecar-session.ts
│   │   ├── webview-entry.ts
│   │   ├── webview-host.ts
│   │   ├── webview.css
│   │   └── xterm-terminal.ts
│   ├── color.ts
│   ├── config.ts
│   ├── constants.ts
│   ├── index.ts
│   ├── navigation-store.ts
│   └── sidecar-runtime.tsx
├── scripts/
│   ├── build-sidecar.ts
│   ├── development-launcher.ts
│   └── prepare.ts
├── tests/
├── docs/
├── app.config.json
├── app.icon.png
└── index.html
```

This tree is a target, not a mandate to fragment cohesive sensitive code. `crt-optics.ts`,
`crt-postprocessor.ts`, `glyph-atlas.ts`, `config.ts`, and `constants.ts` remain intact unless the
implementation reveals a concrete ownership problem.

## Application state

### `app/store.ts`

`app/store.ts` becomes a first-day, user-editable file for application data. The starter state is:

```ts
interface AppState {
  readonly counter: number
  readonly inputText: string
}
```

The module should create one Solid store, instantiate the SDK navigation primitive with
`ScreenKey`, keep raw setters private, and expose one obvious application-state surface:

```ts
appState
adjustCounter(delta)
setInputText(value)
resetAppState()
screen
navigate(destination)
```

`resetAppState()` is a legitimate application action and also provides deterministic test setup.
The module owns the application instance of navigation but not its signal implementation. It must
not contain screen-transition rules, keyboard handling, the screen registry, input focus, or
component-local resources.

### `AppStatePanel`

Rename `app/components/ScreenControls.tsx` and its component to `AppStatePanel`. It should:

- Read `counter` and `inputText` from `app/store.ts`.
- Call `adjustCounter()` for unmodified Left/Right keypresses.
- Call `setInputText()` from the text input callback.
- Read the active screen from `app/store.ts` for display only.
- Keep the `InputRenderable` reference and mount-time focus local to the component.
- Rename `screenInputId()` to `appStateInputId()` or another component-specific name.

The counter and input text now persist when navigating Home → Gallery → Plain → Home. Component
focus still re-establishes on mount, and media/component resources still dispose normally.

## SDK screen navigation

### `termweave/navigation-store.ts`

Provide a generic, minimal SDK primitive:

```ts
interface ScreenNavigation<Screen> {
  readonly screen: Accessor<Screen>
  navigate(destination: Screen): void
}

createScreenNavigation<Screen>(initialScreen): ScreenNavigation<Screen>
```

Requirements:

- Use one Solid signal and keep its setter private.
- Preserve Solid's equality-based same-screen no-op behavior.
- Do not know about application screen components, registry keys, keyboard events, transitions,
  history, or routes.
- Do not add validation lists, fallback cycles, preload behavior, or providers.
- Keep the returned surface frozen or otherwise mutation-safe.

### Application binding in `app/store.ts`

Instantiate the SDK primitive alongside application state rather than creating another wiring file:

```ts
createScreenNavigation<ScreenKey>('/')
```

Export the typed `screen` accessor and `navigate()` action with the application state/actions.
Import `ScreenKey` with `import type`; do not import `screens` at runtime. Screens and nested
components import everything application-state-related from `app/store.ts`, while the reusable
navigation mechanics remain in the SDK.

### Public SDK surface

The final `#termweave` runtime exports are exactly:

```text
PixelRenderer
getTermweaveConfig
createScreenNavigation
```

The public type exports are:

```text
PixelRendererProps
TermweaveConfig
ScreenNavigation
```

`AppConfig`, `getAppConfig`, fixed constants, sidecar bootstrap, host APIs, image pipeline types, and
navigation setters remain internal.

## File and symbol naming decisions

### Entrypoints and orchestration

| Current | Target | Reason |
| --- | --- | --- |
| `termweave/sidecar.tsx` | `termweave/sidecar-runtime.tsx` | Distinguishes the compiled OpenTUI process runtime from build scripts and host sessions. |
| `runTermweaveApp` | `startTermweaveSidecar` | Names the process being started and avoids implying that it owns the whole desktop app. |
| `termweave/host/main.ts` | `termweave/host/webview-entry.ts` | Identifies the Vite/WebView entrypoint explicitly. |
| top-level host orchestration in `main.ts` | `startWebviewHost` in `webview-host.ts` | Makes startup ordering behavior-testable without authored-source assertions. |
| `styles.css` | `webview.css` | Associates styles with the WebView host rather than an unspecified global surface. |

`webview-entry.ts` should be deliberately tiny: import host CSS, invoke `startWebviewHost()`, and
surface an unrecoverable startup failure once. `webview-host.ts` owns terminal construction,
presentation construction, renderer activation, sidecar-session startup, status rendering, and
idempotent cleanup.

### Monitor presentation

| Current | Target |
| --- | --- |
| `presentation.ts` | `monitor-presentation.ts` |
| `PresentationLayout` | `MonitorLayout` |
| `presentationLayout()` | `calculateMonitorLayout()` |
| `scaleStageToFit()` | `calculateStageScale()` |
| `createPresentation()` | `createMonitorPresentation()` |
| `monitorArtwork` | `MONITOR_ARTWORK_GEOMETRY` |

Keep bezel filtering, fixed geometry, DOM element lookup, CSS custom properties, ResizeObserver
ownership, and cleanup together in this module.

### Xterm and CRT renderer

Split `host/terminal.ts` into three modules:

1. `xterm-terminal.ts`
   - `terminalOptions()` → `createXtermOptions()`
   - `createTerminal()` → `createXtermTerminal()`
   - Own fixed xterm configuration and wheel suppression only.
2. `crt-renderer.ts`
   - `enableWebglRenderer()` → `activateCrtRenderer()`
   - `WebglRendererStatus` → `CrtRendererStatus`
   - `WebglRendererController` → `CrtRendererController`
   - `CreateWebglAddon` → `WebglAddonFactory`
   - `CreateCrtPostprocessor` → `CrtPostprocessorFactory`
   - Own WebGL activation, CRT attachment, glyph-atlas recycling, status changes, and transactional
     fallback.
3. `sidecar-session.ts`
   - `createTerminalSession()` → `createSidecarSession()`
   - `ProcessExit` → `SidecarExit`
   - `RawChunk` → `SidecarOutputChunk`
   - Replace test-oriented `TerminalLike`, `ChildLike`, `SidecarCommandLike`, and `AppWindowLike`
     names with capability names such as `TerminalPort`, `SidecarProcess`, `SidecarCommand`, and
     `DesktopWindow`.
   - Own raw stdout, incremental stderr decoding, ordered stdin writes, window reveal/focus,
     close handling, child termination, and idempotent disposal.

The split must not change activation ordering: the stock WebGL addon activates before the CRT
postprocessor, renderer status is subscribed before the sidecar starts, and every failure path
returns to the live default renderer.

### Pixel image pipeline

Split `components/image.ts` by responsibility:

| Module | Responsibility |
| --- | --- |
| `image-source.ts` | Local URI validation, file URL resolution, byte reading, cancellation, and format detection. |
| `pixel-frame.ts` | Frame/dimension types, safe lengths, fitting, centered viewport calculation, resizing, alpha composition, and palette application. |
| `image-decoder.ts` | Jimp still-image decoding, GIF patch validation/disposal/composition, and decoded frame production. |
| `image-playback.ts` | Clock abstraction, normalized delays, frame scheduling, drift handling, and disposal. |
| `image-controller.ts` | Request generations, AbortController ownership, loader/playback coordination, stale-result suppression, replacement, and disposal. |

Rename key functions for precision:

| Current | Target |
| --- | --- |
| `fittedDimensions()` | `fitImageDimensions()` |
| `centeredViewport()` | `calculateCenteredViewport()` |
| `resizeRgbaFrame()` | retain |
| `compositeAgainstBackground()` | `compositeFrameOverBackground()` |
| `loadLocalImage()` | `loadLocalImageFrames()` |
| `startAnimationPlayback()` | `startFramePlayback()` |
| `createImageController()` | `createImagePlaybackController()` |
| `pixelRendererErrorMessage()` | `formatPixelRendererError()` |
| `drawPixelFrame()` | `drawPixelFrameToBuffer()` |

Keep `PixelRenderer` and `PixelRendererProps` unchanged as public names. Keep `crt-palette.ts`
because the palette conversion is a coherent CRT-presentation policy and is already accurately
named.

## Shared color handling

Add `termweave/color.ts` instead of allowing separate parsers in PixelRenderer, monitor
presentation, and CRT optics. It should provide domain-specific primitives rather than a generic
utility collection:

```text
Rgb8                   integer channels from 0 through 255
RgbUnit                normalized channels from 0 through 1
isHexRgbColor(value)   six-digit hexadecimal validation
parseHexRgb8(value)    hexadecimal to byte tuple
normalizeRgb(rgb)      byte tuple to normalized tuple
```

Use the shared parser for:

- PixelRenderer transparency composition and palette anchoring.
- Monitor bezel filtering.
- CRT clear color and bright-pass threshold construction.
- `app.config.json` theme validation while preserving the existing concise field-specific error.

Do not centralize unrelated one-line helpers such as local `errorMessage()` functions into a
generic `utils.ts`. Keep `constants.ts` as the single 15-line fixed-policy module unless it grows
into genuinely separate domains.

## Build and development tooling

- Rename `scripts/dev-sidecar.ts` to `scripts/development-launcher.ts` because it watches and
  restarts the real sidecar rather than being the application sidecar itself.
- Retain `scripts/build-sidecar.ts`; it still builds the Tauri external binary.
- Rename `getSidecarOutputPath()` to `getSidecarBinaryPath()`.
- Rename `getHostTuple()` to `getRustHostTuple()`.
- Rename `buildSidecar()` to `buildSidecarBinary()` while retaining
  `buildProductionSidecar()` as the production convenience function.
- Prefer `IconGenerator` over the verb-like `GenerateIcons` type in `prepare.ts`.
- Prefer `OpenTuiNativeLibrary` over `OpenTuiNativeAsset` because the prepared artifact is
  specifically a dylib.
- Update package scripts, Vite ignore paths, HTML entrypaths, tests, docs, and build fixtures without
  changing their behavior.
- Keep the production sidecar entry at `app/index.tsx`, the output name
  `opentui-sidecar-<rust-triple>`, raw transport, Tauri command scope, and frontend output directory.

## Test organization and contract cleanup

Rename and split tests with the implementation domains:

| Current | Target |
| --- | --- |
| `app-store.test.ts` | `store.test.ts` plus `navigation-store.test.ts` |
| `terminal.test.ts` | `xterm-terminal.test.ts`, `crt-renderer.test.ts`, and `sidecar-session.test.ts` |
| `presentation.test.ts` | `monitor-presentation.test.ts` |
| `pixel-image.test.ts` | tests matching source, frame, decoder, playback, and controller modules |
| `pixel-renderer-contract.test.ts` | `public-api.test.ts` and `ownership-boundary.test.ts` |
| `xterm-webgl-contract.test.ts` | `xterm-source-contract.test.ts` plus behavior tests in runtime modules |

Behavioral changes to test explicitly:

- Counter and input text persist through every screen transition and repeated traversal.
- `resetAppState()` restores deterministic starter values.
- Focus moves to each newly mounted input while its global value persists.
- A same-screen navigation remains a no-op.
- Direct and nested typed `navigate()` calls continue to work.
- The App-level keyboard listener count remains stable.
- Home GIF cleanup, Gallery PNG disposal, Plain no-draw behavior, and error isolation remain intact.

Replace authored-source checks for local implementation spelling with executable contracts:

- Import the public barrel and assert the exact runtime/type surface.
- Build the runtime import graph and assert boundary direction and acyclicity.
- Inject host dependencies into `startWebviewHost()` to test renderer-before-session ordering.
- Test WebView DOM construction and status behavior rather than matching function-call text.
- Test actual build options and bundle contents instead of matching paths in authored source.
- Test raw bytes, callback completion, input ordering, DEBUG mutability, and `/dev/fd/0` behavior
  through runtime behavior where possible.

Retain narrow source checks only where pinned upstream behavior is the contract:

- xterm WebGL framebuffer binding absence.
- Render-event ordering.
- Existing-context reacquisition and restoration scheduling.
- OpenTUI callback-aware stdout feed assumptions.
- Shader source constants that deliberately mirror CPU calibration.
- Exclusion searches for forbidden architectures or media systems.

## Documentation updates

- Update `sdk-v2/README.md` ownership guidance so authors use `app/store.ts` as the single
  application-state entrypoint and normally leave `termweave/navigation-store.ts` alone.
- Update `docs/navigation.md` to distinguish generic SDK mechanics from the typed instance in
  `app/store.ts` and the application-owned transition policy.
- Update `docs/migration-plan.md` and root `README.md`/`CONTRIBUTING.md` with final filenames and the
  three-export public runtime surface.
- Document that starter state persists across screen navigation and that truly local state still
  belongs inside individual components.
- Preserve historical `src/*` names in `phase-4.5-webgl-postprocessing.md` when they describe the
  historical implementation. Add a short current-location note rather than rewriting history.
- Update this document if implementation evidence changes a target name; do not leave a mismatch
  between the tree, tests, and ownership documentation.

## Implementation sequence

### 1. Baseline and safety snapshot

- [ ] Record the current working-tree diff and test count.
- [ ] Hash `sdk/`, `sdk-v2/bun.lock`, `sdk-v2/src-tauri/Cargo.toml`, and
  `sdk-v2/src-tauri/Cargo.lock`.
- [ ] Run the current test, typecheck, lint, format, check, and build commands.
- [ ] Record the public exports and current runtime import graph.

### 2. Application state and navigation ownership

- [ ] Add `termweave/navigation-store.ts` with generic `createScreenNavigation()`.
- [ ] Export the navigation factory and type from `#termweave`.
- [ ] Rename `app/app-store.ts` to `app/store.ts`, instantiate typed SDK navigation there, and move
  counter/input state into the same application-state module.
- [ ] Replace navigation and state imports in `App.tsx`, components, screens, and tests.
- [ ] Rename `ScreenControls` to `AppStatePanel` and bind it to the global app store.
- [ ] Update lifecycle tests from local reset to intentional global persistence.

### 3. Entrypoint and presentation naming

- [ ] Rename the sidecar runtime and its bootstrap function.
- [ ] Extract `startWebviewHost()` and leave a thin WebView entrypoint.
- [ ] Rename monitor presentation files, symbols, CSS, DOM-facing test descriptions, and paths.
- [ ] Update `index.html`, Vite watcher ignores, docs, and contract tests.

### 4. Terminal responsibility split

- [ ] Extract xterm construction into `xterm-terminal.ts`.
- [ ] Extract CRT activation/fallback into `crt-renderer.ts`.
- [ ] Extract sidecar transport/window lifecycle into `sidecar-session.ts`.
- [ ] Rename controller, status, factory, process, and capability types.
- [ ] Preserve startup order, fallback latching, atlas recycling, redraw, diagnostics, and disposal.

### 5. Pixel image responsibility split

- [ ] Add shared color primitives and migrate all three color consumers.
- [ ] Extract image source, frame operations, decoding, playback, and controller modules.
- [ ] Rename internal functions and update PixelRenderer imports.
- [ ] Split tests by domain while retaining decode, GIF disposal, drift, cancellation, stale-result,
  error, resize, and draw coverage.

### 6. Tooling and test modernization

- [ ] Rename the development launcher and build/preparation symbols.
- [ ] Replace authored-source assertions with behavior, dependency injection, import-graph, and
  bundle assertions.
- [ ] Retain only the justified upstream/shader source contracts.
- [ ] Confirm no newly exported internal helper leaks through `#termweave`.

### 7. Documentation and release validation

- [ ] Update all active docs and first-day guidance.
- [ ] Run the full automated acceptance matrix.
- [ ] Inspect the native application bundle and run sanitized-environment launch smoke.
- [ ] Repeat clean-copy install/dev/build verification.
- [ ] Recheck protected hashes and confirm no changes under `sdk/` or lock/Cargo files.

## Automated acceptance

Run individually and through aggregate commands:

```sh
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run check
bun run build
```

Require:

- `#termweave` has exactly `PixelRenderer`, `getTermweaveConfig`, and
  `createScreenNavigation` as runtime exports.
- `ScreenNavigation<ScreenKey>` prevents navigation to unknown screen keys at compile time.
- `termweave/` never imports `app/`.
- Ordinary application files import SDK features only through `#termweave`.
- `app/store.ts` has no runtime dependency on `app/screens.ts`.
- The runtime import graph is acyclic.
- Counter and input text persist across all six directed screen transitions and repeated traversal.
- `resetAppState()` resets both fields between tests.
- Focus, typing, direct/nested navigation, same-screen no-op, and stable listener count remain covered.
- Home GIF, Gallery PNG, Plain no-media, media disposal, stale-frame suppression, and decode-error
  isolation remain covered.
- Terminal options remain 128×72 at 20px with fixed foreground/cursor colors.
- Monitor/noise remain always present and CRT initialization is always attempted.
- WebGL activation, context loss, resize, restoration, or presentation failure leaves a live default
  renderer.
- Raw stdout remains bytes, writes remain callback-aware, input remains ordered, DEBUG remains
  mutable, and `/dev/fd/0` remains the only OpenTUI input stream.
- No router, history, provider, patch, preload/cache layer, WebSocket, FFmpeg, audio/video, updater,
  SDK synchronization, or unsupported-platform branch appears.
- Package output paths, Tauri commands, resources, and external-binary names remain unchanged.

## Native and packaging acceptance

- Build and launch the `.app` through Tauri.
- Traverse every screen and confirm the counter/input persist while focus re-establishes.
- Exercise Left/Right, Tab/text input, all Up/Down transitions, and a nested direct navigation call.
- Force WebGL activation failure and context loss; verify one diagnostic and continued default-renderer
  input/output.
- Smoke GIF/PNG/Plain/input lifecycle and verify stable resources and write backlog.
- Inspect the bundle for the Tauri executable, `opentui-sidecar`, generated icon/metadata, and the
  architecture-specific OpenTUI dylib.
- Confirm Bun, `node_modules`, FFmpeg, audio/video resources, source, tests, and docs are absent.
- Launch from Finder or a sanitized environment without Bun on `PATH`.
- Repeat install/dev/build from a clean copy with ignored outputs removed.
- Retain physical 1×/2× visual verification as the release gate. Mechanical moves should not alter
  pixels; any observed visual difference is a regression, not a recalibration opportunity.

## Risk controls

- Perform pure file moves and symbol renames before responsibility splits so failures have a narrow
  cause.
- Keep each module extraction behavior-neutral and preserve tests before deleting the old module.
- Do not add compatibility re-export files; update every internal consumer atomically.
- Do not combine renderer/image semantic changes with naming work.
- Treat persistence of counter/input as the only approved behavior change.
- If extracting `startWebviewHost()` makes dependency injection more complex than the source checks
  it replaces, keep a small orchestration module and inject only terminal, renderer, command, and
  window factories.
- If an image split introduces cycles, move only shared value types and color primitives downward;
  do not create a generic catch-all module.
- If native 1×/2× output differs after mechanical cleanup, stop and compare bundles and execution
  order before proceeding.

## Completion definition

The cleanup is complete when a new application author can infer the architecture from filenames:

- `app/store.ts` is where durable user state lives.
- `app/store.ts` is the single application-state entrypoint, including the typed navigation
  instance.
- `termweave/navigation-store.ts` is the reusable SDK navigation mechanism.
- Sidecar runtime, WebView host, monitor presentation, xterm construction, CRT renderer, sidecar
  session, and pixel pipeline each have one clearly named owner.

All automated and native acceptance checks must pass, the packaged application must remain clean,
and protected dependencies, lockfiles, Cargo files, transport/rendering behavior, and `sdk/` must be
unchanged.
