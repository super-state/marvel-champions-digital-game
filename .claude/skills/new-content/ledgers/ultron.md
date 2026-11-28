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
| A villain that **cannot take damage** while something is in play     | Ultron (III)                                                         | **Open.** See 1 below.                                                                                                                                        |
| The villain **gains a keyword** from an attachment (Retaliate 1)     | Concussion Blasters                                                  | **Open.** See 2 below.                                                                                                                                        |
| A status given by an attachment's response                           | Vibranium Armor                                                      | **Open** (small). See 3 below.                                                                                                                                |
| The villain's ATK raised for one attack by what is in play           | Ultron (II)                                                          | **Shown as** a stat token on Ultron for the attack, taken off after (`ultron-scenes`, "ultronstage").                                                         |
| A "when revealed" with a hero half and an alter-ego half             | Rage of Ultron, Swarm Attack                                         | **Shown as** the half that applies; "No hero" stamped when Swarm Attack has no hero to attack (issue 222).                                                    |
| The villain heals by what is in play                                 | Repair Sequence                                                      | **Shown as** healing floating off Ultron, or Surge when nothing was healed. Model only: not looked at in the browser.                                         |
| Cards discarded off the player's deck for each damage                | Rage of Ultron, Invasive AI                                          | **Shown as** a mill, naming the card that did it and each card discarded.                                                                                     |
| A stage that ends the game when completed                            | Countdown to Oblivion                                                | **Shown as** the defeat panel.                                                                                                                                |
| Many minions at once                                                 | every Drone card                                                     | **Shown as** two rows either side of the villain, the encounter piles shrinking to the corner (PRs 100, 113, 118, 219). Scenes `ultroncrowd`, `ultronpiles`.  |

## Open: what the table doesn't tell the player

1. **Ultron (III) can't be hurt, and nothing says so** (failure patterns 3, 6 and 14). His text: "Ultron cannot take
   damage while a Drone minion is in play." With a Drone out, pressing Attack asks nothing and hits the Drone: the
   game has chosen for the player. Ultron's card shows no sign he is untouchable and the hero's menu has no note.
   Guard had exactly this problem and was fixed for Guard only (PRs 170, 177: "a playtester was confused when the
   attack went straight to the guard one"). An expert game reaches this stage every time.
   _To build, in the table's language:_ the lock on Ultron's plate ("Can't take damage while a Drone is in play"),
   as a card a rule holds down has; the attack pick asked even when a Drone is the only thing that can be hurt, with
   Ultron shown and the reason under the question, as Guard's is. Scene `ultronthree`.
2. **Retaliate is never named** (failure patterns 6 and 8). With Concussion Blasters on him "the villain gains
   retaliate 1". Nothing on Ultron shows it, and when the hero attacks, the table plays "Ultron deals 1 damage to
   Spider-Man" exactly like an attack of his. The word Retaliate appears nowhere in the table's code, so this is true
   of every card with Retaliate in the game, not only Ultron's.
   _To build:_ a pill on the plate of a character with Retaliate (as Guard has), and the hit stamped "Retaliate"
   with the card that gives it under it when it is not the character's own ("Concussion Blasters"). Scene
   `ultronarmor`.
3. **Vibranium Armor isn't named when it gives the tough card.** "Ultron gains tough" plays, and the armor that did it
   is not pointed at (the Core ledger's "shown, with the card that did it not named": 3 of 3 firings). The same list
   holds nine player cards (Mockingbird, Shuri, Maria Hill and others). _To build:_ the cause line under the stamp.
4. **Three identical answers.** "Choose a minion to activate [Drone | Drone | Drone]": the order rarely matters, but
   the buttons can't be told apart. Failure pattern 2. Picking on the table (or numbering them) would say which.
5. **Program Transmitter does nothing, silently**, when there is no side scheme ("fired and did nothing"). Small.
6. **Not yet looked at in the browser:** Ultron (III)'s When Revealed (search for Ultron's Imperative, shuffle: the
   Core ledger has "a deck shuffled" as silent for it), Repair Sequence's heal, an expert game played whole.

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
| 2. Question doesn't say who or what     | Open: three "Drone" answers (4).                                                              |
| 3. The game chose for the player        | Open: Ultron (III) (1).                                                                       |
| 4. In the game, not drawn               | None found.                                                                                   |
| 5. Change with no movement              | None found in the probe games; the scenes file is unwatched.                                  |
| 6. A rule stops something, nothing said | Open: Ultron (III), Retaliate (1, 2). Countdown to Oblivion's lock is shown.                  |
| 7. Wrong number mid-move                | Fixed (PRs 185, 192: the 8/10 report).                                                        |
| 8. Name from the wrong moment           | A Drone is "Drone" until defeated, then named: right. Retaliate's hit reads as an attack (2). |
| 9. Wrong order                          | Fixed for the aim (PR 224). An expert game not watched.                                       |
| 10. Table can't hold it                 | Fixed (`ultroncrowd`, `ultronpiles`).                                                         |
| 11. No hero, other form branches        | Fixed for Swarm Attack (issue 222). Rage of Ultron both halves: in the scenes.                |
| 12. Works here, not there               | Not checked on the test site since 0.2.10.                                                    |
| 13. A check that could not fail         | Open: Ultron (III) is in no test at all.                                                      |
| 14. Same thing shown two ways           | Open: "can't be attacked/hurt" explained for Guard, not for Ultron (III).                     |

## Done?

- [ ] Every card in an audit, each stage (Ultron (III): no).
- [x] Everything new listed.
- [ ] The watcher's lists empty or recorded (the scenes file is unwatched).
- [ ] Every standing rule's three moments (1 and 2 open).
- [x] Each failure pattern asked.
- [ ] A debug scene and a browser test for each new mechanic (scenes: all, `ultronthree` new; browser: the standard
      game only).
- [ ] One whole expert game played.
