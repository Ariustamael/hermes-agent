#!/usr/bin/env bash
# Fail closed before a gateway start/restart could deploy upstream main or loose edits.
# Exit 78 is systemd's permanent-configuration signal: the unit's
# RestartPreventExitStatus=78 parks the service instead of crash-looping.
set -euo pipefail
readonly EX_CONFIG=78
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$repo"
branch=$(git symbolic-ref --quiet --short HEAD || true)
if [ "$branch" != "chester/local-customizations" ]; then
  printf 'Refusing gateway start: expected chester/local-customizations, got %s\n' "${branch:-detached HEAD}" >&2
  exit "$EX_CONFIG"
fi
if [ -n "$(git status --porcelain=v1)" ]; then
  printf 'Refusing gateway start: Hermes checkout has uncommitted source changes. Commit them on chester/local-customizations first.\n' >&2
  exit "$EX_CONFIG"
fi
