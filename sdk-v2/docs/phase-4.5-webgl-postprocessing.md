# Phase 4.5 — Same-Canvas WebGL CRT Optics

**Status:** Implemented; native 1×/2× visual and sustained-performance acceptance pending
**Depends on:** Completed Phase 4 streamlined visuals
**Target:** SDK v2 on macOS WKWebView, with portable WebGL behavior where practical
**Document date:** 2026-08-03

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

- Keeps the stock pinned `@xterm/addon-webgl` 0.19.0 package unchanged.
- Reacquires the addon's existing WebGL2 context from its display canvas.
- Steers xterm rendering into a Termweave-owned texture-backed framebuffer.
- Keeps exactly one visible xterm WebGL canvas.
- Adds one GPU-resident render target and one final full-screen pass.
- Retains low-opacity CSS noise.
- Adds static barrel distortion, chromatic aberration, curved scanlines, and bloom when
  `crtEffects` is enabled.
- Preserves Phase 4's monitor geometry, colors, font, fixed grid, scaling, and fallback behavior.

Committed Phase 4 revision `3e1eb18` is the recorded rollback point. Phase 4.5 creates no tag,
commit, push, or dependency update implicitly.

## 3. Terminology and hard boundary

"Same-canvas postprocessing" means:

- No canvas element beyond the canvases the stock xterm renderer already creates.
- One WebGL display canvas and one WebGL2 context owned by the xterm renderer.
- One internal RGBA texture attached to one internal framebuffer.
- A final shader that writes to the original visible canvas.

Stock xterm also owns internal 2D link-layer and glyph-atlas canvases. Phase 4.5 does not remove,
duplicate, postprocess, or count those as a second WebGL display surface. The topology requirement
is that the postprocessor adds no canvas node and requests no additional WebGL context.

The internal framebuffer is a render destination, not a frame-capture subsystem. Terminal pixels
remain on the GPU for the complete frame. The implementation must not use:

- `readPixels`.
- `toDataURL`, `toBlob`, `drawImage`, or `ImageBitmap` frame copies.
- `preserveDrawingBuffer`.
- WebView or window snapshots.
- CPU-accessible frame buffers.
- A second display canvas or WebGL context.
- Postprocessor uploads of captured terminal frames.

The only permitted frame copy is a one-time, unscaled, GPU-only `blitFramebuffer` used to preserve
the current raw terminal image during an unexpected runtime failure handoff. It is never part of
the successful rendering path and does not read pixels into CPU memory.

The pinned xterm renderer continues managing its existing glyph atlas and the texture updates
needed to render newly encountered glyphs. Phase 4.5 adds no terminal-frame upload path.

If the project later defines "no framebuffer" to prohibit even a GPU-only render target, this
phase cannot provide a true full-image postprocessor. The fallback would be limited CSS and
glyph-local approximations, not the design in this document.

## 4. Goals

- Render subtle, recognizable CRT curvature without distracting from the TUI.
- Apply a small separable-axis RGB convergence error that is zero at the center and strongest near
  the edges.
- Add a restrained light halo around bright terminal content.
- Keep the monitor overlay sharp and undistorted above the processed terminal.
- Keep the configured background visible outside the curved sample boundary.
- Preserve the fixed 2560×1440 logical terminal and centered uniform scaling.
- Preserve terminal text, rendered selection, cursor, and keyboard input. This SDK application
  keeps mouse tracking disabled in its OpenTUI configuration.
- Dispose the postprocessor and stock WebGL addon on permanent context loss, then continue with
  xterm's default renderer.
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

### xterm WebGL API and pinned renderer behavior

The pinned `@xterm/addon-webgl` 0.19.0 package identifies upstream commit
`f447274f430fd22513f6adbf9862d19524471c04`. Its supported API exposes activation, disposal,
context loss, texture-atlas events, and atlas clearing. It does not expose the WebGL context,
render target, render callback, or a postprocess hook.

The stock addon does, however, append its WebGL canvas below the public `Terminal.element`.
Enumerating descendant canvases and calling `getContext('webgl2')` identifies exactly one existing
WebGL2 context; canvases that already own a 2D context return `null`. The pinned renderer also never
calls `bindFramebuffer`; its rectangle and glyph renderers draw into whichever framebuffer is
current. The pinned xterm render service calls the renderer and then synchronously fires the public
`Terminal.onRender` event.

Phase 4.5 deliberately uses those pinned implementation facts without reading runtime properties
such as `_renderer`, `_canvas`, or `_gl`, patching package files, or replacing the addon. This is a
controlled compatibility dependency, not a new xterm API guarantee. The exact package versions
remain pinned, upgrades require a renderer-compatibility audit, and runtime framebuffer checks
must fail safely if the assumptions do not hold.

## 7. Selected architecture

```text
OpenTUI output
     │
     ▼
xterm terminal model
     │
     ▼
stock @xterm/addon-webgl 0.19.0
     │
     ├── its existing WebGL2 context is reacquired from the display canvas
     └── rectangles, glyphs, selection, and cursor draw into the framebuffer
             already bound by the Termweave CRT postprocessor
     │
     ▼
public Terminal.onRender callback
     │
     ▼
one synchronous full-screen CRT pass
     ├── inverse barrel sampling
     ├── separable-axis RGB channel sampling
     ├── small luminance bloom
     └── source-mapped antialiased scanlines
     │
     ▼
the same visible xterm WebGL canvas
     │
     ├── low-opacity CSS noise
     └── one unprocessed monitor overlay above everything
```

The Termweave postprocessor binds its framebuffer before xterm's scheduled render. Because the
pinned addon does not change framebuffer bindings, xterm draws directly into the texture-backed
target. The final pass runs synchronously from `Terminal.onRender`, after the pinned render service
has called the addon's `renderRows` method and before the browser presents the default framebuffer.
It does not use a second `requestAnimationFrame`, preserved default-framebuffer contents, or a copy
from the default framebuffer.

### Layer order

The Phase 4 DOM order remains:

1. Terminal and its one WebGL display canvas.
2. CSS effects host containing one noise element.
3. Single monitor overlay.

Terminal pixels and the scanline mask use the same barrel-mapped source coordinates. The monitor
artwork is physical casing and must remain undistorted. Random noise remains a CSS compositor
overlay; it is intentionally not uploaded as a WebGL texture and does not require continuous xterm
redraws.

The 3000×1740 monitor artwork has measured center-edge aperture paddings of 268 px left, 278 px
right, 201 px top, and 159 px bottom, giving a 2454×1380 aperture centered at `(1495, 891)`. The
terminal uses the nearest larger integer 16:9 frame, 2464×1386, centered on that same point. Its
5 px horizontal and 3 px vertical overscan on each side sits behind the bezel, while the terminal
and measured aperture centers remain identical and artwork scaling stays uniform.

## 8. WebGL render pipeline

### Initialization

When `crtEffects` is enabled, activation will:

1. Construct and load the unchanged stock `WebglAddon` with `preserveDrawingBuffer: false`.
2. Locate the addon's WebGL display canvas below the public terminal element.
3. Reacquire the canvas's already-created WebGL2 context; no second context is requested.
4. Verify the pinned renderer compatibility assumptions before steering begins.
5. Compile and link one full-screen vertex shader and one CRT fragment shader.
6. Allocate one full-size RGBA8 2D texture and attach it to one framebuffer.
7. Verify texture-size limits, shader status, link status, and framebuffer completeness.
8. Create one full-screen triangle or quad vertex buffer and vertex-array state.
9. Clear both the texture-backed target and default display framebuffer to the configured
   background while preserving clear color, color mask, scissor state, and the previous
   draw-framebuffer binding. Initializing the sampled target prevents a transparent-black blank
   xterm frame from becoming an opaque black CRT aperture during the first presentation.
10. Subscribe to `Terminal.onRender`, canvas drawing-buffer dimension changes, and context events.
11. Bind the Termweave framebuffer before xterm's first scheduled render.

Initialization is transactional. Steering does not begin until all resources, subscriptions, and
compatibility checks are valid. Any failure disposes partial postprocessor and addon state, binds
the default framebuffer when possible, and continues with xterm's default renderer exactly as
Phase 4 does.

When `crtEffects` is disabled, the application loads the unchanged stock addon directly. It does
not locate or reacquire the context, allocate postprocessing resources, subscribe to presentation
events, or change framebuffer bindings.

### Steering invariant

While the postprocessor is active and xterm is not being presented, the Termweave framebuffer is
the current draw framebuffer. The pinned addon therefore renders directly into the attached
texture without knowing about the postprocessor.

At the start of every presentation callback, the implementation must verify that:

- The callback belongs to the currently active addon and postprocessor generation.
- The WebGL context is healthy.
- The target texture dimensions equal the canvas drawing-buffer dimensions.
- The current target generation was validated complete after its most recent allocation.
- `DRAW_FRAMEBUFFER_BINDING` is the expected Termweave framebuffer.

An invariant failure must not attempt a potentially invalid shader pass. It triggers the fail-safe
path described in section 13.

### Frame rendering

For each xterm render:

1. Enter xterm's scheduled render with the Termweave framebuffer already bound.
2. Let the unchanged addon render backgrounds, glyphs, selection, and cursor into the target.
3. Receive the synchronous `Terminal.onRender` callback after the addon's `renderRows` call.
4. Validate the steering invariant.
5. Save the WebGL state that the presentation pass will modify.
6. Bind the default framebuffer and set the visible canvas viewport.
7. Bind the internal texture and draw the final full-screen CRT pass.
8. Restore texture-unit, program, vertex-array, blend, viewport, and other modified state.
9. Rebind the Termweave framebuffer before returning to xterm or the browser event loop.

There is no copy from the default framebuffer. xterm renders directly into the texture-backed
framebuffer, and the final shader samples that texture once during presentation.

The presentation callback must be reentrancy-safe and enclosed in a fail-safe `try`/`finally`
boundary. It must not call `terminal.refresh` from the successful per-frame path, add another
`requestAnimationFrame`, or run continuously while terminal contents are unchanged.

### WebGL state ownership

Termweave owns its program, vertex-array state, buffer, texture, and framebuffer. It does not own
xterm's programs, buffers, texture units, glyph textures, blend state, or render model.

The postprocessor must save and restore every shared state value it changes. In particular, it
must restore the previous binding on any texture unit used for the source texture because the
pinned glyph renderer expects its atlas textures to remain bound between frames. The one deliberate
exception is the draw-framebuffer binding: the Termweave framebuffer must be current again when
the callback returns.

No `gl.finish`, `gl.flush`, fence, synchronous CPU readback, or per-frame resource allocation is
required.

### Drawable-size changes

The target must be resized before xterm draws at new canvas dimensions. The implementation will
observe the WebGL canvas's drawing-buffer `width` and `height` attributes, not only its CSS box.
When either dimension changes while the context is healthy, it will:

1. Mark presentation temporarily unavailable.
2. Reallocate the one target texture to the exact new drawing-buffer size.
3. Reattach and validate the framebuffer.
4. Restore the steering binding before xterm's scheduled redraw.
5. Resume presentation only after the complete storage reallocation succeeds.

The observer and xterm's device-pixel resize scheduling must be verified in WKWebView. If Termweave
cannot guarantee that the resized target is bound before xterm draws, it must stop steering and
fall back rather than present a clipped, stale, or partial frame.

### Resource lifetime

The postprocessor owns and deletes:

- CRT program and shaders.
- Full-screen vertex buffer and vertex-array state.
- Render-target texture.
- Render-target framebuffer.

It also owns its `Terminal.onRender`, dimension-observer, and canvas-context subscriptions.
Disposal must be idempotent and safe after partial initialization.

Drawable-size/device-pixel-ratio changes reuse the existing texture and framebuffer objects while
reallocating the texture's storage to the exact new drawing-buffer size. The complete WebGL
resource set is recreated only after a successful context restoration while the addon remains
active. It is not recreated after the addon's permanent context-loss notification; the
postprocessor and addon are disposed and xterm's default renderer remains active.

## 9. CRT shader design

The first version uses one fragment pass and one source texture. It must remain intentionally
subtle and expose constants internally rather than adding configuration fields.

### Barrel distortion

- Convert destination UV coordinates into centered, aspect-corrected coordinates.
- Calculate radius squared from the centered position.
- Map the destination position to its source position with a low-strength radial polynomial.
- Keep the exact center invariant.
- Maintain exact horizontal symmetry.
- Normalize the horizontal and vertical axes so terminal content reaches all four cardinal edges
  while the corners remain outside the curved aperture.
- Apply the accepted aesthetic edge tuning: scale the horizontal contribution to top/bottom
  curvature by `0.82`, then interpolate an additional multiplier from `1.0` at the center to `0.6`
  at the lower edge. This intentionally makes the lower curve slightly flatter than the upper
  curve.
- Return `backgroundColor` when the source coordinate falls outside the terminal texture.
- Avoid hard-coded monitor-artwork coordinates; distortion is normalized to the terminal surface.

The source-mapping function used by the shader must have a matching pure TypeScript reference for
unit tests.

### Physical calibration

The private optics module records the calibration constants rather than exposing new public
configuration:

- The reference display is the Philips 28PW6006: an inexpensive mass-market 50 Hz consumer
  widescreen CRT rather than a rare broadcast monitor. The set has a nominal 28-inch tube and a
  66 cm visible 16:9 picture. The references are the
  [Philips user manual](https://manualzilla.com/doc/6995958/philips-28pw6006-25-user-s-manual)
  and a [period retail listing](https://forums.moneysavingexpert.com/discussion/13783/e-u-philips-28pw6006-tv-189-99-somerfield-instore).
- All sampling distances are authored in the emulated 240-line raster, not in the host display's
  1440p logical pixels. The 660 mm diagonal gives a 575.240 × 323.572 mm picture, so one raster
  pixel is `323.572 mm / 240 = 1.348218 mm`; the corresponding square-pixel 16:9 raster is
  approximately 426.667 × 240.
- The tube model starts from an older spherical "1R" geometry with curvature radius approximately
  1.7 times the nominal screen radius: `R = 604.52 mm`. The historical aspect-correct radial
  coefficient is `k = 0.01386136580657748`; an aperture-fit gain of `2` gives the rendered
  coefficient `k = 0.02772273161315496`. Per-axis aperture normalization preserves exact cardinal
  edge coverage; the `0.82` shared top/bottom factor and lower-edge interpolation to `0.6` are
  visual-fit coefficients rather than physical measurements. They use normalized terminal
  coordinates and no monitor-artwork coordinates. The base coefficient is an inference from the
  historical spherical panel geometry described in
  [US5962964A](https://patents.google.com/patent/US5962964A/en).
- Consumer service documentation provides convergence controls but no defensible millimetre
  tolerance for this set. The shader therefore uses an explicitly aesthetic aged-set target of
  one-half 240p raster line of red-to-blue separation at each cardinal edge. This is
  `0.5 × 1.348218 = 0.674109 mm`, or `±0.25` raster pixels per shifted channel around green.
  It is intentionally much more visible than the former 0.24 mm professional-monitor target.
- Bloom uses a conservative 1.0 mm consumer CRT beam-spot diameter from the lower end of the
  documented 1–2 mm range. Sampling uses its 0.5 mm radius, equivalent to
  `0.37085979294314786` raster pixels. Four cardinal neighbors use a normalized Gaussian weight
  of `0.05` each, with a bright-pass threshold of `max(0.5, backgroundLuminance + 0.1)`. The
  reference is [ITU-R BT.2042-4](https://www.itu.int/dms_pub/itu-r/opb/rep/R-REP-BT.2042-4-2010-PDF-E.pdf).

The shader converts those raster-space distances to normalized source-texture distances. At a
1440-line output the six-times scale makes each shifted channel offset `±1.5` output pixels at a
cardinal edge, for exactly 3 output pixels from red to blue. The bloom sample radius is approximately
2.225 output pixels. The separable X/Y convergence components combine to approximately 4.243 pixels
of vector separation at an extreme corner; 3 pixels is the per-axis cardinal-edge value. Changing
host resolution changes output-pixel scale without changing the simulated CRT-space proportions.
The optics remain static and use no clock, flicker, sweep, vignette, or continuous redraw.
The opaque, full-range grayscale noise texture produces approximately `0.1331` RMS modulation at
full opacity when soft-light blended over mid-grey. Its fixed `0.025` visibility therefore produces
approximately `0.00333` RMS modulation, equivalent to a full-scale S/N of `49.6 dB`. This sits near
the 49 dB quality floor in [ITU-T J.62](https://www.itu.int/rec/T-REC-J.62) while keeping noise
restrained for a clean consumer CRT signal. The visibility maps directly to layer opacity without
an additional calibration multiplier; the blend calculation follows
[W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/#blendingsoftlight).

### Chromatic aberration

- Barrel-map the destination once and calculate channel separation from that shared source
  position.
- Use zero separation at the exact center.
- Increase each source-axis component gradually toward its corresponding edge. Keep the components
  separable instead of normalizing a radial vector: Y separation must remain constant along a
  horizontal source line, and X separation must remain constant along a vertical source line.
- Shift red and blue around the shared source coordinate. Do not shift destination coordinates:
  that translates the completed curved image and can make its colored copies cross the original
  curve instead of inheriting it.
- Express source offsets in 240p raster pixels and convert them to normalized source-texture
  distances so the simulated CRT proportions remain stable across output sizes.
- Clamp strength to a subpixel or low-single-pixel range at the visible edge.
- Blend the reconstructed shifted channels with the unshifted center sample using one fixed `0.45`
  visibility value, then output alpha `1.0`. Do not add separate per-channel or CSS opacity.
- Apply no temporal animation.

This is real channel sampling of the completed terminal image, not colored shadows or duplicated
DOM content.

### Scanlines

- Derive the raster phase from barrel-mapped `sourceUv.y`, never from the straight destination or
  a CSS overlay.
- Use a one-pixel pitch in the 240-line source raster. At the fixed 1440 px logical height this
  becomes one 3 px active raster position followed by one 3 px dark position.
- Darken the inactive half by `0.15`.
- Antialias both periodic transitions with fragment derivatives so stage scaling does not create
  avoidable shimmer or moire.
- Apply the mask in the existing final shader pass with no texture, framebuffer, or render-loop
  addition.

### Phosphor glow/bloom

- Calculate luminance from nearby source samples.
- Apply a threshold so dark configured backgrounds do not bloom.
- Use a small fixed ring or cross of texture samples around the base coordinate.
- Add only a restrained fraction of the bright neighborhood to the base color.
- Keep the sample radius expressed in 240p raster pixels and convert it to source-texture distance.
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

The implementation uses one full-resolution render target and no bloom scratch textures. Stock
xterm calculates its viewport, projection, glyph metrics, and render dimensions from the display
canvas. FBO steering therefore cannot silently substitute a smaller target without changing addon
behavior or clipping the frame.

Before acceptance, the full-resolution target must be profiled at 1× and 2× device pixel ratios.
If it fails the performance or memory gate, Phase 4.5 is blocked on this architecture and falls
back to Phase 4. It must not add a same-context copy/downsample pass, second framebuffer, second
canvas, or implicit resolution reduction as an optimization.

The postprocessor must query `MAX_TEXTURE_SIZE`, check framebuffer completeness, and fall back
before showing a partial or black terminal.

## 11. Mouse input policy

The SDK v2 application explicitly configures OpenTUI with `useMouse: false` and
`enableMouseMovement: false`; Phase 4 also blocks xterm wheel handling. Phase 4.5 therefore adds no
capture listeners, coordinate remapping, or synthetic mouse events. Keyboard and IME input remain
unchanged.

Mouse-enabled TUIs and curvature-aware xterm selection are outside this phase's application
contract. If mouse input is enabled in a later phase, destination-to-source event correction must
be designed and accepted before that feature ships.

## 12. Configuration behavior

No public configuration schema changes are planned.

| Configuration                      | WebGL path                         | Shader scanlines | CSS noise      | Monitor        |
| ---------------------------------- | ---------------------------------- | ---------------- | -------------- | -------------- |
| `crtEffects: true`, monitor on     | Steered FBO plus shader pass       | Visible          | Visible        | Visible        |
| `crtEffects: true`, monitor off    | Steered FBO plus shader pass       | Visible          | Visible        | Hidden         |
| `crtEffects: false`, monitor on    | Unchanged direct stock addon       | Bypassed         | Host hidden    | Visible        |
| `crtEffects: false`, monitor off   | Unchanged direct stock addon       | Bypassed         | Host hidden    | Hidden         |
| WebGL failure or context loss      | Unavailable; default renderer      | Unavailable      | Follows config | Follows config |

`backgroundColor` supplies xterm's background, unused native-window space, initial and replacement
display-framebuffer clears, the WebGL canvas's CSS background while the postprocessor owns it, and
out-of-bounds curved samples. The CSS background remains visible if the browser discards the
non-preserved drawing buffer between presentations; the prior inline canvas background is restored
on disposal. `foregroundColor` continues through xterm's theme and therefore participates naturally
in channel separation and bloom.

### Reduced motion

Barrel distortion, chromatic aberration, scanlines, and bloom are static and require no
reduced-motion variation. The existing media query continues to disable noise animation while
retaining its static appearance. Phase 4.5 must not introduce a shader clock or continuous render
loop.

## 13. Fallback and failure behavior

The terminal remains the product; optics are optional.

- Canvas/context discovery failure: do not begin steering; dispose the addon and keep xterm's
  default renderer.
- Shader construction, compilation, or linking failure: same fallback.
- Unsupported texture size or incomplete framebuffer: same fallback.
- Addon activation failure: same fallback.
- Steering invariant failure before presentation: do not run the CRT shader. If the default
  framebuffer contains the current raw xterm frame, leave it visible; otherwise use the emergency
  raw presentation path before disabling steering.
- Presentation failure after xterm rendered into the target: bind the target as the read
  framebuffer and the canvas as the draw framebuffer, then use one unscaled `blitFramebuffer` to
  preserve the current undistorted terminal frame when the context is healthy. This is a failure
  handoff, not a normal frame-copy pipeline.
- Failure-handoff completion: unbind the Termweave framebuffer, dispose the postprocessor and
  addon exactly once, and request one full redraw through xterm's default renderer.
- Temporary WebGL context loss: mark postprocessing unavailable and create no replacement resources
  until the context is restored.
- Successful context restoration: recreate, validate, and bind Termweave resources after the stock
  addon recreates its state and before its requested redraw.
- Permanent addon context-loss notification: dispose all subscriptions, the postprocessor, and the
  addon exactly once; do not reload it.
- Default renderer lifetime: terminal text, process output, input, focus, and cleanup continue.
- CSS noise remains controlled by `crtEffects` even when shader optics are unavailable.
- Diagnostics: development may log one concise renderer reason; production must not repeatedly
  report or retry.

The emergency blit is permitted only after an unexpected runtime steering/presentation failure. It
must never occur during a successful frame and must be counted in tests. No renderer-recovery loop,
atlas reset call, delayed WebGL reactivation, or switch to a same-context copy renderer is added.

## 14. Stock-addon compatibility and dependency strategy

Phase 4.5 continues consuming the unchanged published packages:

- `@xterm/addon-webgl` 0.19.0, based on upstream commit
  `f447274f430fd22513f6adbf9862d19524471c04`.
- `@xterm/xterm` 6.0.0.

The lockfile remains the reproducible delivery mechanism. No additional renderer dependency or
package is introduced.

Before implementation and before every future xterm upgrade, verify against the exact installed
source that:

1. The addon creates one WebGL2 canvas with `preserveDrawingBuffer: false`.
2. Its normal render path does not call `bindFramebuffer` or otherwise select a render target.
3. Backgrounds, glyphs, selection, and cursor render before `Terminal.onRender` fires.
4. Its draw path restores or explicitly selects the program, VAO, buffers, and viewport it needs
   after the Termweave presentation callback.
5. Reacquiring `webgl2` from the discovered display canvas returns the existing context.
6. Context restoration scheduling leaves a point where Termweave can recreate and bind its target
   before the next xterm redraw.

These checks should be represented by focused source-contract and runtime integration tests where
practical. The runtime framebuffer-binding guard remains required even when the source audit passes.

The implementation must not:

- Patch `node_modules` at runtime.
- Fork, vendor, rebuild, or republish `@xterm/addon-webgl`.
- Depend on mutable Git branches.
- Reach into stock addon's private fields.
- Import xterm's private source modules.
- Monkey-patch `HTMLCanvasElement`, `WebGL2RenderingContext`, or animation-frame globals.
- Pull the full xterm repository during ordinary SDK install, development, or build.

## 15. Expected SDK integration

The application-facing integration should remain concentrated in the existing visual modules:

- `src/terminal.ts`: construct the stock addon, coordinate postprocessor activation, retain the
  small fallback, and own exactly-once disposal.
- `src/presentation.ts`: continue applying config and expose any pure shared optics constants.
- `src/styles.css`: retain vignette-free noise and reduced-motion rules; do not draw scanlines in
  CSS.
- A private CRT postprocessor module: canvas/context discovery, FBO steering, shader presentation,
  dimension observation, state restoration, emergency handoff, and resource disposal.
- A small private optics module: calibrated pure barrel and scanline math shared with the shader.
- Focused tests under `tests/`: geometry, lifecycle, configuration combinations, and the disabled
  mouse-input contract.

`src/main.ts`, raw sidecar transport, development lifecycle, shared public configuration, and
`#termweave` exports should not need architectural changes.

## 16. Implementation plan

- [x] Record committed Phase 4 revision `3e1eb18` as the rollback point without creating a tag.
- [x] Record the exact stock-addon compatibility contract and add an upgrade audit for framebuffer
      binding, render-event order, canvas discovery, and context restoration.
- [x] Add pure aspect-corrected barrel mapping with center, horizontal symmetry, tuned lower-edge
      asymmetry, boundary, and non-finite-input tests.
- [x] Add the postprocessor's single RGBA8 target, framebuffer validation, explicit GL-state
      restoration, dimension observation, and idempotent partial-resource disposal.
- [x] Add the one-pass barrel, separable-axis RGB split, curved antialiased scanlines, and restrained
      luminance-bloom shader with internal constants and no animation clock.
- [x] Reacquire the stock addon's existing context, bind the target before xterm rendering, and run
      the final pass synchronously from `Terminal.onRender` into the same display canvas.
- [x] Add invariant guards and the one-time emergency raw-frame blit for unexpected runtime failure.
- [x] Integrate `crtEffects`, `backgroundColor`, WebGL activation failure, and context-loss fallback
      through `src/terminal.ts` without changing the public config schema.
- [x] Retain Phase 4's vignette-free CSS noise, complete host hiding, and reduced-motion behavior;
      remove the straight CSS scanline layer.
- [x] Verify that the application keeps OpenTUI mouse tracking disabled and that the postprocessor
      installs no mouse-event interception.
- [ ] Verify visual output, fallback, canvas count, resource lifetime, device-pixel-ratio changes,
      memory, and responsiveness across the complete acceptance matrix.
- [x] Run `bun run check`, `bun run frontend:build`, the exclusion audit, and `git diff -- sdk`.
- [ ] Run the native smoke matrix and sustained full-resolution gate on real 1× and 2× displays.

Native verification progress on 2026-08-03: a macOS WKWebView development smoke on the available
1920×1080, backing-scale `1.0` display successfully compiled and presented the same-canvas shader
in both windowed and fullscreen states. The monitor overlay, curved scanlines, consumer-calibrated
RGB split and bloom, heavy-line RGB edge-test screen, and centered counter remained visible without
a fallback diagnostic. Synthetic Right Arrow input reached the application and changed the counter.
This host exposes no 2× display mode, so the remaining fixed-size matrix, forced native fallbacks,
real 2×/5120×2880 coverage, and sustained performance/resource gate remain pending.

## 17. Test and verification plan

### Pure unit tests

- Center maps exactly to center.
- Horizontal symmetry and the documented lower-edge asymmetry.
- Wide, tall, and exact 16:9 coordinate normalization.
- Exact cardinal-edge coverage with curved out-of-source corners.
- Out-of-source samples return the configured background.
- Zero-sized and non-finite inputs fail safely.
- RGB separation is zero at center and monotonic toward the edge.

### Renderer lifecycle tests

- Display-canvas discovery and reacquisition of the already-created WebGL2 context.
- Compatibility failure when the display canvas or existing context cannot be identified.
- Normal shader/program/framebuffer construction.
- Vertex shader compilation failure.
- Fragment shader compilation failure.
- Program linking failure.
- Texture allocation failure.
- Framebuffer incompleteness.
- Every transactional construction failure deletes the exact partial resource set, restores shared
  GL state and the canvas background, and removes any observer, render, or context subscription
  already installed.
- Addon activation failure after partial allocation.
- Target framebuffer is bound before the first and every subsequent xterm render.
- Before the first terminal render, both the sampled target and default display framebuffer are
  cleared to the configured background with prior clear color, color mask, scissor state, and
  binding restored.
- `Terminal.onRender` presents only after xterm has drawn into the target.
- Modified programs, VAOs, texture units, atlas bindings, blend state, and viewport are restored.
- Unexpected draw-framebuffer binding triggers fallback rather than shader presentation.
- Drawing-buffer dimension changes reallocate target storage and bind it before xterm's redraw.
- Drawing-buffer resize and context restoration clear the replacement display surface to the
  configured background before redraw.
- Resize allocation or framebuffer-completeness failure stops presentation and disposes the
  existing resource set without an invalid emergency blit.
- Temporary context loss suspends presentation without allocating resources.
- Successful context restoration recreates and rebinds resources before redraw.
- Failed context restoration deletes its partial replacement generation before fallback.
- Permanent context loss and exactly-once disposal.
- Emergency raw-frame blit occurs once on an injected runtime presentation failure and never on a
  successful frame.
- Repeated disposal.
- Repeated drawable-size/device-pixel-ratio storage reallocations without resource leaks.
- `crtEffects: false` bypass with no postprocess allocation.
- Continued xterm lifetime and input after fallback.

### DOM and topology tests

- No postprocessor canvas is added.
- The stock xterm canvas count is unchanged and only one WebGL context is requested.
- Monitor overlay remains one element and above the terminal.
- CRT host is completely hidden when disabled.
- Vignette, flicker, and sweep styles are absent.
- Reduced motion disables noise animation; shader scanlines are already stationary.

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
- Curved scanlines and noise remain visually restrained.
- Mouse tracking remains disabled and no postprocessor input listeners are installed.

### WebGL and fallback checks

- Confirm the published stock addon remains installed and unmodified.
- Confirm the Termweave framebuffer is active during xterm rendering in the success case.
- Confirm the final pass runs synchronously from `Terminal.onRender` without another animation frame.
- Force shader/FBO failure through an injected test seam.
- Force a steering-binding mismatch and confirm the shader does not run.
- Force a runtime presentation failure and confirm one emergency raw blit prevents a black frame.
- Force `WEBGL_lose_context` and wait for the addon's context-loss path.
- Confirm the postprocessor and stock addon are disposed and not recreated after permanent loss.
- Confirm terminal output and input continue through xterm's default renderer.
- Confirm no black frame, duplicate canvas, or duplicate terminal process appears.

### Performance gate

- Exercise rapid terminal updates and an animated PixelRenderer route for at least ten minutes.
- Confirm keyboard input remains responsive.
- Confirm memory stabilizes after initial allocation and device-pixel-ratio changes.
- Confirm no render-target resources accumulate across resize/fullscreen transitions.
- Measure the 5120×2880 target on a 2× display.
- Reject a continuous postprocess loop when terminal contents are unchanged.
- If full resolution misses the gate, reject Phase 4.5 on this architecture and retain Phase 4.

### Final exclusion audit

Search authored runtime code and report the absence of:

- An additional canvas or a second WebGL context.
- `readPixels` and preserved drawing buffers.
- Canvas/WebView/window snapshot paths.
- Postprocessor uploads of terminal-frame pixels.
- Normal-frame `copyTexImage2D`, `copyTexSubImage2D`, `drawImage`, or `blitFramebuffer` calls; the
  only permitted framebuffer blit is the explicit one-time runtime failure handoff.
- SVG displacement filters.
- Continuous renderer-handoff or recovery loops.
- A forked, vendored, rebuilt, patched, or privately imported xterm addon.
- Custom glyph-atlas reset logic.
- Mirrored surround images.
- Flicker, vertical sweep, vignette, audio, and video.

## 18. Acceptance criteria

Phase 4.5 is complete only when:

- Barrel distortion, chromatic aberration, and bloom render in the existing xterm canvas.
- The published stock addon remains unchanged and consumes the same locked package version.
- The postprocessor adds no canvas; xterm retains one WebGL display canvas/context and its unchanged
  internal 2D canvases.
- The implementation uses one GPU-only render target and no CPU frame capture/readback.
- The target framebuffer is bound while xterm renders, and the successful frame path performs no
  copy from the default framebuffer.
- The final shader pass runs synchronously from `Terminal.onRender` and rebinds the target before
  returning.
- Drawing-buffer size changes bind a complete resized target, and successful context restoration
  binds a complete recreated target, before xterm redraws.
- A violated steering invariant fails safely without presenting a partial or black terminal.
- The monitor overlay remains single, sharp, and above the processed terminal.
- The complete CRT pool is curved scanlines, low-opacity noise, barrel distortion, chromatic
  aberration, and phosphor glow/bloom.
- Flicker, sweep, and vignette are absent.
- `crtEffects: false` hides CSS noise and bypasses shader optics, including scanlines.
- Reduced motion stops noise animation and does not affect stationary scanlines or static optics.
- The existing no-mouse application contract remains in force without synthetic input forwarding.
- Shader/FBO failure and context loss leave a live default-renderer terminal.
- All Phase 4 geometry, flag combinations, colors, font, fullscreen behavior, and window-aspect tests
  continue to pass.
- The performance gate passes at the supported macOS display scale.
- `bun run check` and `bun run frontend:build` pass.
- `sdk/` remains untouched.

## 19. Rollback

Phase 4 is the rollback path. Reverting Phase 4.5 must require only:

- Removing the CRT postprocessor activation and returning `src/terminal.ts` to Phase 4's direct
  stock-addon lifecycle.
- Removing the private postprocessor and optics modules.

No dependency or vendored renderer rollback is needed because Phase 4.5 never replaces or modifies
the stock addon.

Raw transport, sidecar lifecycle, fixed-stage layout, monitor asset, font, configuration, and CSS
noise must remain unaffected by that rollback.

## 20. References

- [xterm.js repository and WebGL addon](https://github.com/xtermjs/xterm.js/tree/f447274f430fd22513f6adbf9862d19524471c04/addons/addon-webgl)
- [Pinned WebGL addon API](https://github.com/xtermjs/xterm.js/blob/f447274f430fd22513f6adbf9862d19524471c04/addons/addon-webgl/typings/addon-webgl.d.ts)
- [Pinned WebGL renderer source](https://github.com/xtermjs/xterm.js/blob/f447274f430fd22513f6adbf9862d19524471c04/addons/addon-webgl/src/WebglRenderer.ts)
- [Pinned xterm render service](https://github.com/xtermjs/xterm.js/blob/f447274f430fd22513f6adbf9862d19524471c04/src/browser/services/RenderService.ts)
- [Khronos: Handling WebGL context loss](https://www.khronos.org/webgl/wiki/HandlingContextLost)
- [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/)
- [Apple: WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)
- [Apple: NSView content filters](https://developer.apple.com/documentation/appkit/nsview/contentfilters)
- [Apple: CIWarpKernel](https://developer.apple.com/documentation/coreimage/ciwarpkernel)
- [Apple: CIBloom](https://developer.apple.com/documentation/coreimage/cibloom)
