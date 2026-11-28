---
name: new-content
description: Bring a new portion of Marvel Champions onto the 3D table (a hero, a villain or scenario, a modular set, a single card or a new mechanic) in two passes, rules then presentation. Pass one checks every card against the rules and its printed text. Pass two is the visual information designer's - for everything that changes in the game, does the table show the player what happened, why, and what it means for their next move, in the same visual language the table already uses? It finds the mechanics a pack brings that the table has never had to show. Use whenever adding, auditing or re-checking a hero, villain, scenario, module or card on the 3D table ("add Captain America", "bring in the Wrecking Crew", "check Green Goblin again", "did we miss anything on Ultron"), and before calling any such work done.
---

# Adding a portion of the game to the 3D table

"The rule works, but did the table show the player what happened?" (Adam, 2026-11-28). A portion is done when both
passes are done. The second matters most: a rule the player can't see happening is, to them, a bug or a cheat.

Green Goblin went in with only the first pass. Its rules were right; Criminal Enterprise swapped to State of Madness
with no turn, the villain was still called Norman Osborn in questions, and three of its cards change what the player
can do without a word on the table. [`ledgers/green-goblin.md`](ledgers/green-goblin.md) is that pack's ledger and the
worked example of this skill.

| File                                         | What it is                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SKILL.md` (this)                            | The two passes and what "done" means.                                                                                      |
| [`failure-patterns.md`](failure-patterns.md) | The thirteen ways the table has gone wrong so far, from players' reports and every fix: run each portion past all of them. |
| [`visual-language.md`](visual-language.md)   | How the table already shows each kind of thing: reuse before inventing.                                                    |
| `new-mechanics.sh`                           | Lists what a pack's card scripts use that no pack on the table uses yet.                                                   |
| `audited-packs.txt`                          | The packs whose passes are finished (what the script compares against).                                                    |
| `ledgers/<pack>.md`                          | One per pack: what it brought that was new, how each is shown, what is open.                                               |

## Before either pass: what is in it, and what is new

1. **The card list comes from the data, never from memory**: `packages/content/src/data/<pack>/cards.ts`, by
   `setCode` and `encounterSetIds`. Count them. Include the cards that are easy to skip because they are never dealt:
   the villain's every stage and side, the main scheme's every stage, environments, set-aside cards, nemesis sets,
   obligations.
2. **What is new here**: `bash .claude/skills/new-content/new-mechanics.sh packages/cards/src/<wave>/<pack>`. Every
   line is a mechanic the table has never shown. Then read the pack's data for what scripts don't say: a card type, a
   keyword, a counter name, a two-sided card (`flipSide`), a set-up instruction, a win or loss condition of its own.
3. **Start the ledger** (`ledgers/<pack>.md`, copy Green Goblin's headings) with that list. Every line of it ends
   with one of: _shown as_ (an existing treatment), _designed_ (a new one, with a picture), _open_ (not yet).

## Pass one: the rules

The game must play by the real rules; the engine decides every outcome and the table only shows it.

- **Each card against its printed text and the Rules Reference**, in each form or side it reads differently (hero and
  alter-ego form, each villain stage, each face). Ask the `rules-expert` agent before asking Adam a rules question;
  the order of authority is in the project's CLAUDE.md.
- **A deck audit per set** (`packages/client/src/battle-table/deck-audit-<pack>-*.test.ts`, beside the Goblin ones):
  each test makes one card happen, then checks the engine's outcome and the beat that shows it. Plus a sweep that
  reveals every encounter-deck card in both forms.
- **Causes and chains**: what triggers what, in which order, and what happens when the usual target isn't there
  ("if you cannot", an empty deck, no minion to choose, the last counter).
- A rules or card-script bug goes to `ability-scripting-engineer` or `game-rules-architect`; `rules-qa-engineer`
  writes the regression test. Don't work around an engine bug on the table.

## Pass two: the visual information designer

For **every** thing the portion can make happen, answer three questions as the player:

1. **What changed?** Which card, counter, number or place is different now.
2. **Why?** Which card or rule did it, and what set it off.
3. **So what?** What can I do, or no longer do, because of it.

Then check each against the table, and run the portion past every pattern in
[`failure-patterns.md`](failure-patterns.md): they are what players and Adam have actually caught, and most new gaps
are an old pattern on a new card.

### a. Things that change the game (the watcher finds these)

Every driven game runs under `shown-check.ts`. For each change to a card it says how the change reached the table:

- **played**: a beat of the right kind names the card (a flip turns the card over, a counter rings and floats).
- **borrowed**: some other beat on the same card got the credit. This is how the flip was missed: the "-1 infamy"
  beat on Criminal Enterprise counted for its turning over.
- **repainted**: no beat at all; the card's picture is simply different afterwards. A teleport, unless the table
  animates that kind of change by itself.

Run the pack's audits and read the list:

```bash
SHOWN_OUT=/some/empty/folder bash scripts/heavy-turn.sh bash -c \
  "cd packages/client && pnpm exec vitest run src/battle-table/deck-audit-<pack>"
```

Each shard's `unplayed` is that pack's borrowed and repainted changes; `rows` has what was silent or words only;
`unclassified` is engine events the watcher has no rule for (a new event type: give it a rule in `EVENT_RULES`, never
`state()` or `book()` just to quiet it). Every entry is either fixed (give it a beat of its own kind) or proved
harmless in the browser and then recorded: `SHOWN_PLAYED=update pnpm exec vitest run src/battle-table/<file>.test.ts`
writes `shown-baseline/<file>.played.json`, and from then on a new one fails that file.

### b. Things that stop, change or repeat something (the watcher cannot find these)

A standing rule changes nothing when it arrives and the engine reports nothing when it bites: "cannot ready",
"cannot change form", "resolve it 1 additional time", "instead", "+1 for each", "while". The player just finds a
button gone or a number wrong. **Go through the pack's text for these words by hand** (the script's `cannot…`,
`repeat…`, `constant`, `rule(` lines point at them) and for each one ask what the player sees:

- when it arrives: is the restriction stated on the card it restricts (a pill on its plate, as Guard has)?
- when it bites: does the table say so at that moment, naming the card ("Spider-Man stays exhausted: All Tied Up")?
- when something the player expects is missing (a move, a ready, a draw): is the reason one glance away?
- how to get rid of it: is the way out reachable from the card itself?

### c. Names, questions and numbers

- Every name is the face that is up now (Green Goblin, not Norman Osborn; the scheme's current stage).
- Every question says who is asking and what each answer does, in the card's own words.
- Every number on the table equals the game's (the browser tests fail on "[table drift]").

### d. In line with how the table already does it

Before designing anything, find the nearest thing the table already shows and use that
([`visual-language.md`](visual-language.md); the full list is `BEAT_FIELDS` in `shown-check.ts`). A second side card
turns over exactly as the first does. Design something new only when nothing fits, and then:

- sketch it on one card, in a debug scene, and **show Adam a screenshot before building it across cards**;
- add it to `visual-language.md`, so the next pack reuses it.

### e. Prove it in the browser

The watcher reads the model; only the browser shows what the player sees.

- A debug scene per new mechanic (`debug-scenes.ts`, `?scene=<name>`), so it is one move away.
- Watch it happen (your own dev server from your worktree, the `claude-player` skill's hook to drive it) and take a
  screenshot.
- A browser test that measures it, not just its words: `packages/client/e2e/battle-env-flip.spec.ts` watches every
  card every frame through a flip and fails if a picture changes without a turn (`table.pieceNow`).
- Play one whole game of the portion with `claude-player`: some gaps only show several turns in (the flip back).

## Done means

- [ ] Every card of the portion is in an audit, in each form and side it reads.
- [ ] The ledger lists everything new, each line _shown as_, _designed_ or _open_; nothing unlisted.
- [ ] The watcher's `unplayed`, silent, words-only and `unclassified` lists for the pack are empty or recorded with
      the reason.
- [ ] Every standing rule (b) has its three moments looked at.
- [ ] Each of the failure patterns has been asked of the portion, and the answer is on the ledger.
- [ ] A debug scene and a browser test for each new mechanic; one whole game played.
- [ ] Each new mechanic's check has been seen to fail: its beat dropped on purpose once, and a test went red.
- [ ] The pack's folder is added to `audited-packs.txt`.
- [ ] Anything _open_ is on the ledger with what it needs, and Adam has been told in plain words.

**Afterwards, whenever a player report or one of Adam's spots is fixed:** add the case to its pattern in
`failure-patterns.md` (or write the new pattern), and add the check that would have caught it.

Each fix ships on its own (the project's rule): the ledger and audits first, then one presentation fix per pull
request, each looked at in the browser.
