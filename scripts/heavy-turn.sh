#!/usr/bin/env bash
# Run one heavy command (a push with its check, the type check, a whole test run) while holding this PC's turn, so
# several sessions' heavy runs never overlap. Two at once run a 16 GB PC out of memory: the dev server dies and every
# test after it fails in under a second.
#
#   bash scripts/heavy-turn.sh git push super-state my-branch
#   bash scripts/heavy-turn.sh pnpm battle:check
#
# The turn is a folder made with `mkdir` (it either makes it or finds it taken, in one step), shared by every checkout
# and worktree on the PC. A turn held for over 25 minutes is taken to be abandoned. The browser tests keep their own
# lock (.githooks/battle-gate.sh); this one is for everything else that is heavy.
set -u
lock="${HEAVY_TURN_LOCK:-${LOCALAPPDATA:-$HOME}/mc-push-check/heavy-turn.lock}"
mkdir -p "$(dirname "$lock")"
told=0
until mkdir "$lock" 2>/dev/null; do
  age=$(( $(date +%s) - $(stat -c %Y "$lock" 2>/dev/null || date +%s) ))
  if [ "$age" -gt 1500 ]; then
    echo "heavy-turn: taking over a turn held for ${age}s." >&2
    rmdir "$lock" 2>/dev/null
    continue
  fi
  if [ "$told" -eq 0 ]; then
    echo "heavy-turn: waiting for another session's run to finish..." >&2
    told=1
  fi
  sleep 15
done
trap 'rmdir "$lock" 2>/dev/null' EXIT INT TERM
"$@"
