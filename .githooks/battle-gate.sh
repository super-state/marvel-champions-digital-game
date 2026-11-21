#!/bin/sh
# The 3D table's gate: the type check and the 3D table's own tests (`pnpm battle:check`) must have passed on exactly
# the code being pushed. The pre-push hook uses it for a push that changes nothing but the 3D table
# (`packages/client/src/battle-table/`, `packages/client/battle/`); nothing in the old 2D game imports from there, so
# such a push cannot break a screen the browser suite (`e2e-gate.sh`) opens, and that suite never opens the 3D table.
#
#   sh .githooks/battle-gate.sh <commit>
#
# A pass is remembered the way the e2e gate remembers one: by the content of `packages/` and `pnpm-lock.yaml` in the
# commit, in `<git common dir>/e2e-passed`, under a `battle-` prefix so it never counts as a pass of the browser suite.
set -e

sha="${1:-HEAD}"
root="$(git rev-parse --show-toplevel)"
key="battle-$(git rev-parse "$sha:packages")-$(git rev-parse "$sha:pnpm-lock.yaml")"
stamps="$(git rev-parse --git-common-dir)/e2e-passed"

if [ -f "$stamps" ] && grep -q -x "$key" "$stamps"; then
  echo "3D table gate: already passed on this code."
  exit 0
fi

# The checks run on the working tree, so they only vouch for the commit when the two match.
if ! git diff --quiet "$sha" -- packages pnpm-lock.yaml; then
  echo "3D table gate: the working tree differs from $sha under packages/ or pnpm-lock.yaml." >&2
  echo "Commit or set aside those changes so the checks test what is being pushed, then push again." >&2
  exit 1
fi

echo "3D table gate: type check and 3D table tests on $(git rev-parse --short "$sha") (about a minute)..."
if (cd "$root" && pnpm battle:check); then
  echo "$key" >> "$stamps"
  echo "3D table gate: passed."
else
  echo "3D table gate: the checks did not pass; nothing was pushed. Fix it, then push again." >&2
  exit 1
fi
