# Ultron (Core Set scenario, with Under Attack): ledger

Run on 2026-11-28, long after the scenario went live (0.2.0, PR 115). All four player reports so far came from Ultron
games; each was fixed as it came in. This is the first time the scenario has been gone through whole.

**What is in it** (from `packages/content/src/data/core/cards.ts`, sets `ultron` and `under_attack`): Ultron, three
stages (I and II in a standard game, II and III in an expert one); the main scheme's three stages (The Crimson Cowl,
Assault on NORAD, Countdown to Oblivion); the Ultron Drones environment; 14 more Ultron cards (2 attachments, the
Advanced Ultron Drone, 5 treacheries of which Android Efficiency is three printings, 3 side schemes); and Under
Attack's 4 (a side scheme, 2 attachments, a treachery). 19 different cards in the data.

**Audits:** `ultron-scenes.test.ts` (26 driven scenes, card by card) and `battle-ultron.spec.ts` in the browser. Good
cover of the standard game. Not under the watcher (`shown-check.ts`): it uses its own driver. **Ultron (III) was in no
test and no watched game**: the Core ledger lists `01136.ultron-constant` and `01139b...constant` as "never fired".

## What Ultron brought that Rhino and Klaw had not

From `new-mechanics.sh packages/cards/src/core/scenarios/ultron.ts` against Rhino, Klaw, the standard set and the
heroes, plus the data.

| New here                                                             | Cards                                                                | On the table                                                                                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A player's card put into play facedown as a minion (`droneFromDeck`) | Ultron I and II, every scheme stage, Android Efficiency, 5 others    | **Shown as** a Drone: the card leaves the deck facedown, crosses the table and stands in the villain's row; named only when defeated (`droneIn`, `droneWas`). |
| An environment that sets what those cards are                        | Ultron Drones                                                        | **Shown as** the Drone's own stand-in card with its 1 / 1 / 1.                                                                                                |
| An attachment on the environment, not the villain                    | Upgraded Drones                                                      | **Shown as** an attachment, tucked on Ultron Drones; each Drone wears +1 ATK and +1 HP tokens, and a Drone arriving is seen getting them.                     |
| A question between two harms (`chooseOneBy`)                         | Ultron I, Assault on NORAD, Android Efficiency's boost, Under Attack | **Shown as** a Choose-one that keeps the cards it would change in focus (issue 210, PR 214); a spend is asked in two steps with its symbols (issue 217).      |
| Threat that cannot be removed (`threatCannotBeRemoved`)              | Countdown to Oblivion                                                | **Shown as** a lock on the scheme's threat pill; the hero's menu says why Thwart is missing.                                                                  |
| A villain that **cannot take damage** while something is in play     | Ultron (III)                                                         | **Designed** (2026-11-28): a lock on his plate with the rule's words; the attack pick is asked and says why he is out of reach, as Guard's does.              |
| The villain **gains a keyword** from an attachment (Retaliate 1)     | Concussion Blasters                                                  | **Designed** (2026-11-28): a Retaliate pill on the plate; the hit back is stamped \"Retaliate\" with \"Concussion Blasters\" under it.                        |
| A status given by an attachment's response                           | Vibranium Armor                                                      | **Designed** (2026-11-28): the status stamp names the card that gave it (\"Tough\" over \"Vibranium Armor\"), which rings.                                    |
| The villain's ATK raised for one attack by what is in play           | Ultron (II)                                                          | **Shown as** a stat token on Ultron for the attack, taken off after (`ultron-scenes`, "ultronstage").                                                         |
| A "when revealed" with a hero half and an alter-ego half             | Rage of Ultron, Swarm Attack                                         | **Shown as** the half that applies; "No hero" stamped when Swarm Attack has no hero to attack (issue 222).                                                    |
| The villain heals by what is in play                                 | Repair Sequence                                                      | **Shown as** healing floating off Ultron, or Surge when nothing was healed. Model only: not looked at in the browser.                                         |
| Cards discarded off the player's deck for each damage                | Rage of Ultron, Invasive AI                                          | **Shown as** a mill, naming the card that did it and each card discarded.                                                                                     |
| A stage that ends the game when completed                            | Countdown to Oblivion                                                | **Shown as** the defeat panel.                                                                                                                                |
| Many minions at once                                                 | every Drone card                                                     | **Shown as** two rows either side of the villain, the encounter piles shrinking to the corner (PRs 100, 113, 118, 219). Scenes `ultroncrowd`, `ultronpiles`.  |

## Fixed on 2026-11-28

Each is built from the engine's rules and events, not Ultron's card names, so every card that does the same thing
gets it: any villain a rule keeps from damage, every character with Retaliate, every status given by another card.

1. **Ultron (III) can't be hurt, and nothing said so.** Now: a lock on his plate with his rule's own words ("Ultron
   cannot take damage while a Drone minion is in play."); the attack pick is asked even when a Drone is the only
   enemy that can be hurt, with that sentence under the question and Ultron stamped "Can't be hurt" when pointed at
   (`BattleChoice.guard.why`, the same pick Guard uses). Scene `ultronthree`, the first test of stage III.
2. **Retaliate was never named.** Now: a Retaliate pill with its amount on the plate of any character that has it
   (`BattleCard.retaliate`); the hit back reads "Ultron retaliates: 1 damage to Spider-Man" and is stamped
   "Retaliate" with the card giving it under it (`hit.retaliate`). Scene `ultronarmor`.
3. **Vibranium Armor wasn't named.** Now: a status stamp carries the card that gave it when that is another card
   ("Tough" over "Vibranium Armor"; "Stunned" over "Mockingbird"), and that card rings (`BattleBeat.statusBy`).
4. **Program Transmitter did nothing, silently.** Now: an encounter card's forced ability that comes up with nothing
   to do is stamped "Nothing to do" (`BattleBeat.idle`).
5. **Not a gap on the table: three "Drone" answers.** A card on the table is picked by clicking it, not from a
   button, so the player chooses the Drone they mean. Only the play hook's text lists three identical words.

Also: a villain's rules text is read from its stage (the play hook and the card facts had none for any villain).

## Open: not yet looked at in the browser

Ultron (III)'s When Revealed (search for Ultron's Imperative, shuffle: the Core ledger has "a deck shuffled" as
silent for it), Repair Sequence's heal, and an expert game played whole. `ultron-scenes.test.ts` is still not run
under the watcher.

## The watcher's lists

- Unknown engine events: none.
- Silent in the probe games: Program Transmitter with no side scheme (5 above).
- Changes not played out by their own kind of beat: a Drone changing sides as it enters and leaves, credited to its
  arrival and defeat beats. Those are its own beats; the watcher's map now says so.
- `ultron-scenes.test.ts` is not watched, so it is not gated on any of this. To do: run it under `watchThisFile`.

## Failure patterns, asked of Ultron

| Pattern                                 | Answer                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Question hides what you need         | Fixed after issues 210, 217. Under Attack's question (2 threat or 3 damage): not looked at.   |
| 2. Question doesn't say who or what     | Not a gap: the Drone is picked on the table (5).                                              |
| 3. The game chose for the player        | Fixed: Ultron (III)'s attack pick is asked (1).                                               |
| 4. In the game, not drawn               | None found.                                                                                   |
| 5. Change with no movement              | None found in the probe games; the scenes file is unwatched.                                  |
| 6. A rule stops something, nothing said | Fixed: Ultron (III), Retaliate, Program Transmitter (1, 2, 4).                                |
| 7. Wrong number mid-move                | Fixed (PRs 185, 192: the 8/10 report).                                                        |
| 8. Name from the wrong moment           | A Drone is "Drone" until defeated, then named: right. Retaliate's hit reads as an attack (2). |
| 9. Wrong order                          | Fixed for the aim (PR 224). An expert game not watched.                                       |
| 10. Table can't hold it                 | Fixed (`ultroncrowd`, `ultronpiles`).                                                         |
| 11. No hero, other form branches        | Fixed for Swarm Attack (issue 222). Rage of Ultron both halves: in the scenes.                |
| 12. Works here, not there               | Not checked on the test site since 0.2.10.                                                    |
| 13. A check that could not fail         | Fixed: Ultron (III) has a scene and a test.                                                   |
| 14. Same thing shown two ways           | Fixed: Ultron (III) is explained the way Guard is.                                            |

## Done?

- [x] Every card in an audit, each stage (Ultron (III) since 2026-11-28).
- [x] Everything new listed.
- [ ] The watcher's lists empty or recorded (the scenes file is unwatched).
- [x] Every standing rule's three moments.
- [x] Each failure pattern asked.
- [ ] A debug scene and a browser test for each new mechanic (scenes: all, `ultronthree` new; browser: the standard
      game only).
- [ ] One whole expert game played.
