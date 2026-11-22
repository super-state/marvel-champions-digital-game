#!/bin/sh
# The 3D table's gate: the type check, the 3D table's own unit tests (`pnpm battle:check`) and its own browser tests
# must have passed on exactly the code being pushed. The pre-push hook uses it for every push that changes `packages/`
# (after the rules gate's own tests when the rules or cards changed).
#
#   sh .githooks/battle-gate.sh <commit>
#
# The 3D table's browser tests are the specs in `packages/client/e2e/` with `battle` in their file name. With none,
# only `pnpm battle:check` runs.
#
# A pass is remembered the way the e2e gate remembers one: by the content of `packages/` and `pnpm-lock.yaml` in the
# commit, in `<git common dir>/e2e-passed`, under a `battle-` prefix so it never counts as a pass of the whole suite.
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

fail() {
  echo "3D table gate: $1; nothing was pushed. Fix it, then push again." >&2
  exit 1
}

echo "3D table gate: type check and 3D table tests on $(git rev-parse --short "$sha") (about a minute)..."
(cd "$root" && pnpm battle:check) || fail "the type check or the unit tests did not pass"

# File names only: Playwright reads each argument as a pattern matched against the spec's path.
specs="$(ls "$root/packages/client/e2e" | grep -E 'battle.*\.spec\.ts$' || true)"
if [ -n "$specs" ]; then
  # A port nobody is listening on, for the reason the e2e gate gives: a dev server left running by another checkout
  # would have the specs test that checkout's code.
  port="$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})')"
  report="$(mktemp -t battle-gate.XXXXXX)"
  trap 'rm -f "$report"' EXIT

  # Three at a time unless told otherwise (`BATTLE_E2E_WORKERS`): each spec drives its own WebGL page and times its pad
  # presses by the clock, so eight at once starved each other (2026-11-21: 5 of 9 failed). Once PR 9 made the pad
  # presses retry, three passed 17 of 17 twice in 86 s and four 3 times in 72 s, against 235 s one at a time
  # (2026-11-22).
  workers="${BATTLE_E2E_WORKERS:-3}"
  echo "3D table gate: the 3D table's browser tests ($(echo $specs)), port $port, $workers at a time..."
  # shellcheck disable=SC2086 # one argument per spec
  (cd "$root/packages/client" &&
    E2E_PORT="$port" PLAYWRIGHT_JSON_OUTPUT_NAME="$report" pnpm exec playwright test $specs --workers="$workers" \
      --reporter=list,json) || true

  # The verdict is read from the report, not the exit code: every test that ran passed, and some did run.
  node -e '
    const fs = require("fs");
    let stats;
    try { stats = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).stats; } catch { process.exit(1); }
    const ok = stats && stats.expected > 0 && stats.unexpected === 0 && stats.flaky === 0;
    console.log(`3D table gate: ${stats.expected} passed, ${stats.unexpected} failed, ${stats.flaky} flaky, ${stats.skipped} skipped.`);
    process.exit(ok ? 0 : 1);
  ' "$report" || fail "the 3D table's browser tests did not pass"
fi

echo "$key" >> "$stamps"
echo "3D table gate: passed."
