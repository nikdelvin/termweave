# Application navigation

Termweave v2 uses a global screen selection API without a router or keybinding framework.

## Screen registry

`app/screens.ts` is the only registration file:

```ts
export const screens = {
  '/': HomeScreen,
  '/gallery': GalleryScreen,
  '/plain': PlainScreen,
}

export type ScreenKey = keyof typeof screens
```

The application store exposes `screen: Accessor<ScreenKey>` and
`navigate(destination: ScreenKey): void`. Its Solid setter remains private. Navigating to the
active screen is a no-op under Solid's equality behavior.

## Keyboard ownership

`navigate()` has no keyboard knowledge. The application-owned `useKeyboard` callback in
`app/App.tsx` decides which keys navigate and calls `navigate()` directly. The starter retains all
six Up/Down transitions between Home, Gallery, and Plain. It calls `preventDefault()` only for a
matching transition, so Tab, printable characters, and other input remain owned by the focused
OpenTUI control.

There is no binding table, matcher, fallback cycle, transition validator, router, history, URL
integration, context provider, route loading, preload system, or compatibility layer.

## Rendering and lifecycle

`App` renders `screens[screen()]` with OpenTUI Solid's `Dynamic`. A changed key disposes the prior
Solid owner and mounts a fresh destination owner. Screens and nested components may import
`navigate()` directly.

Focused inputs and local state reset on remount. Home owns and cleans up its GIF, Gallery owns and
destroys its PNG renderer, Plain creates no native pixel renderer, stale media cannot draw after
disposal, and the single App keyboard listener remains stable.
