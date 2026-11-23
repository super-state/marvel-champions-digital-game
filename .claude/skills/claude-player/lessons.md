# What playing the 3D table has taught Claude

Read before every game; condense into after every game (how: `SKILL.md`, "After every game"). Only what playing
taught, not what the card text or the rules already say. `seen N×` = how many games backed it up; `1×` is a hunch.
A rule misread in play is fixed in the hook's text (`play.ts`), not written down here: `look()` already says which
cards work in one form only, what each status does and the hand limit.

## Playbook

### Spider-Man vs Rhino (core set, Spider-Man's Justice deck) — 1 win, 6 losses

- **The last 7 HP of Rhino's second stage is where games are decided.** Games 3-6 all had Rhino's second stage on
  7 by round 5-8; in game 6 Hard to Keep Down then healed him back to 11 twice. The one win came from allies on the
  table adding the last points (Kick 8 + Daredevil 2 + Mockingbird 1). Keep 1-2 cheap allies alive into that
  stretch, hold one Kick for the finish, and keep Enhanced Spider-Sense for Hard to Keep Down. `seen 4×`
- **Two Kicks in one turn is possible but needs planning.** It came together once in six games (game 6, round 7):
  Genius (counts 2) plus a Spider-Sense draw made the 6 resources. Hold Genius, Strength or Energy for that turn,
  and take Rhino's hit undefended the phase before so Spider-Sense draws. `seen 1×`
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

- Stay Spider-Man for the whole second stage; dodge with Webbed Up, Mockingbird, Backflip and a ready defender instead
  of Peter.
- Set up the double Kick again (hold a double resource, let Spider-Sense draw), and read the look before firing.
- Save Enhanced Spider-Sense for Hard to Keep Down once Rhino's second stage is under 8.

## Recent games

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
- 2026-11-23 · Spider-Man (Justice) vs Rhino · lost in round 7, The Break-In! 1 → 7 in one phase · stunned on 2 HP,
  hid as Peter.
- 2026-11-23 · Spider-Man (Justice) vs Rhino · lost in round 5, The Break-In! reached 7/7 · three minions scheming
  while Peter healed.
