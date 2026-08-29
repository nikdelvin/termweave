# Contributing to Termweave

Bug fixes, documentation, examples, and focused improvements are welcome. The repository root is
the current SDK and application template.

## Setup

Development requires macOS, Bun 1.3+, a stable Rust toolchain, and the Xcode Command Line Tools.

```sh
git clone https://github.com/nikdelvin/termweave.git
cd termweave
bun install
bun run dev
```

## Ownership and import direction

| Path              | Owner and purpose                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `app/`            | Application screens, durable state, components, assets, navigation policy, and composition. |
| `termweave/`      | SDK components, sidecar bootstrap, configuration parsing, host runtime, and SDK assets.     |
| `scripts/`        | Preparation, native-sidecar build, and development tooling.                                 |
| `src-tauri/`      | Conventional native host and generated native output.                                       |
| `tests/`, `docs/` | Verification and architecture documentation.                                                |

Ordinary application files consume SDK features through `#termweave`. `app/index.tsx` is the sole
composition-root exception: it supplies `App` to the SDK sidecar bootstrap. SDK runtime modules
must never import application components. `app/store.ts` owns the application navigation instance
and durable user data; `termweave/navigation-store.ts` owns only reusable screen-selection
mechanics.

## Validate changes

```sh
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run check
bun run build
```

For presentation, renderer, transport, or packaging work, also test the native app on 1× and 2×
displays, exercise WebGL activation/context-loss fallback, traverse all screens, and inspect the
resulting `.app` contents. Generated output and dependency directories must remain untracked.

Keep direct Bun and Cargo dependency versions exact. Dependency upgrades, other platforms, and
publishing/installer work should be isolated in explicitly scoped changes. Explain user-visible
effects, automated and manual verification, and known limitations in the pull request.
