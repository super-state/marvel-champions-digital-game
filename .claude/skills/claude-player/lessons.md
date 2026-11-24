# What playing the 3D table has taught Claude

Read before every game; condense into after every game (how: `SKILL.md`, "After every game"). Only what playing
taught, not what the card text or the rules already say. `seen N×` = how many games backed it up; `1×` is a hunch.
A rule misread in play is fixed in the hook's text (`play.ts`), not written down here: `look()` already says which
cards work in one form only, what each status does and the hand limit.

## Playbook

### Spider-Man vs Rhino (core set, Spider-Man's Justice deck) — 3 wins, 6 losses (plus one game lost to a reload)

- **The winning shape: allies on the table, Kicks saved for the second stage, then finish fast.** Game 8 won in
  round 7: Daredevil, Mockingbird and Jessica Jones out by Rhino's second stage, then Daredevil 2 + Kick 8 + Kick 8
  = 18 against his 15. Game 9 won in round 8: stage 1 was worn down by basics and allies (Black Cat, Jessica), the
  Kicks went only into stage 2 (one the turn it arrived, one the next). Game 4 won the same way with fewer cards.
  The allies do double work: damage, and blocking the attacks that would stun or kill Spider-Man. `seen 3×`
- **Kick the second stage the turn it arrives if the hand would be full.** Holding two Kicks plus three resources
  leaves a full hand and no draw, so next turn only one Kick is payable. Kicking once at once and drawing three found
  the finishing resources (game 9). `seen 1×`
- **Let an ally take Stampede.** Its stun on Spider-Man would cancel the finishing Kick; Black Cat blocked it the
  phase before the win (game 9), as Jessica did in game 7. `seen 2×`
- **The last 7 HP of Rhino's second stage is where losses happen.** Games 3-6 all had Rhino's second stage on 7 by
  round 5-8 with no allies and one Kick, and stalled; in game 6 Hard to Keep Down healed him back to 11 twice. `seen 4×`
- **Two Kicks in one turn needs a double resource.** It came together in games 6 and 8: Genius (counts 2) plus
  Avengers Mansion and Spider-Sense draws. Hold Genius, Strength or Energy for that turn, and once two Kicks are in
  hand Spider-Man can defend freely (the Kicks don't need him ready). `seen 2×`
- **Count lethal before anything else.** Every turn, add basic + events + every ally's attack against Rhino's HP
  (and the Armored Rhino Suit's 5, Toughness, any Guard minion) before planning defence. `seen 2×`
- **The Break-In! is what loses, and it jumps 3-6 in one villain phase.** All four losses were the main scheme
  reaching 7. Rhino's boost is often +2; Bomb Scare adds +1 every phase; Hydra Bomber offers 2 damage or +1 threat.
  Before ending a turn, count: step (+1), Rhino 1 + 2 boost, every minion's SCH if you are Peter, 1-2 for a
  treachery. If that reaches 7, thwart more or stay in hero form. `seen 5×`
- **Crowd Control lands late, when it hurts most.** Game 5 was lost at 6/7 with it in play. Clear Crowd Control
  (and Breakin' & Takin') the turn they land whenever the main scheme is at 4 or more. `seen 2×`
- **Clear confusion early.** False Alarm came in four of seven games; its confusion sat on Spider-Man for most of
  game 5 and cost a For Justice! in game 4. A basic thwart while the scheme is low clears it cheaply (worked in game
  7). `seen 3×`
- **Threat discipline buys the time to win.** For Justice! paid with a mental or wild resource, Surveillance Team,
  Spider-Tracer on a minion you are about to kill (−3), Interrogation Room, allies thwarting. `seen 3×`
- **Alter ego is safe only with no minions out (a SCH-0 Mercenary is fine) and only in Rhino's first stage.** Then
  Peter dodges big attacks and heals (Recover, then flip back before the next big phase). With a scheming minion out,
  Peter loses to the scheme (games 1-3, 5). In the second stage Breakin' & Takin' deals an extra encounter card and
  every attack treachery (Stampede, Assault, Gang-Up) surges into another while you are Peter: game 7 went 1 → 7 in
  one phase as Peter with no minions out, five encounter cards in that phase. `seen 6×`
- **Rhino's second stage piles up fast.** One villain phase can bring Toughness, Hard to Keep Down (+4 HP; cancel it
  with Enhanced Spider-Sense), a Guard minion, Charge (7-10 ATK, overkill), Armored Rhino Suit, the nemesis (whose
  Sweeping Swoop stuns). `seen 5×`
- **Rhino hits hard.** Stage 2 or with Charge, expect 5-10 from one attack, plus Assault, Stampede or Gang-Up
  attacking again. Hold Backflip, a ready Spider-Man, a stun or an ally. Allies can't block Charge attacks
  (overkill). `seen 5×`
- **Stuns buy whole phases.** Webbed Up, and Mockingbird's entry stun (played as Peter it still waits for
  Rhino's next attack). `seen 4×`
- **Tenacity readies Spider-Man for a second action**, and everyone readies at the end of your turn anyway, so
  attack with all, then block with all. `seen 2×`
- **Kill minions as they arrive,** a Guard minion first. Order minion activations so Spider-Man defends the
  biggest. `seen 4×`
- **Cards that earned their place:** For Justice!, Surveillance Team, Daredevil, Mockingbird, Nick Fury (draw 3 in
  round 1), Black Cat, Jessica Jones, Avengers Mansion, Spider-Tracer, Backflip, Enhanced Spider-Sense. `seen 5×`

### Spider-Man vs Klaw (core set, same deck) — 0 wins, 2 losses (the win path checked from the `klawfinish` scene)

- **The threat clock is two stages: 6 then 8, with Klaw scheming 2 + a boost.** As Peter, one villain phase adds
  4-6, and the stage flip brings a minion. Both losses ended at the scheme or on a Peter who could not hide any more.
  Stay Spider-Man whenever Klaw is stunned (his attack is wasted) and thwart every turn. `seen 2×`
- **Defense Network is a crisis: no thwart reaches the main scheme until it is gone.** Clear it in the first two
  rounds (Daredevil 2 + a basic). `seen 1×`
- **Minions pile up: Klaw's deck is mostly minions.** Weapons Runner arrives from boosts, Masters of Mayhem makes
  every Master of Evil attack again, two Armored Guards (Guard + Toughness) can lock Klaw away. Kill minions as
  they land; Spider-Tracer + Interrogation Room on the kill is 4 threat. `seen 2×`
- **Pay Sonic Converter off the turn it lands** (energy + mental + physical, the move "Sonic Converter: Discard it").
  Its stun on every damaging Klaw attack cost Spider-Man three turns of attacks in game 2. `seen 1×`
- **Never let a script answer defend questions.** An auto-driver that declined every defend left Spider-Man on 1 HP
  in round 3 of game 1. Allies are blockers: they ready at the end of your turn, so attack with them, then block.
  `seen 1×`
- **Klaw (II) is 18 + 10 while The "Immortal" Klaw stands:** thwarting its 3 threat is cheaper than 10 damage.
  `seen 1×` (scene)

### Driving the hook

- Pick moves from `moves()` labels only; a look's text starts with the move just made. `seen 1×`
- Several cards can wait to be read at once: loop on "Continue (after …" before a planned sequence. `seen 3×`
- When a scripted sequence prints only part of a reply, it hides what you need: print the whole look after every
  villain phase (game 6's winning double Kick fizzled on a stun the look showed), and keep each reply's "What
  happened" lines (game 7's losing phase can't be told card by card because a script kept only first lines). `seen 2×`
- Remote play (curl): a move's words with an em dash or other non-ASCII letters get mangled by the Windows shell;
  match on plain ASCII words ("Pay with Web-Shooter"). `seen 1×`
- An action ability that costs resources (Tenacity) ends with a "Use" move after paying, not "Play". `seen 1×`

## Try next

- Against Klaw: an opening that keeps Peter safe while Defense Network and the first minion go (Daredevil, Jessica
  Jones), then Spider-Man for good once allies can block; save both Kicks for Klaw (II).
- Keep the shape (allies, Kicks for stage 2, stay Spider-Man); try Webbed Up on Rhino the turn before stage 1
  falls, so its stun carries into stage 2 (it did in game 9) and covers the first turn there.
- Save Enhanced Spider-Sense for Hard to Keep Down (cancelled it in stage 1 in game 9; worked).
- Try a different villain or hero next, now that Spider-Man vs Rhino wins two in a row.

## Recent games

- 2026-11-24 · Spider-Man (Justice) vs Klaw · lost in round 8, Secret Rendezvous 8/8 · Klaw (I) worn to 5 by round 2,
  but Sonic Converter's stuns and five minions (two Armored Guards) kept Spider-Man off him. The win was checked
  from the `klawfinish` scene instead.
- 2026-11-24 · Spider-Man (Justice) vs Klaw · lost in round 9, Peter defeated by Masters of Mayhem · a driver script
  declined every defend in round 2 and left Spider-Man on 1 HP; held the scheme with Spider-Tracer, Interrogation
  Room and Surveillance Team for six rounds.
- 2026-11-24 · Spider-Man (Justice) vs Rhino · **won** in round 8 · Black Cat and Jessica wore stage 1 down while
  both Kicks waited; Webbed Up's stun carried into stage 2; Kick on arrival, Black Cat blocked Stampede, Kick to
  finish. First game in Adam's single "Marvel Champions" Games tab.
- 2026-11-23 · Spider-Man (Justice) vs Rhino · **won** in round 7 · Mansion from round 1, Mockingbird, Daredevil and
  Jessica Jones out by stage 2; stayed Spider-Man through stage 2 while the allies took three attacks in one phase,
  then Daredevil + two Kicks = 18 against 15. (The game before it was lost unfinished in round 4: its Games tab was
  hidden behind a video, the browser unloaded it, and it came back as a new deal.)
- 2026-11-23 · Spider-Man (Justice) vs Rhino · lost in round 4, The Break-In! 1 → 7 in one phase · Kicked stage 1
  away on 6 HP and hid as Peter from the new stage 2 with no minions out; Breakin' & Takin' plus surging treacheries
  dealt five encounter cards. (First game played in Surf's game mode.)
- 2026-11-23 · Spider-Man (Justice) vs Rhino · lost in round 10, The Break-In! 3 → 7 in one phase · in round 7 two
  Kicks (16) were set up against stage 2's 15, but the first fizzled on a Sweeping Swoop stun I hadn't read; Hard to
  Keep Down then healed Rhino twice. (An earlier start was wiped in round 4 when a merge reloaded the table.)
- 2026-11-23 · Spider-Man (Justice) vs Rhino · lost in round 9 at 6/7 · stage 1 fell in round 2 (Kick + basic) and
  stage 2 was on 7 by round 5, but Armored Suit, a Guard minion, Sandman and Crowd Control piled up with no allies
  and no Kicks left.
- 2026-11-23 · Spider-Man (Justice) vs Rhino · **won** in round 10 · threat 6/7 and Rhino on 10 ATK, but basic +
  Web Kick + Daredevil + Mockingbird was exactly his 11 HP and Toughness.
- 2026-11-23 · Spider-Man (Justice) vs Rhino · lost in round 10, The Break-In! 2 → 7 as Peter · Rhino on 7, then
  Toughness, a Guard minion and Vulture in one phase.
