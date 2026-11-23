---
name: claude-player
description: Claude plays the 3D Marvel Champions table itself (Spider-Man vs Rhino and any later matchup) through the page's play hook in Surf, with Adam watching, then condenses what the game taught into a lessons file that every later game starts from. Use whenever Adam asks Claude to play, playtest or have a go at the 3D table ("play a game", "have a game against Rhino", "playtest the new card", "see if you can win"), and after every such game.
---

# Claude plays the 3D table

Two files, both next to this one:

| File                       | What it is                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SKILL.md` (this)          | How to play: set-up, the hook, driving it, and what to do after a game.                                                                |
| [`lessons.md`](lessons.md) | What playing has taught: a short playbook plus one line per recent game. Read it before every game; condense into it after every game. |

## Before the game

1. **Read [`lessons.md`](lessons.md)** and pick one thing from "Try next" to test this game. Say which in a line.
2. **A table of your own.** Adam's table (port 5173, the main folder) reloads by itself whenever any session merges a
   fix, which restarts a game in progress (game 6 was wiped in round 4). So play on a frozen copy: from the main
   folder, `git worktree add --detach ../mc-wt-play HEAD`, `pnpm install` in it, then start its dev server in the
   background on a port of its own: `pnpm --filter @mc/client exec vite --port 5240 --strictPort`. Card pictures
   come from the main folder's scans (they aren't in git; a copy's dev server falls back to them). Afterwards stop
   that server and remove the copy (`git worktree remove --force ../mc-wt-play`).
3. **Show it in Surf's game mode, never a plain tab:** `surf_game_open` with name **"Marvel Champions (Claude
   plays)"** and url `http://localhost:5240/battle/?remote` (load the tool with ToolSearch; call it again if it says
   the page didn't load because the server wasn't up yet). Its own name leaves Adam's own "Marvel Champions" game tab
   alone. `?remote` makes the page take moves from the dev server; `&seed=N` deals a fixed game.
4. **Drive it from the terminal** (the browser tools can't reach the Games bubble): each call below is a plain
   request to the dev server, which the page answers through its play hook. Start with `call=wait`.

## The hook (`packages/client/src/battle-table/play.ts`, relayed by `packages/client/vite-battle-play.ts`)

| Call (Bash)                                                          | Does                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `curl -s -G localhost:5240/__battle-play --data-urlencode call=look` | The table in words: what happened since the last look, round, phase and form, every card with its stats, rules text and statuses, the hand and hand size, the turn bar question and moves. |
| `… --data-urlencode call=moves`                                      | Just the moves, one `n. label` per line.                                                                                                                                                   |
| `… --data-urlencode call=play --data-urlencode "move=Keep hand"`     | Makes the move whose words match (exact first, then contains) or its number, waits for the table to settle, answers `You: <move>` plus a fresh look.                                       |
| `… --data-urlencode call=wait`                                       | Waits through the villain phase or a card in flight, then looks.                                                                                                                           |

In the page itself the same calls are `__battlePlay.look()`, `.moves()`, `.play()` and `.wait()` (browser tests).

Every move presses the same thing a click does, so the engine decides every outcome and Adam sees it happen.

## Playing

- **One decision per call**, and tell Adam each one in a plain line before you make it ("Rhino's on 4: Web Kick
  finishes his first stage"). Group only mechanical steps (paying for a card you've just said you'll play).
- **Choose moves from `moves()` labels, never from a look's text.** A look starts `You: <the move just made>`, so
  testing it for a move's words matches the move already made (on 2026-11-23 a loop on "Continue (after" pressed one
  move too many and started a card). Never loop on move numbers without re-reading `moves()`.
- Think like a player: read the scheme's threat against its target, count what the villain phase will add (main
  scheme step, each scheming enemy, boosts), count the damage coming if you stay in hero form, and plan the turn
  before the first move.
- **Bugs.** If the table does something the rules or the card text don't allow, stop, take a screenshot, and tell
  Adam what you saw and why it's wrong (ask the `rules-expert` agent if unsure). A wording slip in the hook's text
  (only Claude reads it) is not a game bug: note it and fix it after the game.
- At the end, leave the game on its final screen in Games; close it (`surf_games` close) only when Adam is done.

## After every game: condense into `lessons.md`

The point is a playbook that gets better with every game and stays short. Keep only what could only be known
from having played: what happened, what worked, what didn't, how the encounter deck or a card actually behaves
over a game, and what to try next. Leave out anything that reading the card text or the rules already tells you.
Read the whole `look()` after every villain phase, the statuses on your side included: a status that arrived in that
phase changes what your next move does (game 6 was lost to a Kick fired while stunned).
If a mistake came from misreading a rule or a card (a form-only card, a status, a limit), fix how `look()` describes
it in `play.ts` instead, so no later game has to remember it, and ship that with the lessons.

1. **Add one line under "Recent games"**: date · hero (aspect) vs villain · won/lost, round, how · the one thing
   that decided it. Keep the last 10 lines; older ones go once their lesson is in the playbook.
2. **Fold the game into the playbook.** For each lesson this game taught: if the playbook already has it, raise
   its count (`seen 2×`) or sharpen its wording; if this game contradicted it, fix it or delete it; if it's new, add
   it as `seen 1×`. Merge near-duplicates. A lesson seen once is a hunch; say so.
3. **Update "Try next"**: drop what this game tried (its result is now a lesson), add what this game suggests.
4. **Prune.** The playbook stays under about 40 lines. When it's longer, cut the weakest hunches and anything
   that has become obvious.
5. **Ship it** (standing rule: every change ships): from a worktree off `feature/three-dimensional-tabletop`,
   commit `lessons.md` (plus any hook fix), push to `super-state`, open a PR, merge it, then
   `git -C <main folder> pull --ff-only`. A change to `.claude/` only runs no push checks.
6. Tell Adam the result in his wrap-up style: one line on how it went, a few bullets on what was learned, and what
   gets tried next time.
