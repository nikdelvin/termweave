### Phase 1

Implement Phase 1 of the SDK v2 migration plan in `sdk-v2`.

First, read `sdk-v2/docs/migration-plan.md` completely and follow it as the source of truth.

Scope for this pass:
- Create the single-package SDK v2 project skeleton.
- Add the flat `app.config.json` and pure shared TypeScript config parser.
- Add the minimal base Tauri project and configuration.
- Add `scripts/prepare.ts` to validate configuration, verify the icon, generate ignored icons, and create the ignored Tauri override.
- Add required manifests, TypeScript/Vite configuration, ignore rules, and focused config/preparation tests.
- Do not implement terminal transport, xterm, the OpenTUI sidecar, visuals, PixelRenderer, or router template yet.

Requirements:
- Keep `sdk/` completely untouched.
- Use one `package.json` and one `bun.lock`.
- Do not create nested packages or managed SDK/update/source-sync architecture.
- Do not rewrite tracked manifests during preparation.
- Keep the code minimal, direct, clean, and understandable.
- Reuse only the approved v1 icon/config defaults where appropriate; do not copy v1 architecture.
- Generated files must be ignored.
- Pin dependency versions.
- Preserve any unrelated existing changes.

Acceptance criteria:
- Valid config produces only ignored generated Tauri configuration and icon outputs.
- Invalid config fails with concise, actionable errors.
- Config tests cover every rule documented in the migration plan.
- Type checking, tests, linting, formatting checks, and relevant Tauri validation pass.
- `git status` shows no generated artifacts and no changes under `sdk/`.

Implement and verify the phase fully, then summarize the files created, validation performed, and any deviations from the migration plan.

### Phase 2

Implement Phase 2 of the SDK v2 migration plan in `sdk-v2`.

Read `sdk-v2/docs/migration-plan.md` completely and inspect the completed Phase 1 implementation first. Treat the document as the source of truth.

Scope:
- Add the minimal Tauri Rust host.
- Add xterm initialization with the fixed configured grid.
- Compile a minimal OpenTUI + Solid production sidecar.
- Spawn it through `Command.sidecar(..., { encoding: "raw" })`.
- Connect raw sidecar stdout to xterm and serialize xterm input writes to the child.
- Implement first-frame window reveal, streaming stderr decoding, process exit behavior, and idempotent cleanup.
- Add the minimum Tauri capabilities and CSP required by this design.

Transport requirements:
- Never decode sidecar stdout; pass `Uint8Array` directly to xterm.
- Register command listeners before spawning.
- Preserve input order with one promise chain.
- Reveal the hidden window after xterm confirms its first parsed output.
- Reveal startup errors instead of leaving a hidden window.
- Normal sidecar exit closes the app.
- Abnormal exit displays an error and leaves the window open.
- Window close kills the child before completing.
- Production must not retry or reconnect.
- OpenTUI must use `process.stdin` and `process.stdout` directly with the fixed grid.
- Diagnostics must use stderr.

Keep this phase visually minimal. Do not implement the development watcher, monitor overlay, CRT effects, PixelRenderer, or router template yet.

Keep `sdk/` untouched. Do not add WebSockets, ports, tokens, frame acknowledgements, PTYs, custom Rust runtime state, or general shell permissions.

Add focused tests for raw-byte preservation, split UTF-8/escape-sequence chunks, ordered input, first-frame reveal, stderr decoding, process exits, spawn failure, and cleanup.

Run all relevant tests, type checks, linting, formatting checks, Rust formatting/checks, and a basic Tauri launch smoke test. Summarize the implementation and verification results.

### Phase 3

Implement Phase 3 of the SDK v2 migration plan in `sdk-v2`.

Read `sdk-v2/docs/migration-plan.md` completely and verify Phases 1 and 2 are working before changing anything.

Scope:
- Add the small development sidecar launcher.
- Update `bun run dev` so Tauri spawns the compiled development launcher instead of the production application binary.
- Preserve the raw inherited stdin/stdout/stderr pipes across OpenTUI source restarts.

Required behavior:
- Watch `app/` and `shared/` recursively.
- Debounce source changes for 75 ms.
- Start `app/index.tsx` with Bun and `@opentui/solid/preload`.
- Send SIGTERM to the current child before a source-triggered restart.
- Coalesce changes received while restarting.
- Exit the launcher when the child exits successfully outside a source restart.
- After a non-zero child exit, keep the launcher alive and retry on the next source edit.
- Forward SIGINT and SIGTERM, await child shutdown, close watchers, and exit cleanly.
- Do not copy source files or create restart-signal files.
- Do not preserve application state across restarts.
- Configuration or icon changes continue to require restarting `bun run dev`.

Keep `sdk/` untouched. Do not add WebSockets, reconnect loops, source synchronization, nested SDK checkouts, or process-killing utilities.

Add deterministic tests for debounce behavior, restart coalescing, syntax-error recovery, clean child exit, signal forwarding, and watcher cleanup. Ensure the implementation can be tested without leaking real background processes.

Verify restart-on-save manually in the Tauri window, then run the full SDK v2 check suite. Report the behavior verified and any necessary deviations.

### Phase 4

Implement Phase 4 of the SDK v2 migration plan in `sdk-v2`.

Read `sdk-v2/docs/migration-plan.md` completely and inspect the completed transport and development lifecycle first.

Scope:
- Add the fixed 2560×1440 logical terminal stage and responsive uniform scaling.
- Add the configured local font.
- Add xterm’s WebGL addon with a small graceful fallback.
- Port exactly one monitor-overlay asset from SDK v1.
- Port the CRT noise texture if still useful.
- Implement the streamlined CRT presentation using CSS.
- Apply `backgroundColor`, `foregroundColor`, `monitorOverlay`, and `crtEffects` from the shared config.

Visual requirements:
- With the monitor enabled, position xterm under the single scaled monitor overlay.
- Fill unused native-window space with the configured background.
- With the monitor disabled, render the terminal edge to edge on the logical surface.
- CRT effects consist only of scanlines and low-opacity noise.
- Hide the complete effects host when `crtEffects` is false.
- Respect `prefers-reduced-motion`.
- Dispose the xterm WebGL addon on context loss and continue with xterm’s default renderer.

Do not migrate mirrored surround images, chromatic-aberration shaders, framebuffer capture, a second WebGL canvas, texture uploads, glyph-atlas reset logic, audio, or video.

Keep the visual implementation small: prefer CSS pseudo-elements and at most one dedicated noise element. Keep `sdk/` untouched.

Verify all four monitor/CRT flag combinations, reduced motion, fullscreen, multiple window aspect ratios, WebGL success, and fallback rendering. Run all checks and report the assets retained and v1 machinery intentionally excluded.

### Phase 4.5

Implement Phase 4.5 of the SDK v2 migration plan in `sdk-v2`.

Read `sdk-v2/docs/migration-plan.md` and
`sdk-v2/docs/phase-4.5-webgl-postprocessing.md` completely. Inspect and verify the committed Phase
4 baseline before changing visual or rendering code. Treat the Phase 4.5 document as the source of
truth wherever other planning text conflicts with its architecture, exclusions, implementation
order, or acceptance criteria.

Scope:
- Keep the pinned stock `@xterm/addon-webgl` 0.19.0 and `@xterm/xterm` 6.0.0 packages unchanged.
- After loading the stock addon, locate its display canvas below the public terminal element and
  reacquire the already-created WebGL2 context; add no canvas nodes or contexts.
- Allocate one full-drawing-buffer RGBA8 texture-backed framebuffer, validate it, and keep it bound
  while the unchanged addon renders backgrounds, glyphs, selection, and cursor.
- Present one final pass into the same canvas synchronously from `Terminal.onRender`, then restore
  shared GL state and rebind the Termweave framebuffer before returning.
- Add subtle barrel distortion, separable-axis chromatic aberration, curved shader scanlines, and
  restrained phosphor glow/bloom; retain Phase 4's low-opacity CSS noise.
- Keep OpenTUI mouse tracking disabled and add no postprocessor input-remapping layer.
- Observe drawing-buffer dimension changes and reallocate complete storage on the existing target
  before xterm's next redraw; recreate the full resource set after successful context restoration.
- Preserve config behavior, monitor layering, reduced motion, transactional activation fallback,
  permanent-context-loss disposal, and terminal lifetime.

Hard requirements:
- Do not fork, vendor, rebuild, republish, or patch the stock addon; do not import xterm private
  modules, read private runtime fields, or monkey-patch canvas, WebGL, or animation-frame globals.
- Do not use `readPixels`, `preserveDrawingBuffer`, snapshots, CPU frame capture, postprocessor
  uploads of captured terminal pixels, or a normal-frame copy from the default framebuffer.
- Do not add a canvas, second WebGL context, native render surface, or renderer recovery loop.
- Permit `blitFramebuffer` only as the documented one-time emergency raw-frame handoff after an
  unexpected runtime steering or presentation failure; never use it on the successful frame path.
- Do not add a same-context copy renderer, reduced-resolution target, second framebuffer, or silent
  downscaling if the full-resolution target misses the performance or memory gate; retain Phase 4.
- Do not add SVG filters, flicker, sweep, vignette, audio, video, mirrored surrounds, or v1 renderer machinery.
- Do not change the public configuration schema or `#termweave` API.
- Keep `sdk/` untouched.

Verify the pinned source contract (`bindFramebuffer` absence and post-render `Terminal.onRender`
ordering), same-context reacquisition, target binding before the first and every xterm render,
shared GL-state restoration, shader/FBO construction and failure paths, steering-invariant failure,
the one-time emergency blit, resize/DPR storage reallocation before redraw, successful context
restoration, exactly-once permanent-context-loss disposal, default-renderer continuity, the disabled
mouse-input contract, every monitor/CRT flag combination, reduced motion, fullscreen and
aspect-ratio scaling, 1×/2× display scale, single-canvas topology, resource lifetime, absence of
normal-frame copies, and the sustained full-resolution performance gate. Run `bun run check`,
`bun run frontend:build`, the native visual matrix, and the final exclusion audit.

### Phase 5

Implement Phase 5 of the SDK v2 migration plan in `sdk-v2`.

Read `sdk-v2/docs/migration-plan.md` completely, especially the PixelRenderer contract. Verify earlier phases pass before implementation.

Scope:
- Create the local `app/termweave` module.
- Export only `PixelRenderer`, `PixelRendererProps`, `getTermweaveConfig`, and `TermweaveConfig`.
- Implement bundled local PNG, JPEG, and animated GIF rendering.
- Use OpenTUI’s native `OptimizedBuffer.drawSuperSampleBuffer`.
- Support children rendered over the image.

Required behavior:
- Accept file paths and `file:` URLs produced by Bun file imports.
- Reject HTTP/HTTPS inputs clearly.
- Detect formats from content/signatures.
- Fit images using contain behavior, preserve aspect ratio, produce even pixel dimensions, and center them in the component.
- Composite transparency against the configured background.
- Draw decoded pixels directly into the active OpenTUI buffer.
- Display concise component-local errors without crashing the sidecar.
- Cancel old work when URI, dimensions, or component lifetime changes.
- Do not add preload APIs or a retained global cache.

GIF requirements:
- Composite full frames correctly.
- Support disposal modes 2 and 3.
- Preserve transparency.
- Convert missing/invalid delays to 100 ms.
- Clamp valid delays to at least 10 ms.
- Loop indefinitely.
- Use monotonic scheduling and skip expired frames after long pauses.
- Clean up timers and pending work on unmount or source change.

Use Jimp core PNG/JPEG plugins and `gifuct-js`. Do not add FFmpeg, video, remote fetching, audio, media clocks, manual quadrant fitting, RGB332 quantization, or intermediate framebuffers.

Add comprehensive tests for decoding, signatures, sizing, centering, transparency, GIF timing/disposal, errors, cancellation, cleanup, source changes, and child overlays. Run the full checks and a sustained animated-GIF responsiveness test.

### Phase 6

Implement Phase 6 of the SDK v2 migration plan in `sdk-v2`.

Read `sdk-v2/docs/migration-plan.md` completely and verify PixelRenderer and prior phases are stable.

Scope:
- Turn `app/` into the final copyable OpenTUI + Solid template.
- Add two routes:
  - `/` using a bundled animated GIF.
  - `/gallery` using a bundled PNG or JPEG.
- Use Solid Router’s memory integration directly.
- Add keyboard navigation and a small reactive signal demonstration.
- Use PixelRenderer on both routes with OpenTUI children layered above the media.

Router requirements:
- Use `MemoryRouter`, `Route`, and `useNavigate`.
- Use OpenTUI’s `useKeyboard` for route navigation.
- Use up/down or tab for route changes.
- Use left/right to update a Solid signal.
- Repeated navigation must work without a connected-route graph, preload system, manual history adapter, or keyed router remount.
- Route disposal must stop GIF playback from the previous route.
- Retain only the minimal package-export patch if the pinned Solid Router version demonstrably requires it.

Keep the template concise and instructional. Include no video, remote media, audio, updater, source synchronization, or compatibility adapters. Keep `sdk/` untouched.

Test both routes, repeated navigation, signal updates, focus/input behavior, GIF cleanup, decode errors, and child overlay ordering. Run the template manually in development and execute the complete check suite.
