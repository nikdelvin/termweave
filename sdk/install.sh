#!/bin/sh
set -eu

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Termweave standalone installation currently supports macOS only." >&2
  exit 1
fi

for command in git bun rustc cargo xcode-select; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode Command Line Tools are required. Run: xcode-select --install" >&2
  exit 1
fi

bun_version=$(bun --version)
bun_major=${bun_version%%.*}
bun_remainder=${bun_version#*.}
bun_minor=${bun_remainder%%.*}
case "$bun_major:$bun_minor" in
  *[!0-9:]* | :*)
    echo "Could not determine Bun version from: $bun_version" >&2
    exit 1
    ;;
esac
if [ "$bun_major" -lt 1 ] || { [ "$bun_major" -eq 1 ] && [ "$bun_minor" -lt 3 ]; }; then
  echo "Bun 1.3 or newer is required; found $bun_version." >&2
  exit 1
fi

project_root=$(pwd)
repository_url=${TERMWEAVE_REPOSITORY_URL:-https://github.com/nikdelvin/termweave.git}
repository_branch=${TERMWEAVE_BRANCH:-main}

if [ -e "$project_root/termweave" ]; then
  echo "Refusing to overwrite existing SDK directory: $project_root/termweave" >&2
  exit 1
fi

for path in src app.config.json app.icon.svg package.json bun.lock tsconfig.json eslint.config.js .prettierrc.json .prettierignore; do
  if [ -e "$project_root/$path" ]; then
    echo "Refusing to overwrite existing scaffold path: $path" >&2
    exit 1
  fi
done

git clone --branch "$repository_branch" --single-branch "$repository_url" "$project_root/termweave"
if ! bun "$project_root/termweave/sdk/scripts/install-project.ts" "$project_root"; then
  echo "Termweave installation did not finish." >&2
  echo "Fix the reported error, then retry in a new empty project directory." >&2
  exit 1
fi
