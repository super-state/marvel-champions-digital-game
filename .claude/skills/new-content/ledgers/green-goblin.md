# The Green Goblin (scenario pack): ledger

Run on 2026-11-28, after the pack was already live (it went in with pass one only: PRs 258 and 261). This is the
second pass, done late, and the worked example for the skill.

**What is in it** (from `packages/content/src/data/gob/cards.ts`): two scenarios, Risky Business (Norman Osborn /
Green Goblin, two-sided, three stages; Hostile Takeover; Criminal Enterprise / State of Madness) and Mutagen Formula
(Green Goblin, three stages; Unleashing the Mutagen), and four modular sets (Goblin Gimmicks, A Mess of Things, Power
Drain, Running Interference). 38 encounter-deck cards.

**Audits:** `deck-audit-goblin-risky`, `-mutagen`, `-modules` (190 tests, card by card) and `-sweep` (every
encounter-deck card revealed in both forms). 267 tests pass.

## What the pack brought that the table had never shown

From `new-mechanics.sh packages/cards/src/wave1/gob packages/cards/src/core`, plus the data.

| New here                                                                  | Cards                                                     | On the table                                                                                                                                           |
| ------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A side card that turns over (`flipCard`, `stateCheck`, `flipSide`)        | Criminal Enterprise / State of Madness                    | **Shown as** the villain's flip: called out, turned over where it lies, new counters after. Fixed in PR 269; measured both ways in PR 271.             |
| A villain that flips back and forth, not only forward                     | Norman Osborn / Green Goblin                              | **Shown as** the villain's flip. Named by the side up in questions since PR 271.                                                                       |
| Named counters taken off (`removeCounters`)                               | Criminal Enterprise, State of Madness                     | **Shown as** a counter change: the card rings, "−1 infamy" floats, the token lifts off with its last counter (PR 269).                                 |
| An interrupt of the villain's own that replaces damage or a scheme        | Norman Osborn, Green Goblin                               | **Shown as** an interrupt: stamped Forced Interrupt, what it stops stamped Interrupted (PR 267).                                                       |
| Indirect damage (`dealIndirectDamage`)                                    | Green Goblin's When Revealed, Pumpkin Bombs, others       | **Shown as** damage: the strike and burst on the hero. How it is split when an ally is out has not been looked at (3 below).                           |
| Encounter cards discarded off the deck, counted (`discardEncounterCards`) | Power Drain's set, Wicked Ambitions, both When Completeds | **Shown as** a mill: the top cards turn up and go to the discard pile, the card that did it named. The count ("Count boost icons · +3") is words only. |
| A main scheme's When Completed                                            | Hostile Takeover, Unleashing the Mutagen                  | **Shown as** the stage advancing, the discard credited to the stage that completed (PR 261).                                                           |
| A boost card that acts at the end of the activation (`atEndOfActivation`) | Goblin Knight, Monster, Goblin Soldier, Goblin Thrall     | **Shown as** a card entering play, or shown and shuffled into the encounter deck (PR 261).                                                             |
| An encounter attachment on the player's own identity                      | All Tied Up, Media Coverage                               | **Shown as** an attachment: revealed, flies on ("equip" flight, measured), tucked beside the hero with its Action in its menu (PR 261).                |
| "Cannot ready" (`cannotReady`)                                            | All Tied Up                                               | **Open.** See 1 below.                                                                                                                                 |
| "Cannot change form" (`cannotChangeForm`)                                 | All Tied Up                                               | **Open.** See 1 below.                                                                                                                                 |
| A When Revealed resolved again (`repeatWhenRevealed`)                     | Media Coverage                                            | **Open.** See 2 below.                                                                                                                                 |
| The villain heals                                                         | Regenerative Healing, Shock Therapy                       | **Shown as** healing: the number floats green off the villain. Checked in the model only: look at it in the browser (3 below).                         |

## Open: what the table still doesn't tell the player

All three are failure pattern 6 (a rule stops, changes or repeats something and nothing says so). The watcher cannot
see any of them: the engine reports nothing when a standing rule bites.

1. **All Tied Up gives no reason.** With it on Peter Parker, "Change to Spider-Man" is simply gone from the turn; on
   Spider-Man, the hero phase begins and he is still exhausted. The beats of that villain phase end "Hero Phase" with
   no word about it. The card is there, tucked beside the hero, but nothing connects it to what is missing.
   _Proposed, in the table's existing language:_ a pill on the hero's plate while it is attached, as Guard has on a
   minion ("Tied up: can't ready or change form"); at the start of the hero phase, a beat on the hero when a ready
   was stopped ("Spider-Man stays exhausted: All Tied Up", the card marked); the form change kept in the menu but
   barred, saying why, as a Guarded villain says why it can't be attacked. New pieces: the pill's icon and the barred
   menu row, so one screenshot to Adam before it is built.
2. **Media Coverage's repeat is anonymous.** A Mess of Things "gains 2 threat" twice running and nothing names Media
   Coverage or says the When Revealed is resolving again. _Proposed:_ before the second resolution, the stamp the
   table already uses for an ability activating, on Media Coverage ("Again: Media Coverage"), and the revealed card
   flashing for its When Revealed a second time.
3. **Not yet looked at in the browser:** the villain healing (Regenerative Healing, Shock Therapy), indirect damage
   split between the hero and an ally, and Goblin's busiest table (Goblin Nation with several minions and both side
   schemes: failure pattern 10). Each needs a debug scene.

## The watcher's lists for this pack

- Silent, words only, engine events with no rule: none.
- Changes not played out by a beat of their own kind: one, known and recorded (`shown-baseline/*.played.json`). A
  player card played from the hand (01059) has no beat; the table flies it from the hand to its place itself.
- Before the watcher was tightened (2026-11-28) it reported this pack fully shown while the flip swapped in place.
  It now compares which side of a card is up and gates all four Goblin audit files on anything new that is borrowed
  or repainted. Proved by undoing the flip fix: the risky audit fails with "02006a | side | borrowed".
- The sweep never reveals All Tied Up itself (it is used as the quiet boost card, and is taken as one in its own
  game); the modules audit covers it. To fix in the sweep.

## Done?

- [x] Every card in an audit, both forms.
- [x] Everything new listed.
- [x] The watcher's lists empty or recorded.
- [ ] Every standing rule's three moments (1 and 2 open).
- [ ] A debug scene and browser test for each new mechanic (the flip: yes; `tiedup`: scene only; the rest: no).
- [ ] One whole game of each scenario played since the fixes (Risky Business: a partial game, both flips seen;
      Mutagen Formula: not played).
