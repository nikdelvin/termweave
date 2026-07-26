# Bundled FFmpeg

Termweave builds and runs FFmpeg as a separate executable for local H.264/AAC MP4 playback. Video
is decoded to raw BGRA frames; audio is decoded and re-encoded as a low-compression FLAC stream for
OpenTUI's native audio engine. The pinned version, official source URL, source checksum, enabled
features, and supported build targets are recorded in `sidecar/ffmpeg-artifacts.json`.

The video and audio children are input-paced. In particular, audio pacing keeps Bun's eagerly
drained child-process pipe bounded while OpenTUI maintains its own one-second native stream buffer.

The build intentionally omits `--enable-gpl`, `--enable-version3`, and `--enable-nonfree`. It does
not link x264, x265, LAME, or another external codec library. The native FFmpeg H.264 and AAC
decoders and FLAC encoder are used.

Before a desktop build, `sidecar/scripts/build-ffmpeg.ts`:

1. Downloads and verifies the official source archive.
2. Builds the minimal executable for the current supported macOS target.
3. Records the executable SHA-256 and exact configuration in `artifact-<target>.json`.
4. Copies FFmpeg's LGPL and license notices here.

The desktop bundle includes this directory, including the corresponding source archive.
FFmpeg is copyright its respective contributors and is distributed under LGPL-2.1-or-later for
this configuration. Termweave itself remains licensed separately under the MIT License.

## Current validation

The `aarch64-apple-darwin` artifact and macOS app/DMG packaging are currently validated. The
streamer and target-based resolver are shared across operating systems, but Windows and Linux still
need their own pinned artifacts, installer wiring, CI jobs, and platform benchmarks before those
targets are considered supported.
