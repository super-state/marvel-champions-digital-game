# The ways the table has gone wrong so far

Drawn from the players' reports (issues 210, 215, 217, 222: three of the four from Ultron games) and the 270-odd fixes
merged up to 2026-11-28. Almost none were the rules being wrong. They were the table not telling the player
something, in a dozen repeating ways. **Run every new portion past each pattern**: for each, the question to ask and
how to check it.

Keep this alive: when a player report or one of Adam's spots is fixed, find its pattern here and add the case; if it
fits none, it is a new pattern, so write it in. A fix that only fixes its one card has learned nothing.

## Questions

### 1. The question hides what the player needs to answer it

- **Seen:** Ultron's side scheme asked "threat or a Drone?" with the scheme's threat blurred out (issue 210). A
  treachery asked to spend a mental resource with the hand out of sight (issue 217). Defend? hid the team's health
  (PR 19). Picks lay under the shade (PR 202).
- **Root cause:** the blur and shade are drawn for the question in general, not for what this question is about.
- **Ask:** to answer this, what would I look at on a real table? Is every one of those in view and readable: the
  cards each answer would change, their numbers, my hand if it pays, the other side of my identity (issue 215)?
- **Check:** every question of the pack in the browser, with a screenshot. `choice-affects.ts` keeps the cards a
  Choose-one would change in focus: a new kind of question must feed it. `question-check.ts` fails an audit on a
  question the table can only show plainly.

### 2. The question doesn't say who is asking or what the answer does

- **Seen:** "Choose cards" (Futurist), "Use it?" (Energy Channel), "Choose a player" (Stark Tower), "Use ability"
  twice on one card (Kree Manipulator), an action named only by its cost ("Aunt May: Exhaust"), War Machine's action
  not saying it hurts him, Wicked Ambitions not naming which minion each question was about.
- **Root cause:** the engine's generic label passes straight through; the engine often doesn't say which ability asks.
- **Ask:** read alone, does the question name the card asking and say, in the card's own words, what yes and no do?
- **Check:** list every question and every menu action the pack can raise (the audits' `p.snap.choice`), and read
  each one cold.

### 3. The game chose for the player, or let them choose wrongly

- **Seen:** Alpha Flight Station discarded a card the engine picked. Sonic Boom's Spend let through picks that
  didn't pay, so the penalty happened anyway. Energy Channel stopped taking cards after the first. Hired Gun offered
  an option with no valid target.
- **Root cause:** a cost or choice with only one obvious answer in the common case was never asked; a button was
  enabled before the picks were legal.
- **Ask:** is every cost and choice the card gives the player actually put to them, with only legal answers
  pressable, and "you cannot" options left out as the rules say?
- **Check:** each "choose", "spend X", "either/or", "up to" and "any number" in the pack, driven with too few, too
  many and the wrong kind.

## What the table draws

### 4. Something is in the game and the table doesn't draw it

- **Seen:** All Tied Up and Media Coverage attached to the hero were in no list the table drew, so their Actions
  couldn't be clicked. An upgrade on an ally (Inspired) was never drawn. A hero's own Actions never reached the menu.
  Rocket Boots' Aerial trait showed nowhere.
- **Root cause:** the table's picture is built from the places earlier packs used. A card in a new place (on the
  identity, on an ally, on a scheme, set aside, in a new game area) falls outside every list.
- **Ask:** for each card of the pack, every place it can be and every host it can sit on: is it drawn there, can it
  be read there, can its Action be reached there?
- **Check:** an audit test per card that it is in the snapshot the table draws (`snap.enemyCards`, `snap.inPlay`),
  then the browser.

### 5. A change happens with no movement, or another change gets the credit

- **Seen:** Criminal Enterprise swapped to State of Madness in place (Adam, 2026-11-28); the "-1 infamy" on the same
  card had counted as showing it. Cards turned over black online because their pictures weren't loaded (PR 122).
  Eviction Notice stayed on the table after it was removed from the game (PR 12).
- **Root cause:** the check accepted "the picture is different afterwards" and "some beat named this card".
- **Ask:** does each change have a beat of its own kind, and does the card visibly do it?
- **Check:** the watcher's `unplayed` list (SKILL.md, a), then a frame-by-frame browser test for a new kind of
  change (`battle-env-flip.spec.ts`).

### 6. A rule stops, changes or repeats something, and nothing says so

- **Seen:** All Tied Up: "Change form" simply vanishes and the hero stays exhausted, with no reason given. Media
  Coverage: a When Revealed happens twice and nothing names Media Coverage. Guard, before PR 170: the villain just
  couldn't be picked. Shocker and Swarm Attack with no hero to hit did nothing visibly (PRs 28, 234).
- **Root cause:** a standing rule emits nothing when it bites, and "nothing happened" emits nothing at all, so no
  test or watcher sees a gap.
- **Ask:** when the player expects something and it doesn't happen (a ready, a move, an attack, a draw), is the
  reason said at that moment, naming the card? When a card does nothing, does the table say "nothing to do" and why?
- **Check:** by hand, from the pack's text (SKILL.md, b). There is no automatic check for this one.

### 7. A number on the table is wrong while a move plays out

- **Seen:** Ultron's scheme showed 8/10 then settled at the true 4/10 (player report, PR 185): a Drone arriving
  redrew every label from the finished game, and the threat steps were then added on top.
- **Root cause:** two sources for one number, the finished game and the steps still playing.
- **Ask:** when this pack does several things to one card in one move, does every number on the way read true?
- **Check:** the busiest move the pack can make (many minions arriving while threat lands). Browser tests fail on
  "[table drift]"; beats carry the number they land on (`threat.to`), never just a change to add.

### 8. A name or label comes from the wrong moment, or from guessing at words

- **Seen:** "Green Goblin interrupts" for Norman Osborn's interrupt, and "Norman Osborn is about to attack you" after
  he had become Green Goblin. A main scheme's When Completed credited to the next stage. "DRONE" for a facedown
  card. Media Coverage flashing for a When Revealed it only quotes. "Quickstrike:" on other cards' attacks.
- **Root cause:** names read once the move has ended; the table inferring a mechanic from a pattern in the text.
- **Ask:** for any card that changes what it is during a move (flips, advances, turns facedown), is it called by
  what it was at that moment? Does any label rest on matching words in card text?
- **Check:** the beats before and after each flip or stage change; the pack's cards that quote a keyword or timing
  word without having it.

### 9. Things play in the wrong order or at the wrong moment

- **Seen:** the next attack's target aimed at before its own beat (PR 224). "+1 THW" shown before the flip that
  causes it (PR 60). A boost label gone before its card moved (PR 30). A stray aim at the start of the hero phase.
  An achievement toast covering Victory (PR 168).
- **Root cause:** the table's picture jumps to the finished game while the story of the move is still being told.
- **Ask:** watching the move, is anything seen before its cause, or left over after its end?
- **Check:** watch each chain of the pack at full length in the browser; the beats' order in the audit.

### 10. The table can't hold what the pack puts on it

- **Seen:** Ultron's Drones crowded the villain's row; minions, schemes, health badges and waiting cards overlapped
  (PRs 100, 109, 113, 118, 219). Several attachments on one card (PRs 36, 37).
- **Root cause:** the layout was sized for the last villain's busiest table.
- **Ask:** what is the most this pack can put out at once: minions, side schemes, attachments on one card, cards
  under a card, counters of different kinds on one card?
- **Check:** a "crowded" debug scene for the pack's worst case, at desktop and phone width.

## Rules

### 11. "Your hero" when there is no hero, and other form and side branches

- **Seen:** Swarm Attack attacked a player in alter-ego form (issue 222); the same reading fixed Tail Sweep and
  Titania's Fury. Cards whose two halves depend on form, or on which side of a card is up (Mad Genius).
- **Root cause:** cards tested in hero form only.
- **Ask:** has every card been made to happen in both forms, on every villain stage and side it reads?
- **Check:** the sweep in both forms; `rules-expert` on any "your hero" or "if you cannot".

### 12. It works here and not there

- **Seen:** card pictures unloaded on the test site, fine on the dev table (PR 122). Tests passing alone and failing
  on a busy PC. Safari on a MacBook (PR 117).
- **Ask:** has it been seen on the test site's build, at phone width, with a controller?
- **Check:** `pnpm table:check` before a version ships; the portion looked at once on the shipped site.
