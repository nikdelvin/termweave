# Security policy

## Supported versions

Termweave is currently pre-1.0. Security fixes are applied to the latest commit on `main`; older
commits and generated SDK snapshots are not maintained separately.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability
reporting for this repository so the report can be investigated before details are disclosed.

Include the affected commit or version, platform, reproduction steps, impact, and any suggested
mitigation. Reports involving the localhost WebSocket, sidecar process execution, installer or
update path, dependency updater, or generated native configuration are especially useful. The
localhost transport is expected to require mutual per-process authentication before releasing
terminal data.

If private vulnerability reporting is unavailable, open a minimal issue asking the maintainer for a
private contact channel without including exploit details.
