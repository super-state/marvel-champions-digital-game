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
2. **The table.** Adam's table is the dev server on port 5173, run from the main folder (on this PC
   `C:\Users\denby\Projects\marvel-champions-digital-game`; on the desktop PC `D:\AdamsWorkspace\mc`). If nothing
   answers on `http://localhost:5173/battle/`, start it from the main folder in the background:
   `pnpm --filter @mc/client exec vite --port 5173 --strictPort`. The hook exists only on the dev server.
3. **Open it in your own Surf tab so Adam can watch:** `browser_navigate` to `http://localhost:5173/battle/`
   (task "Claude plays Marvel 3D"), then **`browser_show` straight away**. Adam wants to watch the cards move; a
   game played in a background tab is no use to him. (Surf's Games bubble can't be driven by the browser tools, so it
   is your own tab, shown.) `?seed=N` deals a fixed game, for replaying one.
4. Wait for the hook: `async () => { for (let i=0;i<100 && !globalThis.__battlePlay;i++) await new Promise(r=>setTimeout(r,300)); return globalThis.__battlePlay.wait(); }`

## The hook (`packages/client/src/battle-table/play.ts`)

| Call (in `browser_evaluate`)           | Does                                                                                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__battlePlay.look()`                  | The table in words: what happened since the last look, round and phase, every card with its stats and rules text, the hand, the turn bar's question and the numbered moves. |
| `__battlePlay.moves()`                 | Just the moves, `[{ n, label }]`.                                                                                                                                           |
| `await __battlePlay.play("Keep hand")` | Makes the move whose words match (exact first, then contains) or the number, waits for the table to settle, returns `You: <move>` plus a fresh look.                        |
| `await __battlePlay.wait()`            | Waits through the villain phase or a card in flight, then looks.                                                                                                            |

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
- At the end, leave the tab on the final screen in front of Adam; close it only when he's done.

## After every game: condense into `lessons.md`

The point is a playbook that gets better with every game and stays short. Keep only what could only be known
from having played: what happened, what worked, what didn't, how the encounter deck or a card actually behaves
over a game, and what to try next. Leave out anything that reading the card text or the rules already tells you.

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
