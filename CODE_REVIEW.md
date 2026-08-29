# Termweave simplification review

Date: 2026-08-29  
Status: F0-F7 implemented

## Outcome

The refactor removed parallel screen, image-decoding, compositing, and development-watching
implementations without changing the public SDK surface. Application, SDK, host, and packaging
ownership remain acyclic, while finite images and streaming media now share one FFmpeg-backed
process layer.

The production TypeScript footprint changed from 5,630 lines across 38 files to approximately
5,200 lines across 34 files. The test suite remains at the 198-test regression baseline, with its
media coverage moved from implementation-specific Jimp/GIF compositor tests to bundled-FFmpeg
integration tests.

## Completed findings

| Finding | Status   | Result                                                                                                                                 |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| F0      | Complete | CRT noise remains `0.5`; the behavior test asserts the literal and README agrees.                                                      |
| F1      | Complete | Three duplicated demo screens and parallel media maps became one typed registry and shared `DemoScreen` in `app/screens.tsx`.          |
| F2      | Complete | PNG, JPEG, GIF, MP4, bundled media, and HTTPS media use one FFmpeg process layer with finite and streaming playback policies.          |
| F3      | Complete | The custom recursive watcher/supervisor became a stable one-child Bun `--watch --no-clear-screen` launcher.                            |
| F4      | Complete | RGB parsing, normalization, palette conversion, and RGBA compositing have shared owners.                                               |
| F5      | Complete | `termweave/components/` was replaced by the responsibility-oriented seven-file `termweave/media/` subsystem.                           |
| F6      | Complete | Script tooling, error conversion, navigation consumption, glyph validation, audio, monitor, and pass-through surfaces were simplified. |
| F7      | Complete | Deferred values, media blobs, and rendering fakes are shared test support; ownership checks use import analysis and directory globs.   |

## Final media structure

```text
termweave/
  color.ts
  error-message.ts
  media/
    PixelRenderer.tsx  # Solid component and native drawing boundary
    controller.ts      # request lifecycle and streaming ownership
    source.ts          # URI resolution, signature detection, retained inputs
    ffmpeg.ts          # executable resolution, process pipes, timestamps
    playback.ts        # finite cache/timing and streaming clocks/queues
    audio.ts           # shared native media-audio lifecycle
    frame.ts           # byte sizing, viewport, compositing
  host/
    ...
```

The direction of ownership is source/frame → FFmpeg → playback → controller → component. Runtime
import-cycle tests enforce the overall graph.

## Behavior retained

- The exact `#termweave` runtime exports remain `PixelRenderer`, `bundledMediaUri`,
  `createScreenNavigation`, and `getTermweaveConfig`, with the existing public types.
- Local PNG/JPEG/GIF detection uses byte signatures independently of filename extensions.
- Finite images decode without `-re`; MP4 and remote media retain real-time streaming.
- GIF delays come from successive PTS values and input duration, with the existing 10 ms minimum
  and 100 ms invalid-delay fallback.
- The committed campfire asset decodes to eight 150 ms frames with the parser-enabled FFmpeg 8.1.2
  build.
- Final finite frames use the 64 MiB stat-keyed LRU and copied buffers, so pooled FFmpeg storage is
  never cached. File, size, or background changes miss the old cache entry.
- Cached and streaming frames use the same background/palette compositor.
- Replacements retain the previous good frame; stale work is cancelled and suppressed.
- Streaming keeps audio-primary timing, a two-frame queue, remote retry, missing-audio fallback,
  and VideoToolbox-to-software fallback.
- Development hard restarts retain inherited stdin/stdout/stderr, recover after syntax errors,
  preserve media environment variables, remove `DEBUG`, and forward one termination signal.

## Removed code and dependencies

Removed source units include the three per-screen files, the manual image decoder, manual GIF
compositor, bilinear RGBA resizer, split streaming wrapper, host-owned palette module, and the
manual filesystem watch state machine.

Removed runtime packages:

- `@jimp/core`
- `@jimp/js-jpeg`
- `@jimp/js-png`
- `gifuct-js`

`bun.lock` no longer contains their transitive dependency trees. Tiny PNG/JPEG/GIF samples are
committed as dependency-free test fixture bytes.

## Verification

- `bun run ffmpeg:build`: passed; regenerated the ignored host binary and artifact metadata with
  `--enable-parser=gif`.
- `bun run test`: 198 tests passed across 34 test files.
- `bun run typecheck`: passed.
- `bun run lint`: passed.
- `bun run format:check`: passed.
- `bun run rust:check`: passed.
- `bun run check`: passed.
- `bun run build`: passed.

Automated integration coverage includes all three screens, keyboard navigation, GIF looping and
disposal, PNG/JPEG rendering, remote-media error containment, real Bun watch restarts, syntax-error
recovery, stdin continuity, environment stability, signal forwarding, and production-sidecar
startup. A signed/interactive GUI smoke run is still appropriate before a release build is shipped
on each supported Mac architecture.
