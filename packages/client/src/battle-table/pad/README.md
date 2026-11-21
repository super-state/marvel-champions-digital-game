# Controller mode (3D table)

The whole fight can be played on a gamepad. No rule lives here: every card on the table already has its own button
(its nameplate, `main.ts` synchronizeLabels), and the turn bar, the corners and the menus are buttons too. The pad
moves the focus between them and presses them, so a pad can do exactly what a click can. Everything the controller
needs is in this folder, so it doesn't depend on the old 2D game: `buttons.ts`, `family.ts`, `repeat.ts`, `triggers.ts`,
`spatial.ts` and `glyph-art.ts` (with `glyphs/`, credits in its README) are the table's own copies of the old game's
pure pad modules, following the button decisions in `docs/controller-support.md` where they apply.

| File            | What it does                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `input.ts`      | Reads the pads each frame: presses, held directions, stick scroll, LT / RT layers. Pure, tested. |
| `nav.ts`        | Where the focus goes: a D-pad step, a bumper jump between zones, where it starts. Pure, tested.  |
| `controller.ts` | The page side: the loop, scopes, focus, presses, button pictures, rumble. Wired up by `main.ts`. |
| `pad.css`       | Every ring and hint, keyed on `:root[data-input="pad"]`.                                         |

| Button             | On the 3D table                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| D-pad / left stick | Move the focus to the nearest card or button that way; held, it repeats                           |
| A                  | Press it: play a card, spend it, pick it, open or close a card's actions, answer the bar          |
| B                  | Back, as Escape: unpin, close a card's actions, cancel a payment or pick, close a pile; else Menu |
| Y                  | Pin the focused card full size beside the table (again: unpin)                                    |
| LB / RB            | Jump between the hand, your side, the villain's side and the turn controls                        |
| Menu / Start / +   | Press the bar's gold button while it is ready (Continue, Play, Keep hand, Defend…); else Menu     |
| View / Select / −  | Show or hide the card panel                                                                       |
| L3 / R3            | Your discard pile / the encounter discard pile                                                    |
| LT (hold)          | A Attack, X Thwart, Y Recover, B Change form, LB Undo, RB End Turn                                |
| RT (hold)          | A / X / Y / B use your other cards' powers and abilities in table order; LB / RB page             |
| Right stick        | Scroll the table (a phone's) or the log                                                           |

- **End Turn is never a stray press.** It is LT + RB, or the End Turn button reached on purpose with a fresh D-pad
  press. The focus never lands on it by itself, a bumper jump never lands on it, a held direction stops short of it
  (and of Undo), the bar no longer hands the focus to it when it folds while a pad is in use, and a button that turns
  into End Turn under the focus (a phone's Keep hand) sends the focus back to the hand.
- **A card's actions open with the focus still on the card**, as for the mouse and the keyboard: a fresh D-pad press
  steps into them and A again closes them, so a double press or a held stick never uses one.
- **A new question's answers wait out a double press** (the bar's own `settled()` guard), so mashing A or Start through
  Continue doesn't also answer the question after it; a dialog's buttons wait the same, and the game-over screen's a
  full second, so A mashed through the last villain phase doesn't press Try Again and lose the undo. Spending a
  resource or picking a card to swap answers at once.
- **The trigger combos, View and L3 / R3 reach the table only**: never from behind the menu, a card's open actions or a
  revealed card waiting on Continue.
- **No pick combos here.** The classic board's RT+A, RT+B… combos for each target don't apply: a target is picked by
  moving the focus onto it and pressing A, as with every other card.
- **Controller mode starts with the first pad input** and ends when the mouse moves, the screen is touched or a key is
  pressed. Until then the page is unchanged. A pad that disconnects says so and hands the table back to the mouse.
- **Hints:** a strip of the buttons across the top of the table (under it on a phone, A / B / Start only), Start's
  picture on the bar's gold button, LT + RB on End Turn, LT + LB on Undo, and what A and Y do above the focused card.
  While LT or RT is held, a sheet lists what each face button does now. Pictures follow the pad's family (Xbox,
  PlayStation, Switch) and the classic game's Settings ▸ Controls (`mc-settings`: button labels, Use Nintendo Switch
  layout, button hints on/off).
- The pad rumbles briefly as a hit lands on your side (the hero or an ally), where the browser and the pad can.
- Tests: the `*.test.ts` files here (in `pnpm battle:test`) and `packages/client/e2e/battle-controller.spec.ts` (a
  fake Xbox pad; the push check runs it). Real controllers are still to be tried by hand.
