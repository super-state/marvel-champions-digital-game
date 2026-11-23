#!/bin/sh
# The 3D table's gate: the type check and the 3D table's own unit tests (`pnpm battle:check`) must have passed on
# exactly the code being pushed. Its browser tests run only when asked for (`BATTLE_E2E=1`), which `pnpm table:ship`
# does before a version goes to the test site: a push no longer waits for them (Adam, 2026-11-23: "run the tests
# when we ... cut a version"; they took 5 to 15 minutes a push on a busy PC, for a one-line fix). The pre-push hook uses it for every push that changes `packages/`
# (after the rules gate's own tests when the rules or cards changed).
#
#   sh .githooks/battle-gate.sh <commit> [<base>]
#
# The 3D table's browser tests are the specs in `packages/client/e2e/` with `battle` in their file name. Given the
# base the push is measured from, only the ones the change can affect run (`battle-specs.mjs`: a change to the pad
# runs the pad's test, a change to the table's own code runs them all); with no base, all of them. With none to run,
# only `pnpm battle:check` runs.
#
# One browser-test run at a time on this PC (Adam, 2026-11-23): each spec drives a whole WebGL table, and two
# sessions' runs at once starved each other until tests timed out and browsers crashed. A run waits its turn on a
# lock (`BATTLE_E2E_LOCK`, default `%LOCALAPPDATA%/mc-push-check/battle-e2e.lock`), shared by every checkout and
# worktree; a lock whose holder has gone, or that is over 30 minutes old, is taken over.
#
# A pass is remembered the way the e2e gate remembers one: by the content of `packages/` and `pnpm-lock.yaml` in the
# commit, in `<git common dir>/e2e-passed`, under a `battle-` prefix so it never counts as a pass of the whole suite.
set -e

sha="${1:-HEAD}"
base="${2:-}"
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
every="$(ls "$root/packages/client/e2e" | grep -E 'battle.*\.spec\.ts$' || true)"
specs="$(cd "$root" && node .githooks/battle-specs.mjs "$base" "$sha")" || specs="$every"
if [ "$specs" = "$every" ]; then full=1; else full=""; fi
if [ "${BATTLE_E2E:-}" != "1" ]; then
  echo "3D table gate: browser tests skipped on a push; they run when a version is shipped (pnpm table:ship)."
  specs=""
  full=""
fi
if [ -z "$specs" ] && [ "${BATTLE_E2E:-}" = "1" ]; then
  echo "3D table gate: no browser test can be affected by this change."
fi
if [ -n "$specs" ]; then
  # Wait for our turn: `mkdir` either makes the lock or finds it taken, in one step.
  lock="${BATTLE_E2E_LOCK:-${LOCALAPPDATA:-$HOME}/mc-push-check/battle-e2e.lock}"
  mkdir -p "$(dirname "$lock")"
  me="$(cat /proc/$$/winpid 2>/dev/null || echo $$)"
  waited=0
  while ! mkdir "$lock" 2>/dev/null; do
    holder="$(cat "$lock/owner" 2>/dev/null || true)"
    pid="${holder%% *}"
    age=$(( $(date +%s) - $(stat -c %Y "$lock" 2>/dev/null || date +%s) ))
    alive=""
    if [ -n "$pid" ] && tasklist //FI "PID eq $pid" 2>/dev/null | grep -q " $pid "; then alive=1; fi
    if [ -z "$alive" ] && [ "$age" -gt 20 ] || [ "$age" -gt 1800 ]; then
      echo "3D table gate: taking over a stale browser-test lock (${holder:-no owner}, ${age}s old)."
      rm -rf "$lock"
      continue
    fi
    if [ $((waited % 60)) -eq 0 ]; then
      echo "3D table gate: waiting for another checkout's browser tests to finish (${holder#* })..."
    fi
    sleep 5
    waited=$((waited + 5))
  done
  echo "$me $root" > "$lock/owner"
  trap 'rm -rf "$lock"' EXIT INT TERM

  # A port nobody is listening on, for the reason the e2e gate gives: a dev server left running by another checkout
  # would have the specs test that checkout's code.
  port="$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})')"
  report="$(mktemp -t battle-gate.XXXXXX)"
  trap 'rm -f "$report"; rm -rf "$lock"' EXIT INT TERM

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

# Remembered only when every browser test ran: a narrowed run vouches for this change, not for the code as a whole.
[ -n "$full" ] && echo "$key" >> "$stamps"
echo "3D table gate: passed."
