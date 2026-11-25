#!/usr/bin/env bash
# Regenerates docs/project/core-set-shown.md (does the table show everything every Core Set card does?) and the
# watcher's baselines (packages/client/src/battle-table/shown-baseline/): plays the fuzz and the deck audits under
# shown-check.ts, then writes the page from what they saw. Heavy: run it through the lock,
#   bash scripts/heavy-turn.sh bash scripts/core-set-shown.sh
# The fuzz's game counts can be raised as usual (FUZZ_GAMES=50 ...); the page is written from whatever ran.
set -euo pipefail
cd "$(dirname "$0")/../packages/client"
out="$(mktemp -d "${TMPDIR:-/tmp}/core-set-shown.XXXXXX")"
SHOWN_OUT="$out" SHOWN_BASELINE=update VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-2}" \
  pnpm exec vitest run src/battle-table/battle-fuzz.test.ts src/battle-table/deck-audit-
SHOWN_IN="$out" pnpm exec vitest run src/battle-table/core-set-shown.test.ts
echo "core-set-shown: docs/project/core-set-shown.md and the baselines written (shards in $out)"
