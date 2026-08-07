# Phase 7 — Final audit, cleanup, and ownership-boundary planning

Create a decision-complete plan for the final Termweave SDK v2 project audit, cleanup, and project
structure refactor. This is a planning task only: do not edit files, install dependencies, generate
code, or run destructive commands.

Start by reading completely:

- `sdk-v2/docs/migration-plan.md`
- `sdk-v2/docs/phase-4.5-webgl-postprocessing.md`
- `sdk-v2/docs/phase-6.5.md`
- `sdk-v2/docs/migration-prompts.md`

Then inspect the complete `sdk-v2` source tree, tests, build scripts, manifests, ignored outputs,
Tauri configuration, current git status, and relevant commit history. Run read-only checks where
they materially improve the plan.

## Goals

Develop a final cleanup and refactoring plan that:

1. Clearly separates end-user-owned application code from Termweave-owned SDK/runtime code.
2. Makes the project structure immediately understandable to a new template user.
3. Minimizes the files users must edit when adding screens, assets, keyboard controls, metadata,
   or theme configuration.
4. Keeps SDK internals out of ordinary application development.
5. Removes obsolete, duplicated, phase-specific, or unnecessarily abstract code.
6. Simplifies `app.config.json` to contain only end-user-owned metadata and theme configuration.
7. Preserves all production behavior, reliability fixes, and packaging requirements.
8. Leaves a maintainable, copyable structure suitable for the final SDK v2 release.

Prefer deletion, direct code, and clear ownership over new abstraction.

## Ownership analysis

Classify every important directory and entry point into one of these categories:

- End-user-owned and expected to be edited.
- Template-owned but rarely edited.
- Termweave SDK/runtime-owned and not intended for user modification.
- Generated or build output.
- Test and documentation infrastructure.

Pay special attention to:

- `app/App.tsx`
- `app/screens.ts`
- `app/app-store.ts`
- `app/screens/`
- `app/components/`
- `app/assets/`
- `app/termweave/`
- `app/index.tsx`
- `app.config.json`
- `shared/`
- `scripts/`
- `src/`
- `src-tauri/`
- `tests/`
- Package manifests, lockfiles, and build configuration.

Determine whether SDK-owned code currently living under `app/` should remain there or move behind
a clearer runtime boundary. Check import directions and require user code to depend on SDK code
without SDK internals depending on user components unnecessarily.

The plan must answer:

- Which files should a new user edit on their first day?
- Which files should a user normally never edit?
- Is `app.config.json` strictly an end-user-owned metadata and theme file?
- Do all terminal geometry and presentation policies belong exclusively to the Termweave SDK?
- Should `app/termweave/` and `app/index.tsx` remain under `app/` or move into an SDK-owned area?
- What is the smallest intentional component-facing SDK interface?
- Are any internal types, helpers, or configuration values accidentally public?
- Can SDK-owned modules be updated without overwriting user-owned application files?

## Required `app.config.json` simplification

Treat configuration simplification as part of the final ownership-boundary work, not as an optional
follow-up.

The target end-user configuration is:

```json
{
  "name": "Termweave App",
  "description": "A terminal desktop application built with Termweave.",
  "packageName": "termweave-app",
  "bundleIdentifier": "com.example.termweave-app",
  "version": "0.1.0",
  "authors": ["Example Author"],
  "themeColor": "#010416",
  "icon": "app.icon.png"
}
```

Required changes:

- Remove `fontSize` from user configuration.
- Preserve the current effective font size of `20` as one SDK-owned constant.
- Derive the fixed terminal grid from that constant.
- Remove `monitorOverlay`; the monitor overlay is always enabled.
- Remove `crtEffects`; CRT presentation is always enabled.
- Preserve reduced-motion behavior and WebGL/default-renderer fallback even though CRT no longer
  has an enable/disable switch.
- Remove `foregroundColor` from user configuration.
- Replace terminal foreground, cursor, Plain-screen styling, and other remaining foreground usages
  with clearly named SDK-owned constants. Preserve the current appearance unless the audit finds a
  concrete reason to recommend and document another fixed value.
- Rename `backgroundColor` to `themeColor`.
- `themeColor` must continue controlling the monitor bezel treatment.

Do not assume that renaming every `backgroundColor` reference to `themeColor` is correct. Audit its
current responsibilities first. It currently affects:

- Native window background.
- xterm background.
- OpenTUI renderer background.
- Application and control backgrounds.
- PixelRenderer transparency composition.
- CRT postprocessor background.
- Monitor bezel filtering.

The final plan must decide which responsibilities are genuine theme behavior and should continue
to follow `themeColor`. Any value that should not be user-themeable must become an SDK-owned
constant instead of silently inheriting the renamed field.

The plan must cover updates to:

- `AppConfig` and `TermweaveConfig`.
- Configuration parsing, caching, validation, and test fixtures.
- Fixed terminal-grid construction.
- Generated Tauri overrides and native window startup colors.
- xterm and OpenTUI initialization.
- Presentation layout and CRT activation.
- PixelRenderer background composition.
- Application screen and control styling.
- Configuration, presentation, terminal, prepare, CRT, component, and source-contract tests.
- Migration documentation, configuration examples, and Phase 4/4.5 historical descriptions.

Replace the old monitor/CRT boolean matrix with assertions that:

- The monitor is always rendered.
- CRT initialization is always attempted.
- CSS noise and shader optics remain active by default.
- WebGL activation failure and context loss still fall back safely.
- Reduced-motion behavior remains supported.
- The fixed font size produces the expected terminal rows and columns.

Explicitly decide how stale removed fields are handled:

- Reject them with a concise migration error, or
- Ignore them consistently with the existing unknown-field policy.

Recommend one behavior and document it so implementation requires no further product decision.

## Structure brainstorming

Propose two or three viable project structures, including the option of retaining the current
structure with focused cleanup only.

For each option, evaluate:

- Which files a new user must understand and edit.
- Whether screen registration remains centralized in one `screens.ts` file.
- How `ScreenKey`, `screen()`, and `navigate()` remain typed and simple.
- Whether keyboard decisions remain ordinary user-owned callbacks that call `navigate()` directly.
- Circular-import risk and dependency direction.
- Public versus internal imports.
- Copyability of the template.
- Separation of application assets from SDK assets.
- Configuration ownership and fixed SDK defaults.
- Build-script, sidecar, frontend, and Tauri impact.
- Migration cost from the current tree.
- Test changes and regression risk.
- How future SDK updates avoid overwriting user-owned files.

Recommend one structure and explain why it provides the clearest ownership boundary without
creating framework complexity.

Do not introduce a router, navigation framework, binding table, dependency injection system,
compatibility layer, generalized plugin architecture, or extra package merely to reorganize files.

## Cleanup audit

Identify:

- Dead or obsolete Phase 1–6 implementation code.
- Documentation that describes superseded architecture as current behavior.
- Duplicate helpers, configuration sources, constants, and type definitions.
- Brittle source-text contract tests that should become behavior tests.
- Tests that overlap without adding meaningful protection.
- Missing tests at important ownership or production boundaries.
- Misleading names, comments, directories, and import aliases.
- Unnecessary exports and accidental public APIs.
- Incorrect ownership of assets or configuration.
- Stale generated files or missing ignore rules.
- Import cycles and overly broad dependencies.
- Files that mix user-facing configuration with SDK machinery.
- Platform assumptions that should be explicit rather than abstracted.
- Anything included in the production bundle that should not ship.
- Any v1 implementation copied into v2 without a current requirement.

For every proposed move or deletion, identify the behavior or ownership problem it solves. Do not
perform churn for visual symmetry alone.

## Required preservation

The plan must preserve:

- The dedicated `/dev/fd/0` OpenTUI input stream.
- Runtime `DEBUG` suppression without constant-folding `process.env.DEBUG`.
- Packaged OpenTUI native assets and `OTUI_ASSET_ROOT`.
- Raw Tauri sidecar/xterm transport and ordered input writes.
- The typed global `screen()` and key-agnostic `navigate(screenKey)` API.
- One user-facing screen registry.
- User-owned keyboard callbacks that call `navigate()` directly.
- One stable App-level keyboard listener in the default template.
- Screen disposal, focus, local-state reset, and unconfigured-input ownership.
- GIF, PNG, and Plain media lifecycle behavior.
- Decode-error isolation and child-overlay ordering.
- Fixed logical terminal geometry.
- WebGL/default-renderer activation and context-loss fallback.
- Reduced-motion behavior.
- A self-contained production `.app` that requires no installed Bun or `node_modules` tree.
- An unchanged v1 `sdk/` tree.

There must remain no Solid Router, browser history, URL routing, context provider, package patch,
preload system, screen cache, adapter, compatibility layer, WebSocket transport, FFmpeg, video,
audio, updater, source synchronization, or automatic sidecar recovery.

Do not assume package or lockfile changes are necessary. Any proposed dependency or public API
change must be explicitly justified.

## Deliverable

Produce:

1. A concise current-state architecture and ownership map.
2. The main cleanup, configuration, and ownership-boundary problems found.
3. Two or three project-structure options with concrete tradeoffs.
4. One recommended final structure.
5. The exact target `app.config.json`, runtime configuration types, and SDK-owned constants.
6. A decision-complete, staged implementation plan.
7. Every required file move, import change, deletion, or public interface change.
8. Documentation and migration updates.
9. Test changes and acceptance criteria.
10. Production bundle and manual verification steps.
11. Explicit assumptions and intentionally deferred work.

The final plan must be detailed enough for another engineer to implement without making additional
architectural or product decisions. Ask the user only about choices that cannot be resolved from
the repository or the requirements above.

## Validation requirements for the future implementation

The implementation plan must include:

- `bun run test`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `bun run check`
- `bun run build`
- Production `.app` content inspection.
- Packaged Tauri/xterm smoke testing.
- Verification of every default screen transition and direct `navigate()` call.
- Verification of focus, typing, local-state reset, and media cleanup.
- Confirmation that the compiled sidecar and OpenTUI native library remain packaged.
- Confirmation that protected manifests, lockfiles, and `sdk/` remain unchanged.
- A final search proving removed configuration fields are absent from active runtime code.

Configuration acceptance criteria must include:

- `app.config.json` contains only the target fields.
- No runtime logic reads `fontSize`, `foregroundColor`, `monitorOverlay`, `crtEffects`, or
  `backgroundColor` from application configuration.
- `themeColor` is validated as a six-digit hexadecimal color.
- Fixed SDK presentation values are defined once and are not duplicated across the host, sidecar,
  or template.
- The fixed grid and current presentation appearance remain stable.
- Monitor and CRT presentation are always active, subject only to runtime fallback and
  accessibility behavior.
- No transport, packaging, native-asset, lifecycle, or input regression is introduced.
