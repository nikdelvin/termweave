# Plan

Stream remote HTTPS and bundled media directly through FFmpeg so compressed MP4 files are never loaded into JavaScript memory during playback. Preserve the source playback rate and make audio the primary clock; when rendering cannot keep up, discard late video frames instead of slowing playback or input handling.

## Scope

- In: HTTPS and bundled MP4 streaming; bundled and remote PNG, JPEG, and GIF sources; H.264 and HEVC video; AAC audio; silent playback when no audio track exists; source-rate constant- and variable-frame-rate playback; automatic looping after EOF; bounded memory; RGB332 output; macOS arm64 and x64 packaging.
- Out: seeking and playback controls, HLS/DASH manifests, DRM, arbitrary network protocols, and additional video or audio codecs until fixtures require them.

## Action items

[ ] Port the SDK v1 FFmpeg source-build, checksum, licensing, and target-manifest workflow into `sdk-v2`, and integrate both target binaries with `scripts/prepare.ts`, `scripts/build-sidecar.ts`, and the generated Tauri bundle configuration.

[ ] Add an explicit bundled-media packaging convention that copies opted-in MP4/GIF/PNG/JPEG assets into Tauri resources for production, keeps their development paths usable, and exposes one stable resolved URI to application code without embedding large media inside the compiled Bun sidecar.

[ ] Extend the minimal FFmpeg configuration for HTTPS through macOS Secure Transport, MOV/MP4 and image demuxing, H.264 and HEVC parsers/decoders, AAC audio, GIF/PNG/JPEG decoding, area scaling and padding, raw RGBA video output, FLAC audio output, and optional VideoToolbox acceleration with a software-decoder fallback.

[ ] Add media-source classification and resolution that preserves existing local PNG/JPEG/GIF behavior, accepts remote `https:` PNG/JPEG/GIF/MP4 sources, resolves bundled Tauri resources to real filesystem paths, rejects unsupported protocols before process creation, and keeps every path or URL as a direct process argument rather than shell text.

[ ] Add a compatibility fallback for media imported into Bun's virtual filesystem: materialize only the compressed source into a reference-counted temporary file, reuse it across active consumers, and remove it after the last session; prefer direct Tauri-resource paths so large bundled files normally require neither extraction nor an in-memory copy.

[ ] Add a streaming-media session that starts one FFmpeg process per active source, passes either its HTTPS URL or resolved local path directly to FFmpeg, drains raw RGBA video and FLAC audio concurrently through separate pipes, bounds diagnostic stderr, assembles arbitrarily chunked raw frames using reusable buffers, and terminates all resources through one abortable lifecycle.

[ ] Configure FFmpeg without a fixed `fps` filter: use real-time input pacing, timestamp passthrough, source-relative video/audio timestamps, area downscaling to the PixelRenderer target, theme-color padding, and RGBA output so the source cadence is not intentionally capped or resampled.

[ ] Treat audio as optional without sacrificing the normal single-input design: attempt the combined audio/video session first, recognize a missing audio stream during startup, and transparently restart as video-only with a monotonic media clock; do not expose missing audio as a component error.

[ ] Add a bounded playback coordinator that waits for audio readiness when audio exists, presents frames against the media clock, retains only the current and next useful frames, releases superseded buffers, drops late frames instead of blocking the producer, and coalesces OpenTUI render requests so keyboard input remains responsive.

[ ] Refactor `termweave/components/image-controller.ts` to manage either a finite decoded-image playback or a streaming-media session while preserving generation-based replacement, cancellation, component-local errors, the last good frame during source changes, and the public `PixelRenderer` API.

[ ] Route remote and large bundled GIFs through FFmpeg frame streaming and remote or bundled PNG/JPEG files through its bounded single-frame path; retain the existing local decoder/cache for ordinary local images, and apply the existing RGB332 conversion exactly once after scaling and background composition for every published frame.

[ ] Implement EOF looping by keeping the last displayed frame, disposing the completed audio/video session, reopening the same HTTPS URL or bundled path, buffering the new session, and atomically restarting its media clock without accumulating processes, listeners, audio engines, temporary files, or frame buffers.

[ ] Add retry and failure boundaries for HTTP status failures, redirects, TLS failures, timeouts, interrupted reads, servers without byte-range support, missing packaged resources, temporary extraction failures, malformed streams, unsupported codec profiles, FFmpeg crashes, audio-device failures, URI replacement, component unmounting, and application shutdown.

[ ] Add unit and integration coverage for 24/25/30/50/60 FPS and variable-frame-rate MP4 fixtures; H.264, software HEVC, and VideoToolbox fallback; AAC and audio-less MP4; remote reconnect and bundled-file looping; development and packaged Tauri-resource resolution; paths containing spaces and Unicode; Bun virtual-file fallback cleanup; partial pipe chunks; remote GIF timing; single-frame images; RGB332 output; cancellation; and bounded memory during long playback.

[ ] Profile representative 1080p H.264 and HEVC streams on arm64 and x64 Macs, recording source-versus-presented cadence, dropped frames, audio/video drift, input latency, memory, CPU, network reconnects, and glyph-atlas recycling before making remote media the default example.

## Open questions

- None. Remote and bundled MP4 playback loops after EOF, MP4 files without audio play silently, and the initial supported video codecs are H.264 and HEVC.
