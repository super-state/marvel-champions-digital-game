# The 3D table's sound effects

Played by `../sound.ts`. Every file comes from Kenney's audio packs (kenney.nl, by Kenney Vleugels), which are
**CC0** (public domain, no credit required, free to ship in this public repo), except the swooshes, which
`scripts/battle-sfx/build.py` makes itself from filtered noise. That script rebuilds the whole folder from the unzipped
packs: it trims each sound to start within about 10 ms, matches loudness across each family and writes mono MP3s.
Several files with one name (`hit-1` … `hit-5`) are variants: one is picked at random each time, slightly re-pitched.

To swap a sound, change its line in the script's `RECIPE`, rerun it, and listen in the game.

| Sound           | When it plays                                                                | Made from (Kenney pack: file)                                           |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `draw`          | each card drawn into the hand (180 ms apart), a card back to the hand        | Casino Audio: card-slide 1, 2, 4, 5                                     |
| `deal`          | an encounter card dealt facedown, a card tucked under another                | Casino Audio: card-slide 3, 6, 7                                        |
| `place`         | an encounter card landing in play                                            | Casino Audio: card-place 1, 2, 4                                        |
| `play`          | the player plays a card, an event goes onto the mat                          | Casino Audio: card-shove 1, 3, 4                                        |
| `flip`          | an encounter card turned up, cards turned off the deck, the villain flipping | Casino Audio: card-fan 1                                                |
| `turn`          | cards exhausting or readying                                                 | Casino Audio: card-slide 6, 7, 8                                        |
| `discard`       | cards to a discard pile                                                      | Casino Audio: card-slide 4, 5                                           |
| `shuffle`       | a pile shuffled back into its deck (cut to the animation)                    | Casino Audio: card-shuffle                                              |
| `whoosh`        | an attacker winding up, a card lifting off the hand, threat flying as damage | made by the script                                                      |
| `whoosh-big`    | the phase banner sweeping across the table                                   | made by the script                                                      |
| `hit`           | an attack landing for 1–3 damage, overkill                                   | Impact Sounds: impactPunch_medium 0–4                                   |
| `hit-heavy`     | an attack landing for 4 or more                                              | Impact Sounds: impactPunch_heavy 0–4 + Sci-fi: lowFrequency_explosion 1 |
| `block`         | damage blocked or deflected; faster for a When Revealed or interrupt firing  | Sci-fi Sounds: forceField 0, 2, 4                                       |
| `threat`        | threat or acceleration placed on a scheme                                    | Casino Audio: chips-stack 2–5                                           |
| `thwart`        | threat removed from a scheme                                                 | Casino Audio: chips-collide 1, 2, 4                                     |
| `heal`          | damage healed                                                                | Digital Audio: powerUp 7, 11                                            |
| `status`        | stunned, confused or tough given                                             | Impact Sounds: impactBell_heavy 4, 2                                    |
| `defeat`        | a character or card defeated (its flash)                                     | Sci-fi Sounds: explosionCrunch 0                                        |
| `boom`          | a big defeat called out across the table (a villain stage)                   | Sci-fi Sounds: lowFrequency_explosion 0 + explosionCrunch 1             |
| `surge`         | Surge: one more encounter card                                               | Digital Audio: phaserUp 3                                               |
| `boost`         | a boost card's icons bursting out                                            | Interface Sounds: maximize 6                                            |
| `phase-hero`    | the hero phase starting                                                      | Music Jingles: Hit jingles 10                                           |
| `phase-villain` | the villain phase starting                                                   | Music Jingles: Hit jingles 05                                           |
| `win`, `lose`   | the game over screen                                                         | Music Jingles: Hit jingles 11, 09                                       |
| `select`        | a target or resource picked                                                  | Interface Sounds: select 1, 2                                           |
| `confirm`       | End Turn, paying, the menu's sound switch                                    | Interface Sounds: confirmation 1                                        |
| `error`         | a card that can't be played now                                              | Interface Sounds: error 6                                               |

## The Sound Studio

`pnpm battle`, then open `/battle/studio.html`: browse this PC's sample folders, give any moment its own files (several
take turns), cut them, fade them, set volume, pitch and delay, and drag the gold ⚡ marker to the instant that should
land on the table's moment, with the table acting it out beside the waveform. Saving keeps the edits on this PC
(`%LOCALAPPDATA%\Marvel3DTable\studio`, `src/battle-table/studio/studio-server.ts`); the dev game plays them at once.
They reach the repo, and everyone, only when a session ships them. Mind the licence first: this repo is public.
