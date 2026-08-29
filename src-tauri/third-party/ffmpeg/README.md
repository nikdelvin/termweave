# Bundled FFmpeg

Termweave builds FFmpeg as a separate executable for remote and bundled media playback. The
sidecar sends direct HTTPS or filesystem arguments to FFmpeg, receives raw RGBA video and FLAC
audio through separate pipes, and never links FFmpeg into the MIT-licensed application.

The pinned version, official source URL, source checksum, exact minimal feature set, and supported
macOS targets are recorded in `ffmpeg-artifacts.json`. The configuration enables H.264, HEVC, AAC,
GIF, PNG, and JPEG decoding; macOS Secure Transport for HTTPS; and optional VideoToolbox hardware
acceleration with a software fallback. It intentionally omits GPL and nonfree features and does not
link x264, x265, or another external codec library.

Before a desktop sidecar build, `scripts/build-ffmpeg.ts`:

1. Downloads and verifies the official source archive.
2. Builds the minimal executable for the current supported macOS target.
3. Records the executable SHA-256 and exact configuration in `artifact-<target>.json`.
4. Copies FFmpeg's LGPL and license notices into this directory.

The application bundle includes this directory, including the verified source archive. FFmpeg is
copyright its respective contributors and is distributed under LGPL-2.1-or-later for this
configuration. Termweave itself remains licensed separately under the MIT License.
