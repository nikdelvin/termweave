# Phase 4.5 — Same-Canvas WebGL CRT Optics

**Status:** Planned after Phase 4 is committed  
**Depends on:** Completed Phase 4 streamlined visuals  
**Target:** SDK v2 on macOS WKWebView, with portable WebGL behavior where practical  
**Document date:** 2026-08-02

## 1. Purpose

Phase 4 established the small, reliable visual baseline: a fixed 2560×1440 logical terminal,
uniform window scaling, one monitor overlay, a local font, xterm's WebGL renderer with default
renderer fallback, and lightweight CSS CRT effects.

Phase 4.5 adds the three optical effects that require sampling the completed terminal image:

- Barrel distortion.
- Chromatic aberration.
- Phosphor glow/bloom.

The implementation will postprocess xterm inside its existing WebGL display canvas. It will not
add another HTML canvas, WebGL context, native render view, WebView snapshot path, or CPU frame
capture. Phase 4 remains independently shippable and is the rollback baseline.

## 2. Relationship to Phase 4

Phase 4 and Phase 4.5 have deliberately different boundaries.

Phase 4:

- Uses the stock pinned `@xterm/addon-webgl` 0.19.0.
- Uses CSS for scanlines and low-opacity noise.
- Does not sample or copy xterm's rendered image.
- Falls back to xterm's default renderer on activation failure or context loss.

Phase 4.5:

- Replaces the stock addon with a pinned Termweave fork of the same addon version.
- Keeps exactly one visible xterm WebGL canvas.
- Adds one GPU-resident render target and one final full-screen pass.
- Retains CSS scanlines and low-opacity noise.
- Adds static barrel distortion, chromatic aberration, and bloom when `crtEffects` is enabled.
- Preserves Phase 4's monitor geometry, colors, font, fixed grid, scaling, and fallback behavior.

Phase 4 should be committed before Phase 4.5 begins so the more invasive renderer work remains a
separate commit or pull request with a clean rollback point.

## 3. Terminology and hard boundary

"Same-canvas postprocessing" means:

- No canvas element beyond the canvases the stock xterm renderer already creates.
- One WebGL display canvas and one WebGL2 context owned by the xterm renderer.
- One internal RGBA texture attached to one internal framebuffer.
- A final shader that writes to the original visible canvas.

Stock xterm also owns internal 2D link-layer and glyph-atlas canvases. Phase 4.5 does not remove,
duplicate, postprocess, or count those as a second WebGL display surface. The topology requirement
is that the enhanced renderer adds no canvas node and requests no additional WebGL context.

The internal framebuffer is a render destination, not a frame-capture subsystem. Terminal pixels
remain on the GPU for the complete frame. The implementation must not use:

- `readPixels`.
- `toDataURL`, `toBlob`, `drawImage`, or `ImageBitmap` frame copies.
- `preserveDrawingBuffer`.
- WebView or window snapshots.
- CPU-accessible frame buffers.
- A second display canvas or WebGL context.
- Postprocessor uploads of captured terminal frames.

The pinned xterm renderer continues managing its existing glyph atlas and the texture updates
needed to render newly encountered glyphs. Phase 4.5 adds no terminal-frame upload path.

If the project later defines "no framebuffer" to prohibit even a GPU-only render target, this
phase cannot provide a true full-image postprocessor. The fallback would be limited CSS and
glyph-local approximations, not the design in this document.

## 4. Goals

- Render subtle, recognizable CRT curvature without distracting from the TUI.
- Apply a small radial RGB separation that is zero at the center and strongest near the edges.
- Add a restrained light halo around bright terminal content.
- Keep the monitor overlay sharp and undistorted above the processed terminal.
- Keep the configured background visible outside the curved sample boundary.
- Preserve the fixed 2560×1440 logical terminal and centered uniform scaling.
- Preserve terminal text, selection, cursor, keyboard input, and mouse-enabled TUI behavior.
- Dispose the enhanced WebGL renderer on context loss and continue with xterm's default renderer.
- Avoid a continuous render loop for static optics.
- Keep `crtEffects` as the only configuration switch for the complete CRT presentation.

## 5. Non-goals

Phase 4.5 will not add or restore:

- An additional canvas or compositor canvas.
- SVG reference filters such as `feDisplacementMap`.
- Native AppKit/Core Image filters.
- A native Metal view above the WKWebView.
- WKWebView snapshots, ScreenCaptureKit, or private IOSurface access.
- The v1 framebuffer readback/capture pipeline.
- The v1 chromatic-aberration renderer, shader files, or renderer handoff machinery.
- Mirrored monitor-surround images.
- Glyph-atlas reset or reload logic beyond the pinned xterm addon's existing internals.
- Dynamic CRT sliders or new public configuration fields.
- User-selectable renderer modes.
- Flicker, a vertical sweep, vignette, audio, or video.
- Bloom downsample chains, multiple blur framebuffers, or general postprocessing frameworks.
- A WebGPU renderer.

## 6. Browser and renderer findings

### SVG filters

SVG reference filters are not a safe fallback for the Tauri WebView. A local WKWebView probe on
macOS 26.3.1 / Safari 26.3.1 reported support through `CSS.supports` and returned the expected
computed `filter` values, but neither `feDisplacementMap` nor a simple `feOffset` changed pixels on
HTML or WebGL canvas snapshots. Feature detection was therefore a false positive for the required
use case.

Phase 4.5 must not depend on SVG filters.

### xterm WebGL API

The pinned `@xterm/addon-webgl` 0.19.0 package identifies upstream commit
`f447274f430fd22513f6adbf9862d19524471c04`. Its supported API exposes activation, disposal,
context loss, texture-atlas events, and atlas clearing. It does not expose the WebGL context,
render target, render callback, or a postprocess hook.

The implementation must not reach into runtime properties such as `_renderer`, `_canvas`, or
`_gl`. A pinned source fork is required so the render pass is explicit, reviewable, and covered by
tests.

## 7. Selected architecture

```text
OpenTUI output
     │
     ▼
xterm terminal model
     │
     ▼
Termweave fork of @xterm/addon-webgl 0.19.0
     │
     ├── rectangles, glyphs, selection, and cursor
     │       rendered directly into one GPU RGBA target
     │
     ▼
one full-screen CRT pass
     ├── inverse barrel sampling
     ├── radial RGB channel sampling
     └── small luminance bloom
     │
     ▼
the same visible xterm WebGL canvas
     │
     ├── CSS scanlines and low-opacity noise
     └── one unprocessed monitor overlay above everything
```

The final pass runs synchronously inside the addon's existing `renderRows` path, after xterm has
drawn the complete render model and before the browser presents the default framebuffer. It does
not depend on `Terminal.onRender`, `requestAnimationFrame`, or preserved default-framebuffer
contents.

### Layer order

The Phase 4 DOM order remains:

1. Terminal and its one WebGL display canvas.
2. CSS effects host containing scanlines and one noise element.
3. Single monitor overlay.

Only terminal pixels are barrel-distorted. The monitor artwork is physical casing and must remain
undistorted. CSS scanlines and noise remain compositor overlays in the first Phase 4.5 version;
they are intentionally not uploaded as WebGL textures and do not require continuous xterm redraws.

## 8. WebGL render pipeline

### Initialization

When `crtEffects` is enabled, renderer activation will:

1. Create the normal xterm WebGL2 canvas and context with `preserveDrawingBuffer: false`.
2. Compile and link one full-screen vertex shader and one CRT fragment shader.
3. Allocate one RGBA8 2D texture matching the selected render-target dimensions.
4. Attach the texture to one framebuffer.
5. Verify shader status, link status, framebuffer completeness, and texture-size limits.
6. Create one full-screen triangle or quad vertex buffer.
7. Continue only if every resource is valid.

Any failure throws through addon activation. The host catches it, disposes partial state, and
continues with xterm's default renderer exactly as Phase 4 does.

When `crtEffects` is disabled, the enhanced addon will use the normal direct rendering path and
will not allocate postprocessing resources.

### Frame rendering

For each xterm render:

1. Bind the internal framebuffer.
2. Set its viewport and clear it with `backgroundColor`.
3. Render xterm backgrounds, glyphs, selection, and cursor using the existing addon code.
4. Bind the default framebuffer.
5. Set the visible canvas viewport.
6. Bind the internal texture.
7. Draw the final full-screen pass.
8. Leave the renderer in the explicit state expected by the next xterm frame.

There is no copy from the default framebuffer. xterm renders directly into the texture-backed
framebuffer, and the final shader samples that texture once during presentation.

### Resource lifetime

The enhanced renderer owns and deletes:

- CRT program and shaders.
- Full-screen vertex buffer and vertex-array state.
- Render-target texture.
- Render-target framebuffer.

Disposal must be idempotent and safe after partial initialization. Resources are recreated only
for a legitimate drawable-size or device-pixel-ratio change while the context remains healthy.
They are not recreated after the host receives terminal context loss; the addon is disposed and
xterm's default renderer remains active.

## 9. CRT shader design

The first version uses one fragment pass and one source texture. It must remain intentionally
subtle and expose constants internally rather than adding configuration fields.

### Barrel distortion

- Convert destination UV coordinates into centered, aspect-corrected coordinates.
- Calculate radius squared from the centered position.
- Map the destination position to its source position with a low-strength radial polynomial.
- Keep the exact center invariant.
- Maintain horizontal and vertical symmetry.
- Return `backgroundColor` when the source coordinate falls outside the terminal texture.
- Avoid hard-coded monitor-artwork coordinates; distortion is normalized to the terminal surface.

The source-mapping function used by the shader must have a matching pure TypeScript reference for
unit tests and pointer-coordinate correction.

### Chromatic aberration

- Derive a normalized radial direction from the centered sample position.
- Use zero separation at the exact center.
- Increase separation gradually toward the edges.
- Sample red slightly outward, green at the barrel-mapped coordinate, and blue slightly inward.
- Express offsets in source texels so the visible effect remains stable across drawable sizes.
- Clamp strength to a subpixel or low-single-pixel range at the visible edge.
- Apply no temporal animation.

This is real channel sampling of the completed terminal image, not colored shadows or duplicated
DOM content.

### Phosphor glow/bloom

- Calculate luminance from nearby source samples.
- Apply a threshold so dark configured backgrounds do not bloom.
- Use a small fixed ring or cross of texture samples around the base coordinate.
- Add only a restrained fraction of the bright neighborhood to the base color.
- Keep the sample radius expressed in texels.
- Clamp output to a valid color range.
- Avoid a multi-resolution or separable-blur pipeline in the first version.

The intent is a small phosphor halo around bright glyphs and UI edges, not a cinematic bloom that
reduces text clarity.

### Color and alpha

- Supply `backgroundColor` as an explicit shader uniform.
- Process actual rendered xterm colors so ANSI colors and `foregroundColor` remain meaningful.
- Produce opaque output because the terminal stage already owns its configured background.
- Do not postprocess the monitor overlay.

## 10. Resolution and memory policy

The fixed logical stage may create a 5120×2880 WebGL drawable on a 2× display. One RGBA8 render
target at that size is approximately 56.25 MiB; at 2560×1440 it is approximately 14.06 MiB.

The first correctness implementation will use one full-resolution render target and no bloom
scratch textures. Before acceptance it must be profiled at 1× and 2× device pixel ratios.

If the full-resolution target fails the performance or memory gate, the allowed optimization is a
single bounded render target sized to the terminal's actual visible physical pixels, followed by
the final pass into the existing canvas. The optimization must preserve the fixed terminal grid
and must not add a second framebuffer, canvas, or renderer. Silent allocation downscaling is not
allowed; the chosen policy must be deterministic and tested.

The renderer must query `MAX_TEXTURE_SIZE`, check framebuffer completeness, and fall back before
showing a partial or black terminal.

## 11. Mouse and pointer coordinate mapping

Postprocessing changes where cells appear but does not change DOM hit testing. Without correction,
mouse-enabled TUIs and selection would become inaccurate near curved edges.

Phase 4.5 therefore requires one shared barrel-mapping module:

- The shader uses the destination-to-source mapping for pixels.
- A pure TypeScript implementation uses the same coefficients for pointer coordinates.
- Capture-phase mouse and pointer handling converts visible coordinates into source-terminal
  coordinates before xterm performs cell lookup.
- Coordinates outside the curved source boundary are ignored.
- Center coordinates remain unchanged.
- Monitor and stage scaling are resolved from the terminal element's current bounding rectangle,
  not from the 2560×1440 constants alone.

The implementation must cover mouse down, move, up, wheel, and any pointer events xterm consumes.
Synthetic forwarding must be marked to avoid recursive interception. Keyboard and IME input remain
unchanged.

If reliable event remapping cannot be implemented against xterm's supported event surface, barrel
distortion is blocked. Shipping visually curved output with knowingly incorrect mouse coordinates
is not acceptable.

## 12. Configuration behavior

No public configuration schema changes are planned.

| Configuration                      | Shader optics                 | CSS scanlines/noise | Monitor |
| ---------------------------------- | ----------------------------- | ------------------- | ------- |
| `crtEffects: true`, monitor on     | Enabled                       | Visible             | Visible |
| `crtEffects: true`, monitor off    | Enabled                       | Visible             | Hidden  |
| `crtEffects: false`, monitor on    | Direct WebGL rendering        | Host hidden         | Visible |
| `crtEffects: false`, monitor off   | Direct WebGL rendering        | Host hidden         | Hidden  |
| WebGL failure or context loss      | Unavailable; default renderer | Follows config      | Follows config |

`backgroundColor` supplies xterm's background, unused native-window space, render-target clears,
and out-of-bounds curved samples. `foregroundColor` continues through xterm's theme and therefore
participates naturally in channel separation and bloom.

### Reduced motion

Barrel distortion, chromatic aberration, and bloom are static and require no reduced-motion
variation. Scanlines remain stationary, and the existing media query continues to disable noise
animation while retaining its static appearance. Phase 4.5 must not introduce a shader clock or
continuous render loop.

## 13. Fallback and failure behavior

The terminal remains the product; optics are optional.

- Shader construction failure: dispose partial addon state and keep xterm's default renderer.
- Shader compilation or linking failure: same fallback.
- Unsupported texture size or incomplete framebuffer: same fallback.
- Addon activation failure: same fallback.
- WebGL context loss: dispose the subscription and addon exactly once; do not reload it.
- Default renderer lifetime: terminal text, process output, input, focus, and cleanup continue.
- CSS effects: remain controlled by `crtEffects` even when shader optics are unavailable.
- Diagnostics: development may log one concise renderer reason; production must not repeatedly
  report or retry.

No renderer-recovery loop, atlas reset call, or delayed WebGL reactivation is added.

## 14. Fork and dependency strategy

The postprocess hook belongs inside the renderer, but xterm does not expose that hook publicly.
The preferred delivery is a small Termweave fork of `@xterm/addon-webgl` based exactly on 0.19.0 /
upstream commit `f447274f430fd22513f6adbf9862d19524471c04`.

Before implementation begins, choose one reproducible delivery form:

1. A dedicated Termweave addon package pinned to an immutable package version and source commit.
2. A vendored, source-controlled addon fork with its upstream MIT license and deterministic build
   instructions, without a nested application package or second lockfile.

The implementation must not:

- Patch `node_modules` at runtime.
- Depend on mutable Git branches.
- Reach into stock addon's private fields.
- Commit only an unexplained minified bundle.
- Pull the full xterm repository during ordinary SDK install, development, or build.

Only the WebGL addon is forked. `@xterm/xterm` remains pinned and consumed through its ordinary
public terminal API.

## 15. Expected SDK integration

The application-facing integration should remain concentrated in the existing visual modules:

- `src/terminal.ts`: construct the enhanced addon, retain the small fallback, and own disposal.
- `src/presentation.ts`: continue applying config and expose any pure shared optics constants.
- `src/styles.css`: retain the vignette-free scanlines, noise, and reduced-motion rules.
- A small private CRT module: pure barrel math and pointer mapping.
- Focused tests under `tests/`: geometry, lifecycle, configuration combinations, and pointer mapping.

`src/main.ts`, raw sidecar transport, development lifecycle, shared public configuration, and
`#termweave` exports should not need architectural changes.

## 16. Implementation plan

- [ ] Commit and tag the completed Phase 4 baseline before renderer work begins.
- [ ] Select and document the immutable fork delivery method, upstream commit, license retention,
      and reproduction command.
- [ ] Add pure aspect-corrected barrel mapping and inverse pointer helpers with center, symmetry,
      boundary, and non-finite-input tests.
- [ ] Add the enhanced renderer's single RGBA8 target, framebuffer validation, explicit GL state,
      and idempotent partial-resource disposal.
- [ ] Add the one-pass barrel, radial RGB split, and restrained luminance-bloom shader with internal
      constants and no animation clock.
- [ ] Route xterm's existing rectangle/glyph/cursor rendering into the target and run the final
      pass into the same display canvas.
- [ ] Integrate `crtEffects`, `backgroundColor`, WebGL activation failure, and context-loss fallback
      through `src/terminal.ts` without changing the public config schema.
- [ ] Retain Phase 4's vignette-free CSS scanlines/noise, complete host hiding, and reduced-motion
      behavior.
- [ ] Add pointer-coordinate correction for selection and mouse-enabled terminal applications;
      block barrel release if edge-cell input remains inaccurate.
- [ ] Verify visual output, fallback, canvas count, resource lifetime, device-pixel-ratio changes,
      memory, and responsiveness across the complete acceptance matrix.
- [ ] Run `bun run check`, `bun run frontend:build`, native smoke tests, the exclusion audit, and
      `git diff -- sdk` before handoff.

## 17. Test and verification plan

### Pure unit tests

- Center maps exactly to center.
- Horizontal and vertical symmetry.
- Wide, tall, and exact 16:9 coordinate normalization.
- Edge strength remains within the documented bound.
- Out-of-source samples return the configured background.
- Zero-sized and non-finite inputs fail safely.
- RGB separation is zero at center and monotonic toward the edge.
- Pointer mapping matches the shader reference function within a defined tolerance.
- Curved-corner pointer input is rejected.

### Renderer lifecycle tests

- Normal shader/program/framebuffer construction.
- Vertex shader compilation failure.
- Fragment shader compilation failure.
- Program linking failure.
- Texture allocation failure.
- Framebuffer incompleteness.
- Addon activation failure after partial allocation.
- Context loss and exactly-once disposal.
- Repeated disposal.
- Drawable-size/device-pixel-ratio resource replacement without leaks.
- `crtEffects: false` bypass with no postprocess allocation.
- Continued xterm lifetime and input after fallback.

### DOM and topology tests

- No postprocessor canvas is added.
- The stock xterm canvas count is unchanged and only one WebGL context is requested.
- Monitor overlay remains one element and above the terminal.
- CRT host is completely hidden when disabled.
- Vignette, flicker, and sweep styles are absent.
- Reduced motion disables noise animation; scanlines are already stationary.

### Native visual matrix

Run every monitor/CRT combination at:

- 1536×864.
- 1200×900.
- 1920×800.
- 900×1200.
- Fullscreen.
- At least one 1× and one 2× device-pixel-ratio display mode where available.

For each applicable case verify:

- Terminal remains centered and uniformly scaled.
- Native letterbox/pillarbox space uses `backgroundColor`.
- Monitor geometry and 64 px maximum native inset behavior remain unchanged.
- Monitor art is not distorted or bloomed.
- Terminal center remains stable.
- Curvature is visible but restrained.
- RGB split is subtle and strongest near edges.
- Glow improves bright edges without reducing text legibility.
- Scanlines/noise remain low opacity.
- Pointer selection and mouse-enabled TUI cells align at center, edges, and corners.

### WebGL and fallback checks

- Confirm the enhanced WebGL renderer is active in the success case.
- Force shader/FBO failure through an injected test seam.
- Force `WEBGL_lose_context` and wait for the addon's context-loss path.
- Confirm the enhanced addon is disposed and not recreated.
- Confirm terminal output and input continue through xterm's default renderer.
- Confirm no black frame, duplicate canvas, or duplicate terminal process appears.

### Performance gate

- Exercise rapid terminal updates and an animated PixelRenderer route for at least ten minutes.
- Confirm keyboard input remains responsive.
- Confirm memory stabilizes after initial allocation and device-pixel-ratio changes.
- Confirm no render-target resources accumulate across resize/fullscreen transitions.
- Measure the 5120×2880 target on a 2× display.
- Reject a continuous postprocess loop when terminal contents are unchanged.
- If full resolution misses the gate, implement and re-test only the single-target visible-resolution
  policy described in section 10.

### Final exclusion audit

Search authored runtime code and report the absence of:

- An additional canvas or a second WebGL context.
- `readPixels` and preserved drawing buffers.
- Canvas/WebView/window snapshot paths.
- Postprocessor uploads of terminal-frame pixels.
- SVG displacement filters.
- Renderer handoff or recovery loops.
- Custom glyph-atlas reset logic.
- Mirrored surround images.
- Flicker, vertical sweep, vignette, audio, and video.

## 18. Acceptance criteria

Phase 4.5 is complete only when:

- Barrel distortion, chromatic aberration, and bloom render in the existing xterm canvas.
- The enhanced renderer adds no canvas; xterm retains one WebGL display canvas/context and its
  unchanged internal 2D canvases.
- The implementation uses one GPU-only render target and no CPU frame capture/readback.
- The monitor overlay remains single, sharp, and above the processed terminal.
- The complete CRT pool is scanlines, low-opacity noise, barrel distortion, chromatic aberration,
  and phosphor glow/bloom.
- Flicker, sweep, and vignette are absent.
- `crtEffects: false` hides CSS effects and bypasses shader optics.
- Reduced motion stops noise animation and does not affect stationary scanlines or static optics.
- Mouse-enabled applications and selection remain aligned after curvature.
- Shader/FBO failure and context loss leave a live default-renderer terminal.
- All Phase 4 geometry, flag combinations, colors, font, fullscreen behavior, and window-aspect tests
  continue to pass.
- The performance gate passes at the supported macOS display scale.
- `bun run check` and `bun run frontend:build` pass.
- `sdk/` remains untouched.

## 19. Rollback

Phase 4 is the rollback path. Reverting Phase 4.5 must require only:

- Restoring stock `@xterm/addon-webgl` 0.19.0 construction.
- Removing the private optics and pointer-mapping modules.

Raw transport, sidecar lifecycle, fixed-stage layout, monitor asset, font, configuration, and CSS
scanlines/noise must remain unaffected by that rollback.

## 20. References

- [xterm.js repository and WebGL addon](https://github.com/xtermjs/xterm.js/tree/f447274f430fd22513f6adbf9862d19524471c04/addons/addon-webgl)
- [Pinned WebGL addon API](https://github.com/xtermjs/xterm.js/blob/f447274f430fd22513f6adbf9862d19524471c04/addons/addon-webgl/typings/addon-webgl.d.ts)
- [Khronos: Handling WebGL context loss](https://www.khronos.org/webgl/wiki/HandlingContextLost)
- [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/)
- [Apple: WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)
- [Apple: NSView content filters](https://developer.apple.com/documentation/appkit/nsview/contentfilters)
- [Apple: CIWarpKernel](https://developer.apple.com/documentation/coreimage/ciwarpkernel)
- [Apple: CIBloom](https://developer.apple.com/documentation/coreimage/cibloom)
