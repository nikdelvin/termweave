# Phase 6.5 — Global screen store and simple navigation

Phase 6.5 turns the App-local switcher into a reusable global screen selection API without adding
a router or a keybinding framework.

## Template interface

`app/screens.ts` is the only screen-registration file. A template user imports screen components
there and adds them to one object:

```ts
export const screens = {
  '/': HomeScreen,
  '/gallery': GalleryScreen,
  '/plain': PlainScreen,
}

export type ScreenKey = keyof typeof screens
```

The application store exposes:

```ts
screen: Accessor<ScreenKey>
navigate(destination: ScreenKey): void
```

The Solid setter stays private. The store begins at `/`, updates synchronously, and relies on
Solid's normal equality behavior so navigating to the active screen does not remount it.

## Keyboard ownership

`navigate()` has no keyboard knowledge. The template user's ordinary `useKeyboard` callback owns
all key decisions and calls `navigate()` directly:

```ts
useKeyboard((key) => {
  if (screen() === '/' && key.name === 'down') {
    key.preventDefault()
    navigate('/gallery')
  }
})
```

The default callback retains the six Phase 6 Up/Down transitions. It calls `preventDefault()` only
inside a matching branch. Tab, printable characters, and other unconfigured input remain owned by
the focused OpenTUI input. Because OpenTUI runs the App listener before focused-renderable handlers,
a key deliberately bound by the user wins over screen-local handling.

There is no binding table, matcher, fallback cycle, transition validator, router component,
history, URL integration, context provider, route loading, preload system, or compatibility layer.

## Rendering and lifecycle

`App` reads the module-level `screen()` accessor and renders `screens[screen()]` with OpenTUI
Solid's `Dynamic`. A changed key disposes the old Solid owner and mounts a fresh destination owner.
Screens and nested components may import `navigate()` directly.

All Phase 6 lifecycle behavior remains required: focused inputs and local state reset on remount,
Home owns and cleans up its animated GIF, Gallery owns and destroys its PNG renderer, Plain creates
no native pixel renderer or draws, stale media cannot draw after disposal, and the one App keyboard
listener remains stable.

## Validation

Tests cover the global store, inferred `ScreenKey` type, exact registry contents, direct and nested
navigation, same-screen no-op behavior, component disposal/focus, raw CSI and SS3 input, fifty
complete traversals, local state reset, input ownership, media cleanup, real sidecar input, and the
compiled production sidecar.

Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run check`, and
`bun run build`. Confirm the packaged sidecar and OpenTUI native library remain in the `.app`, and
confirm `sdk/`, manifests, and lockfiles are unchanged.
