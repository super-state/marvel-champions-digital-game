# How the 3D table already shows things

Reuse the nearest of these before designing anything new. The full, checked list is `BEAT_FIELDS` in
`packages/client/src/battle-table/shown-check.ts` (a test keeps it in step with `model.ts` and `main.ts`); `present()`
in `main.ts` is where each is played out. Add a line here whenever a new treatment is designed and agreed.

## Something happens (it plays out, then it's over)

| What happened                                  | How the table shows it                                                                     | Beat                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| A card turns over to its other side            | Called out "Flip", the card lifts and turns over where it lies; new counters land after    | `cardFlip`, `villainFlip`                      |
| The villain or main scheme moves a stage       | Stamped "Completed" / turns to the next stage, threat starts again                         | `villainStage`, `schemeAdvance`                |
| A counter or status goes on or off a card      | A ring on the card, the number floats ("−1 infamy"), the token drops on or lifts off       | `statusChange`                                 |
| Damage, healing                                | The strike, a burst and the hit-point label; healing floats green off the card             | `hit`, `statusChange` (damage, minus)          |
| Threat placed or removed                       | Threat chips fly onto or off the scheme, the number floats                                 | `threat`                                       |
| A stat changes (+1 ATK)                        | A stat token on the card, with a ring                                                      | `modifier`                                     |
| An enemy activates                             | It lifts, is stamped Attacks / Schemes, aims at its target                                 | `enemyActivation`, `scheming`, `attackAim`     |
| An encounter card is dealt, revealed, resolved | Flies facedown to the player, turns up in the middle to be read, then to its place or pile | `encounterDeal`, `reveal`, `encounterResolved` |
| An attachment arrives                          | Revealed, then flies onto its host and tucks beside it                                     | `reveal` (the "equip" flight)                  |
| A boost card                                   | Lies facedown beside its enemy, turns up with its icons counted                            | `boostFor`, `reveal`                           |
| Cards discarded from a deck                    | The top cards turn up and go to the discard pile, the card that did it named               | `milled`, `encounterMilled`                    |
| A card enters or leaves play                   | It travels from where it was to where it goes; removed from the game evaporates            | `entersPlay`, `leftPlay`, `defeatedCard`       |
| An interrupt or response                       | The card pulses and is stamped Interrupt / Forced Interrupt; what it stops is stamped      | `interrupt`, `interruptBy`                     |
| Something prevented or blocked                 | "Blocked" floats, the Tough card lifts off, "No target" stamp                              | `deflection`, `hit` (tough), `nothingFound`    |
| Surge, Overkill, a discount                    | A stamp on the card: Surge!, Overkill, the cost                                            | `surge`, `overkill`, `discount`                |
| A deck runs out, shuffles                      | The discard pile shuffles into a new deck; an acceleration token is stamped on             | `deckReset`, `encounterReset`, `acceleration`  |
| A phase changes                                | A banner across the table                                                                  | `phase`                                        |

## Something stands (it stays true until it's removed)

| What is true                    | How the table shows it                                                            |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Health, threat                  | The pill under the card; damage and threat chips on it                            |
| Stunned, confused, tough        | A status card on the character                                                    |
| Counters (infamy, madness, web) | A counter token with its number on the card                                       |
| Exhausted                       | The card lies turned                                                              |
| Attached                        | The attachment is tucked beside its host, its name on the spine                   |
| Guard                           | A shield pill on the minion's plate; picking the villain says why it can't be hit |
| A stat raised or lowered        | A stat token on the card                                                          |
| A card that can be used now     | It is lit; its actions are in its menu                                            |

## Paying

**The rule (Adam, 2026-11-28): whenever what is being paid for asks for specific symbols (one type, a combination or
a set of them), the symbols are shown.** However the payment is reached: a card from the hand, a card's or a hero's
own Action, an encounter card's "spend ..." question.

| What is paid                                     | How the table shows it                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cost of specific symbols ([mental] [physical]) | The printed symbols in the bar, each lit as it is paid; every picked card tinted with the big symbol it pays; cards that can't pay an unlit symbol dimmed |
| A cost of any resources ("Pay 2")                | The count and its bar ("1/2") only                                                                                                                        |

## Words

The dock (the bar above the hand) says what is happening and asks every question; its feed keeps the lines. Words
alone are never enough for a change: the table must show it too. Words are right for the reason ("why") beside what
the table shows.

## Not yet in the language (needed, to design)

See the open lines of each pack's ledger. As of Green Goblin: a restriction on the player's own character ("cannot
ready", "cannot change form"), and one card making another card's ability happen again.
