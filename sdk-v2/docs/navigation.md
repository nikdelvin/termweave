# Application navigation

Termweave v2 separates reusable screen-selection mechanics from application-owned screen keys and
transition policy. It does not include URL routing, history, or a keybinding framework.

## SDK mechanics

`termweave/navigation-store.ts` provides the generic public primitive:

```ts
interface ScreenNavigation<Screen> {
  readonly screen: Accessor<Screen>
  navigate(destination: Screen): void
}

createScreenNavigation<Screen>(initialScreen): ScreenNavigation<Screen>
```

It owns one private Solid signal. The returned surface is frozen, navigating to the active screen
uses Solid's equality-based no-op, and the primitive has no knowledge of registries, components,
keys, transitions, routes, or history.

## Application binding and registry

`app/screens.ts` is the only registration file and uses non-route keys:

```ts
export const screens = {
  animation: AnimationScreen,
  picture: PictureScreen,
  plain: PlainScreen,
}

export type ScreenKey = keyof typeof screens

export const screenMedia: Partial<Record<ScreenKey, string>> = {
  animation: animationScreenMediaUri,
  picture: pictureScreenMediaUri,
}
```

`app/store.ts` imports `ScreenKey` as a type, creates
`createScreenNavigation<ScreenKey>('animation')`, and exports the typed `screen` accessor and
`navigate(destination)` action alongside durable application state. It never imports the screen
registry at runtime. Screens and nested application components consume those exports through the
single application-state entrypoint.

## Keyboard ownership

`navigate()` has no keyboard knowledge. The application-owned `useKeyboard` callback in
`app/App.tsx` retains all six Up/Down transitions between Animation, Picture, and Plain. It calls
`preventDefault()` only for a matching transition, leaving Tab, printable characters, and other
input to the focused OpenTUI control.

There is no binding table, matcher, fallback cycle, transition validator, router, history, URL
integration, context provider, route loading, preload system, or compatibility layer.

## State and lifecycle

`App` renders `screens[screen()]` with OpenTUI Solid's `Dynamic`. A changed key disposes the prior
screen owner and mounts a fresh destination owner, so input focus re-establishes on each screen.
Consecutive Animation/Picture transitions keep one `PixelRenderer` owner alive and replace its URI;
the previous decoded frame remains visible until the destination frame is ready. Entering Plain
disposes that renderer and stops its playback. Decoded frames are retained in a size-bounded cache,
so returning to the same media at the same terminal geometry can start playback synchronously.

The starter counter and input text live in `app/store.ts`, so their values persist across every
screen transition and repeated traversal. Truly local state, focus handles, timers,
`AbortController`s, renderer objects, and other lifecycle-bound resources remain inside individual
components.
