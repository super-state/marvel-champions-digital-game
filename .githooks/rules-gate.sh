#!/bin/sh
# The rules gate: for a push that changes the rules and cards (`packages/engine/`, `packages/content/`,
# `packages/cards/`), maybe with the 3D table, and nothing of the old 2D game. It runs those three packages' type
# checks and unit tests, then the 3D table's gate (`battle-gate.sh`: the client type check, the 3D table's unit tests
# and its browser tests).
#
#   sh .githooks/rules-gate.sh <commit>
#
# What it leaves out on purpose (Adam, 2026-11-22: rules fixes were waiting on the whole old suite): the old 2D game's
# browser suite. A rules change can still break an old 2D screen and this gate will not notice; the old game is being
# retired, and only the 3D table is played. `pnpm e2e:verify` still runs that suite by hand.
#
# A pass is remembered by the content of `packages/` and `pnpm-lock.yaml`, under a `rules-` prefix in
# `<git common dir>/e2e-passed`, so it never counts as a pass of the whole suite.
set -e

sha="${1:-HEAD}"
root="$(git rev-parse --show-toplevel)"
hooks="$(dirname "$0")"
key="rules-$(git rev-parse "$sha:packages")-$(git rev-parse "$sha:pnpm-lock.yaml")"
stamps="$(git rev-parse --git-common-dir)/e2e-passed"

if [ -f "$stamps" ] && grep -q -x "$key" "$stamps"; then
  echo "rules gate: already passed on this code."
  exit 0
fi

# The checks run on the working tree, so they only vouch for the commit when the two match.
if ! git diff --quiet "$sha" -- packages pnpm-lock.yaml; then
  echo "rules gate: the working tree differs from $sha under packages/ or pnpm-lock.yaml." >&2
  echo "Commit or set aside those changes so the checks test what is being pushed, then push again." >&2
  exit 1
fi

fail() {
  echo "rules gate: $1; nothing was pushed. Fix it, then push again." >&2
  exit 1
}

pkgs="--filter @mc/engine --filter @mc/content --filter @mc/cards"
echo "rules gate: type check of the engine, content and cards on $(git rev-parse --short "$sha")..."
# shellcheck disable=SC2086 # one argument per filter
(cd "$root" && pnpm $pkgs typecheck) || fail "the engine, content or cards type check did not pass"
echo "rules gate: the engine, content and cards unit tests (about four minutes)..."
# shellcheck disable=SC2086
(cd "$root" && pnpm $pkgs test) || fail "the engine, content or cards unit tests did not pass"

sh "$hooks/battle-gate.sh" "$sha" || fail "the 3D table's gate did not pass"

echo "$key" >> "$stamps"
echo "rules gate: passed."
