Implement Phase 6.5 of the Termweave SDK v2 migration: global application state and configurable
native screen navigation.

Start by reading sdk-v2/docs/migration-plan.md completely and inspecting the finished Phase 6
implementation and tests. Preserve the current production fixes:

- The dedicated /dev/fd/0 OpenTUI input stream.
- Runtime DEBUG suppression without constant-folding process.env.DEBUG.
- The packaged OpenTUI native library and OTUI_ASSET_ROOT handling.
- GIF/PNG/plain-screen lifecycle and input reliability.
- The absence of @solidjs/router, package patches, browser history, URLs, adapters, and compatibility
  layers.

Do not install dependencies. Keep sdk/, package.json, and bun.lock unchanged.

## Goal

Turn the current App-local screen switcher into a small reusable Solid-native state router:

- Store the active screen in a global Solid application store.
- Export a typed navigate() function that any screen or nested component can import.
- Let App.tsx react to the global screen() accessor and render the selected component.
- Replace hard-coded cyclic navigation logic with a user-editable, typed keyboard-binding table.
- Require every navigation from one screen to another to be explicitly configured by the template
  user. Do not invent fallback cycling or implicit navigation.

This remains an in-process screen router. It has no browser URL, history, back stack, route loading,
preloading, nested routing, parameters, redirects, or persistence.

## Required architecture

Keep screen identifiers in a dependency-free module:

  HOME_SCREEN = '/'
  GALLERY_SCREEN = '/gallery'
  PLAIN_SCREEN = '/plain'

  ScreenId = '/' | '/gallery' | '/plain'

Add a global application store using native Solid primitives. Its public interface must include:

  screen: Accessor<ScreenId>
  navigate(destination: ScreenId): void

The raw setScreen setter must remain private. Export navigate() directly so any screen component can
use:

  import { navigate } from '../app-store'

The store should initialize to HOME_SCREEN. Do not use context, a provider, a state-management
dependency, localStorage, or a global event emitter.

App.tsx must:

- Own no duplicate active-screen signal.
- Read the global screen() accessor.
- Keep exactly one stable App-level useKeyboard registration.
- Resolve keyboard navigation using the active screen and the configured binding table.
- Call preventDefault() only when a navigation binding matches.
- Call the exported navigate() function.
- Render exactly one component from a typed screen registry.
- Ensure changing component identity disposes the old Solid owner and mounts a fresh destination
  owner.

A small typed registry is now appropriate:

  Record<ScreenId, Component>

Use OpenTUI-compatible Solid Dynamic rendering, or another ordinary Solid mechanism that is proven
by tests to dispose the previous component. Do not build a Router component.

Avoid circular imports:

- screen-state.ts owns identifiers and ScreenId.
- app-store.ts owns screen() and navigate().
- screen-registry.ts owns the ScreenId-to-component mapping.
- navigation.ts owns binding types, configuration, validation, and matching.
- Screens may import navigate() from app-store.ts.
- app-store.ts must not import screen components or the registry.

## User-configurable keyboard navigation

Create one obvious user-editable navigation table. Each entry represents one directed transition:

  {
    from: HOME_SCREEN,
    to: GALLERY_SCREEN,
    key: { name: 'down' }
  }

The key descriptor must support:

- name
- ctrl
- shift
- meta
- option
- super
- hyper
- An optional exact sequence only if it is materially useful.

Omitted modifiers mean false, not “any modifier.”

The default configuration must preserve the current behavior:

- Home + Down → Gallery
- Home + Up → Plain
- Gallery + Up → Home
- Gallery + Down → Plain
- Plain + Up → Gallery
- Plain + Down → Home

Do not derive these transitions from array order. Each directed transition must appear explicitly so
the user can assign a different key without editing App.tsx, the store, or screen components.

Add validation that rejects:

- Unknown screen identifiers through TypeScript.
- Self-navigation entries.
- Missing directed transitions between distinct registered screens.
- More than one entry for the same source/destination pair.
- Duplicate key chords on the same source screen.
- Invalid or empty key names.

The same key may be reused on different source screens.

There must be no implicit Tab navigation. A user may explicitly configure Tab, printable keys, or
Left/Right, but that decision must be visible in the table. Unconfigured keys must remain owned by
the focused OpenTUI input.

If a configured key overlaps ScreenControls’ local Left/Right handling, navigation must win and the
local counter must not also change. Reuse the pure navigation matcher in ScreenControls if needed
to enforce this ownership.

## Lifecycle requirements

Preserve all Phase 6 behavior:

- Home owns the animated GIF PixelRenderer.
- Gallery owns the PNG PixelRenderer.
- Plain has no PixelRenderer import or instance.
- Screen-local counter, input value, ref, and focus reset after disposal.
- Navigating to the already-active screen is a signal no-op and must not remount it.
- Leaving Home stops GIF playback and prevents stale draws.
- Leaving Gallery destroys its native renderer.
- Plain produces no native pixel draws.
- The App-level keyboard listener never remounts.
- Every newly mounted screen focuses its input without timers or retries.
- Decode errors remain local to their PixelRenderer.

Do not add screen caching or retain inactive component owners.

## Tests

Update and add tests for:

1. Global store

- screen() initially returns HOME_SCREEN.
- navigate() updates the global accessor synchronously.
- Calling navigate() with the active ScreenId is a no-op.
- Tests restore HOME_SCREEN before and after using the singleton store.

2. Screen registry

- It contains exactly one component for every ScreenId.
- App renders the component selected by the global screen().
- Calling the exported navigate() while App is mounted changes the rendered screen.
- Old inputs/renderables are destroyed and destination inputs are focused.

3. Binding configuration

- All six directed transitions are explicitly present.
- Every configured key resolves only from its configured source.
- The same key may resolve differently on different screens.
- Modified keys do not match an unmodified binding.
- Duplicate source/key chords are rejected.
- Duplicate and missing directed transitions are rejected.
- Tab and ordinary characters do nothing unless explicitly configured.

4. Component behavior

- Exercise all configured transitions through raw CSI/SS3 stdin bytes.
- Repeat complete three-screen traversal at least 50 times.
- Confirm the App keypress-listener count remains stable.
- Confirm local input and counter state reset after leaving and returning.
- Confirm focus after every transition.
- Confirm configured navigation keys do not also update the local counter or input.
- Confirm unconfigured ordinary typing still reaches the input.
- Confirm direct navigate() calls from nested/component-level code work.

5. Media lifecycle

- Verify GIF → PNG → Plain and every reverse/direct transition.
- Confirm no Home or Gallery native draws occur while Plain is active.
- Confirm returning to Home starts one fresh GIF animation.
- Confirm timers and native draws do not multiply after repeated navigation.
- Preserve decode-error isolation and child-overlay ordering tests.

6. Production path

- Preserve the real sidecar/xterm stdin integration.
- Drive navigation according to the exported binding configuration rather than duplicating hidden
  navigation rules in tests.
- Preserve the compiled-production-sidecar startup regression.
- Manually verify configured transitions through the packaged Tauri/xterm application.

Do not construct KeyEvent directly for raw-input integration tests.

## Documentation

Add a Phase 6.5 section to migration-plan.md titled:

  Phase 6.5 — Global screen store and configurable navigation

Update documentation that currently says App owns the active-screen signal. Explain:

- The module-level Solid store owns screen().
- navigate() is the only public mutation function.
- Any screen or nested component may import navigate().
- App renders from the typed screen registry.
- The explicit binding table is the only keyboard-navigation configuration point.
- Keyboard mappings are in-process screen transitions, not URL routes or history.
- Printable keys and Tab remain input-owned unless the user deliberately binds them.

Add this Phase 6.5 prompt to migration-prompts.md.

## Validation

Run:

- bun run test
- bun run typecheck
- bun run lint
- bun run format:check
- bun run check
- bun run build

Inspect the generated production bundle and confirm the packaged OpenTUI native library remains
present. Do not regress the production-sidecar startup test.

Finish by confirming:

- All configured directed transitions work.
- Direct calls to navigate() work while App is mounted.
- Screen disposal, focus, typing, counters, and media cleanup remain correct.
- sdk/, package.json, and bun.lock are unchanged.
- No router dependency, history implementation, context provider, package patch, preload system,
  or compatibility layer was added.