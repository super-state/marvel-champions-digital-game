# Marvel Champions: the 3D table

## What this project is

Our own project (Adam, GitHub `super-state/marvel-champions-digital-game`): Marvel Champions played on a 3D tabletop
built with three.js. It started as a fork of Quin Carter's 2D game and keeps that game's rules engine and cards. It is
fan-made and non-commercial; Marvel Champions, its card text, artwork and characters belong to Fantasy Flight Games
and Marvel.

| Part                 | Where                                                                                | What to do with it                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| The 3D table         | `packages/client/src/battle-table/`, page `packages/client/battle/index.html`        | This is what we build. Almost all work happens here.                                                          |
| Rules and cards      | `packages/engine`, `packages/content`, `packages/cards`                              | Keep. The 3D table runs on them. Change them only to fix a bug the 3D table hits, never to restyle or rework. |
| The old 2D game      | the rest of `packages/client/src`, `packages/client/e2e`                             | Going away over time. Build nothing new in it and don't polish it.                                            |
| Other platform parts | `packages/sync-worker`, `packages/mod-sdk`, desktop and phone wrappers, the websites | Leave alone unless asked.                                                                                     |

The 3D table still borrows about 255 files from the old 2D game (mostly `packages/client/src/view/`), so the old game
can't be deleted yet. Avoid adding new imports from it: each one is something to untangle later. Game state lives only
in the engine; the 3D table shows it and sends the player's choices back, it never decides an outcome itself.

## Run, test, push

- `pnpm battle` starts the dev server and opens the 3D table. In the Claude app, start the `battle-table` preview and
  go to `/battle/`.
- `pnpm battle:test` runs the 3D table's own tests (under a minute). Run this after a 3D change, not `pnpm test`, which
  runs the whole old game.
- `pnpm battle:check` is the type check plus those tests. It is what a push runs.
- The push check (`.githooks/pre-push`) picks by what the push changes:
  - only the 3D table and its browser tests: `pnpm battle:check`, then those browser tests;
  - rules, cards or the old 2D game: the old game's full browser suite (`pnpm e2e:verify`), because those changes can
    break screens the 3D tests never open;
  - anything else (docs, scripts, a new font or picture added under `packages/client/public/`): nothing.
  - `PUSH_GATE_DRY_RUN=1 git push …` says which check a push would get without running it or pushing.
  - Both checks test the files on disk, so they refuse while `packages/` has uncommitted edits. Don't push past a
    failure with `--no-verify`; fix it.
- A browser test of the 3D table goes in `packages/client/e2e/` with `battle` in its file name
  (`battle-controller.spec.ts`): that name is how the push check finds it. The old game's other browser tests never
  open the 3D table.
- Look at a visual change in the browser before calling it done, and show a screenshot.
- Tests run silently.

## Git

- `super-state` is our GitHub copy: push there and open pull requests there
  (`gh pr create -R super-state/marvel-champions-digital-game`). Our main line is the branch
  `feature/three-dimensional-tabletop`, and pull requests target it.
- `origin` is the original project and is read-only for us: never push or open a pull request there. Bring in its
  new cards or fixes (`origin/main`) only when Adam asks; it is optional, not a duty.
- Commit under this PC's own git name. Don't set a name for this repo, and don't sign commits as Quin Carter (Adam,
  2026-11-21: "we don't need to be Quin Carter, this is our own project"). The `commit-msg` hook removes tool credit
  lines from commit messages; leave it.
- Work in your own worktree and check nobody else is mid-edit on the same files: `main.ts` and `table.ts` in the 3D
  table are large and often open in another session.

## Rules questions

The game must still play by the real rules. Where sources disagree, follow this order and say so in a code comment:

1. The latest Rules Reference (v1.8, [docs/rules/mc_rulesreference_v18_compressed.pdf](docs/rules/mc_rulesreference_v18_compressed.pdf)).
2. Current official errata, for individual cards.
3. FFG rulings issued after v1.8 ([docs/rulings/](docs/rulings/README.md)).
4. Older FFG rulings, where they agree with v1.8.
5. Our own reading, only where no official source answers.

Ask the `rules-expert` agent before asking Adam a rules question.

## The original project's rules

[docs/project/original-project-rules.md](docs/project/original-project-rules.md) is the rule sheet this repo had
before the fork: how cards are scripted, how its agents split work, its changelog notes, review routine, screenshot
sizes and screen conventions. Read it before changing the rules engine, card scripts or an old 2D screen. For 3D
table work none of its routine is required: no changelog note per change, no reviewer pass per piece, no second
review tool, no five-size screenshots. [PLAN.md](PLAN.md) is the original project's roadmap, not ours.
