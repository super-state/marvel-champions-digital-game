#!/bin/sh
# The rules gate: for a push that changes the rules or cards (`packages/engine/`, `packages/content/`,
# `packages/cards/`) or `pnpm-lock.yaml`. It tests only what the change can reach in the game we play (Adam,
# 2026-11-22: "assess what we're changing, what we need to test, and then do it pretty quickly"; the 3D table plays
# the core set, Spider-Man against Rhino), then runs the 3D table's gate (`battle-gate.sh`).
#
#   sh .githooks/rules-gate.sh <commit> <base commit>
#
# What it runs, by what changed between <base> and <commit>:
#   - always: the type check of the engine, content and cards (the client's comes with the 3D table's gate);
#   - the engine changed: every engine unit test (about three minutes): it is the rules for every game;
#   - content changed: every content unit test (about twenty seconds);
#   - always: the core set's card tests (`packages/cards/src/core`, Spider-Man, Rhino and the rest of the core box,
#     about twenty-five seconds), plus any card test file the push changes and the test file beside each changed card
#     file (`x.ts` -> `x.test.ts`);
#   - the lockfile changed: all of the above.
# What it leaves out on purpose: the card tests of the other boxes (waves 2 onwards) and the old 2D game's tests. Run
# `pnpm test` by hand when a change is meant for those.
#
# A pass is remembered by the content of `packages/` and `pnpm-lock.yaml` plus what was tested, under a `rules-`
# prefix in `<git common dir>/e2e-passed`.
set -e

sha="${1:-HEAD}"
base="${2:-}"
root="$(git rev-parse --show-toplevel)"
hooks="$(dirname "$0")"
stamps="$(git rev-parse --git-common-dir)/e2e-passed"

if [ -n "$base" ]; then
  changed="$(git diff --name-only --no-renames "$base" "$sha" -- packages pnpm-lock.yaml)"
else
  changed="pnpm-lock.yaml" # no base to compare with: test as if everything changed
fi
has() { printf '%s\n' "$changed" | grep -qE "$1"; }
engine=""
content=""
if has '^pnpm-lock\.yaml$'; then
  engine=1
  content=1
fi
has '^packages/engine/' && engine=1
has '^packages/content/' && content=1

# Card test files to add to the core set's: changed ones, and the one beside each changed card file, if it exists.
extra="$(printf '%s\n' "$changed" | grep -E '^packages/cards/src/.*\.ts$' | grep -v '^packages/cards/src/core/' |
  while read -r f; do
    case "$f" in
      *.test.ts) t="$f" ;;
      *) t="${f%.ts}.test.ts" ;;
    esac
    git cat-file -e "$sha:$t" 2>/dev/null && echo "$t"
  done | sort -u | tr '\n' ' ')"

key="rules-$(git rev-parse "$sha:packages")-$(git rev-parse "$sha:pnpm-lock.yaml")-e${engine:-0}c${content:-0}-$(printf '%s' "$extra" | git hash-object --stdin)"
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

cd "$root"
echo "rules gate: type check of the engine, content and cards on $(git rev-parse --short "$sha")..."
pnpm --filter @mc/engine --filter @mc/content --filter @mc/cards typecheck || fail "the type check did not pass"
if [ -n "$engine" ]; then
  echo "rules gate: the engine changed, so every engine test (about three minutes)..."
  pnpm --filter @mc/engine test || fail "the engine tests did not pass"
fi
if [ -n "$content" ]; then
  echo "rules gate: content changed, so every content test..."
  pnpm --filter @mc/content test || fail "the content tests did not pass"
fi
echo "rules gate: the core set's card tests${extra:+ and $extra}..."
# shellcheck disable=SC2086 # one argument per test file
pnpm exec vitest run --project @mc/cards packages/cards/src/core $extra || fail "the card tests did not pass"

sh "$hooks/battle-gate.sh" "$sha" || fail "the 3D table's gate did not pass"

echo "$key" >> "$stamps"
echo "rules gate: passed."
