# Core Set: does the table show everything that happens?

Generated: do not edit by hand. `bash scripts/core-set-shown.sh` plays the fuzz and the deck audits under the
watcher (`packages/client/src/battle-table/shown-check.ts`) and writes this page again.

Every Core Set card, one row per printed ability (and per card: played, revealed, activating, and each keyword the
engine reports firing). Each time a row's card acted in a watched game, everything it did was judged:

- **shown**: on the table: a card moves, a token or marker changes, a stamp, strike or banner (a beat field the
  table plays out, or the table's standing picture changing for that card).
- **log only**: only the dock's words say it. Not a pass until Adam has seen this list.
- **silent**: something happened and nothing on screen says so (what was missed is listed).
- **never fired**: no watched game reached it. It needs a driven scene before it can be called checked.

A row's class is the worst seen over all its firings. "Card not named" counts firings whose effect showed while
nothing pointed at the card that did it.

Sources: battle-fuzz, deck-audit-aggression, deck-audit-black-panther, deck-audit-captain-marvel, deck-audit-encounter, deck-audit-free-play, deck-audit-iron-man, deck-audit-leadership, deck-audit-player, deck-audit-protection, deck-audit-she-hulk.

## Summary

| Rows              | Shown | Log only | Silent | Never fired | All |
| ----------------- | ----- | -------- | ------ | ----------- | --- |
| All Core Set rows | 437   | 2        | 16     | 69          | 524 |
| Player cards      | 210   | 2        | 10     | 36          | 258 |
| Encounter cards   | 227   | 0        | 6      | 33          | 266 |

| Card type     | Shown | Log only | Silent | Never fired | All |
| ------------- | ----- | -------- | ------ | ----------- | --- |
| ally          | 39    | 0        | 2      | 6           | 47  |
| attachment    | 20    | 0        | 2      | 9           | 31  |
| environment   | 0     | 0        | 0      | 3           | 3   |
| event         | 80    | 0        | 1      | 0           | 81  |
| hero_identity | 3     | 1        | 4      | 3           | 11  |
| main_scheme   | 4     | 0        | 0      | 6           | 10  |
| minion        | 50    | 0        | 0      | 7           | 57  |
| obligation    | 12    | 0        | 0      | 0           | 12  |
| resource      | 8     | 0        | 0      | 13          | 21  |
| side_scheme   | 32    | 0        | 0      | 3           | 35  |
| support       | 32    | 0        | 0      | 3           | 35  |
| treachery     | 97    | 0        | 1      | 3           | 101 |
| upgrade       | 48    | 1        | 3      | 11          | 63  |
| villain       | 12    | 0        | 3      | 2           | 17  |

## Silent: player cards

| Card   | Name                | Set         | What                             | What was missed                                                            | Times     |
| ------ | ------------------- | ----------- | -------------------------------- | -------------------------------------------------------------------------- | --------- |
| 01017  | Cosmic Flight       | Hero:01010a | 01017.cosmic-flight-interrupt    | traits changed                                                             | 2 of 24   |
| 01017  | Cosmic Flight       | Hero:01010a | played                           | traits changed                                                             | 3 of 23   |
| 01019a | She-Hulk            | Hero        | 01019a.do-you-even-lift          | the ability fired                                                          | 1 of 37   |
| 01029a | Iron Man            | Hero        | 01029b.futurist                  | the ability fired                                                          | 2 of 88   |
| 01029a | Iron Man            | Hero        | hand size                        | hand size changed (by 01036 played); hand size changed (by 01108 revealed) | 2 of 2    |
| 01040a | Black Panther       | Hero        | effects                          | a deck shuffled                                                            | 77 of 154 |
| 01041  | Shuri               | Hero:01040a | 01041.shuri-response             | a deck shuffled                                                            | 4 of 13   |
| 01042  | Ancestral Knowledge | Hero:01040a | 01042.ancestral-knowledge-action | a deck shuffled                                                            | 2 of 8    |
| 01046  | Energy Daggers      | Hero:01040a | 01046.energy-daggers-special     | damage prevented                                                           | 1 of 6    |
| 01084  | Nick Fury           | Basic       | lasting effect                   | an effect that lasts begins; an effect that lasts ends                     | 12 of 35  |

## Silent: encounter cards

| Card  | Name                | Set    | What                                      | What was missed                   | Times   |
| ----- | ------------------- | ------ | ----------------------------------------- | --------------------------------- | ------- |
| 01094 | Rhino               | Rhino  | 01095.when-revealed                       | a deck shuffled                   | 8 of 16 |
| 01106 | Stampede            | Rhino  | 01106.when-revealed-alter-ego             | the ability fired and did nothing | 3 of 26 |
| 01113 | Klaw                | Klaw   | 01114.when-revealed                       | a deck shuffled                   | 1 of 2  |
| 01119 | Solid-Sound Body    | Klaw   | revealed                                  | keywords changed                  | 2 of 8  |
| 01134 | Ultron              | Ultron | 01136.when-revealed                       | a deck shuffled                   | 1 of 2  |
| 01141 | Program Transmitter | Ultron | 01141.program-transmitter-forced-response | the ability fired and did nothing | 4 of 8  |

## Silent: the game's own rules (no card resolving)

| Row   | What was missed | Times                                    |
| ----- | --------------- | ---------------------------------------- |
| rules | game rules      | the text before a 'then' did not resolve | 27  |

## Log only (words in the dock, nothing on the table)

| Card   | Name         | Set         | What                      | What was missed  | Times   |
| ------ | ------------ | ----------- | ------------------------- | ---------------- | ------- |
| 01019a | She-Hulk     | Hero        | 01019b.i-object           | threat prevented | 3 of 46 |
| 01039  | Rocket Boots | Hero:01029a | 01039.rocket-boots-action | traits changed   | 4 of 12 |

## Shown, with the card that did it not named

| Card   | Name            | What                                  | Firings with the card not named |
| ------ | --------------- | ------------------------------------- | ------------------------------- |
| 01010a | Captain Marvel  | 01010b.commander                      | 14 of 14                        |
| 01011  | Spider-Woman    | 01011.spider-woman-response           | 4 of 4                          |
| 01041  | Shuri           | 01041.shuri-response                  | 5 of 5                          |
| 01047  | Panther Claws   | 01047.panther-claws-special           | 2 of 2                          |
| 01048  | Tactical Genius | 01048.tactical-genius-special         | 2 of 3                          |
| 01049  | Vibranium Suit  | 01049.vibranium-suit-special          | 3 of 3                          |
| 01067  | Maria Hill      | 01067.maria-hill-response             | 1 of 1                          |
| 01083  | Mockingbird     | 01083.mockingbird-response            | 17 of 17                        |
| 01084  | Nick Fury       | 01084.nick-fury-forced-response       | 10 of 21                        |
| 01152  | Vibranium Armor | 01152.vibranium-armor-forced-response | 3 of 3                          |

## Never fired

| Card   | Name                     | Set                   | What                                         |
| ------ | ------------------------ | --------------------- | -------------------------------------------- |
| 01001a | Spider-Man               | Hero                  | 01001b.scientist                             |
| 01008  | Web-Shooter              | Hero:01001a           | 01008.web-shooter-resource                   |
| 01014  | Energy Absorption        | Hero:01010a           | played                                       |
| 01016  | Captain Marvel's Helmet  | Hero:01010a           | 01016.captain-marvels-helmet-constant        |
| 01017  | Cosmic Flight            | Hero:01010a           | 01017.cosmic-flight-constant                 |
| 01028  | Superhuman Strength      | Hero:01019a           | 01028.superhuman-strength-constant           |
| 01029a | Iron Man                 | Hero                  | 01029a.iron-man-constant                     |
| 01030  | War Machine              | Hero:01029a           | played                                       |
| 01033  | Pepper Potts             | Hero:01029a           | 01033.pepper-potts-resource                  |
| 01034  | Stark Tower              | Hero:01029a           | played                                       |
| 01036  | Mark V Armor             | Hero:01029a           | 01036.mark-v-armor-constant                  |
| 01039  | Rocket Boots             | Hero:01029a           | 01039.rocket-boots-constant                  |
| 01040a | Black Panther            | Hero                  | 01040b.foresight                             |
| 01044  | Vibranium                | Hero:01040a           | played                                       |
| 01047  | Panther Claws            | Hero:01040a           | played                                       |
| 01050  | Hulk                     | Aggression            | 01050.hulk-constant                          |
| 01050  | Hulk                     | Aggression            | 01050.hulk-constant-2                        |
| 01050  | Hulk                     | Aggression            | 01050.hulk-constant-3                        |
| 01050  | Hulk                     | Aggression            | 01050.hulk-constant-4                        |
| 01055  | The Power of Aggression  | Aggression            | 01055.the-power-of-aggression-constant       |
| 01055  | The Power of Aggression  | Aggression            | played                                       |
| 01057  | Combat Training          | Aggression            | 01057.combat-training-constant               |
| 01059  | Jessica Jones            | Justice               | 01059.jessica-jones-constant                 |
| 01062  | The Power of Justice     | Justice               | 01062.the-power-of-justice-constant          |
| 01062  | The Power of Justice     | Justice               | played                                       |
| 01065  | Heroic Intuition         | Justice               | 01065.heroic-intuition-constant              |
| 01072  | The Power of Leadership  | Leadership            | 01072.the-power-of-leadership-constant       |
| 01072  | The Power of Leadership  | Leadership            | played                                       |
| 01073  | The Triskelion           | Leadership            | 01073.the-triskelion-constant                |
| 01074  | Inspired                 | Leadership            | 01074.inspired-constant                      |
| 01079  | The Power of Protection  | Protection            | 01079.the-power-of-protection-constant       |
| 01079  | The Power of Protection  | Protection            | played                                       |
| 01081  | Armored Vest             | Protection            | 01081.armored-vest-constant                  |
| 01088  | Energy                   | Basic                 | played                                       |
| 01089  | Genius                   | Basic                 | played                                       |
| 01090  | Strength                 | Basic                 | played                                       |
| 01097a | The Break-In!            | Rhino                 | 01097a.setup                                 |
| 01113  | Klaw                     | Klaw                  | 01115.klaw-forced-interrupt                  |
| 01116a | Underground Distribution | Klaw                  | 01116b.when-revealed                         |
| 01116a | Underground Distribution | Klaw                  | 01116a.setup                                 |
| 01118  | Sonic Converter          | Klaw                  | 01118.sonic-converter-forced-response        |
| 01119  | Solid-Sound Body         | Klaw                  | 01119.solid-sound-body-constant              |
| 01119  | Solid-Sound Body         | Klaw                  | 01119.solid-sound-body-action                |
| 01125  | Defense Network          | Klaw                  | 01125.when-revealed                          |
| 01125  | Defense Network          | Klaw                  | revealed                                     |
| 01127  | The "Immortal" Klaw      | Klaw                  | 01127.the-immortal-klaw-constant             |
| 01132  | Melter                   | Masters of Evil       | 01132.melter-constant                        |
| 01134  | Ultron                   | Ultron                | 01136.ultron-constant                        |
| 01137a | The Crimson Cowl         | Ultron                | 01137b.when-revealed                         |
| 01137a | The Crimson Cowl         | Ultron                | 01137a.setup                                 |
| 01137a | The Crimson Cowl         | Ultron                | 01139b.countdown-to-oblivion-constant        |
| 01140  | Ultron Drones            | Ultron                | 01140.ultron-drones-constant                 |
| 01140  | Ultron Drones            | Ultron                | 01140.ultron-drones-forced-response          |
| 01140  | Ultron Drones            | Ultron                | revealed                                     |
| 01141  | Program Transmitter      | Ultron                | 01141.program-transmitter-action             |
| 01142  | Upgraded Drones          | Ultron                | 01142.upgraded-drones-constant               |
| 01143  | Advanced Ultron Drone    | Ultron                | 01143.advanced-ultron-drone-forced-interrupt |
| 01144b | Android Efficiency       | Ultron                | 01144b.when-revealed                         |
| 01144b | Android Efficiency       | Ultron                | revealed                                     |
| 01152  | Vibranium Armor          | Under Attack          | 01152.vibranium-armor-action                 |
| 01153  | Concussion Blasters      | Under Attack          | 01153.concussion-blasters-constant           |
| 01153  | Concussion Blasters      | Under Attack          | 01153.concussion-blasters-action             |
| 01157  | Killmonger               | Black Panther Nemesis | 01157.killmonger-constant                    |
| 01158  | Heart-Shaped Herb        | Black Panther Nemesis | 01158.boost                                  |
| 01162  | Titania                  | She-Hulk Nemesis      | 01162.titania-constant                       |
| 01163  | Genetically Enhanced     | She-Hulk Nemesis      | 01163.genetically-enhanced-constant-2        |
| 01172  | Whiplash                 | Iron Man Nemesis      | activation                                   |
| 01181  | Madame Hydra             | Legions of Hydra      | 01181.madame-hydra-constant                  |
| 01184  | M.O.D.O.K.               | The Doomsday Chair    | revealed                                     |

## Shown

| Card   | Name                     | What                                          | Times |
| ------ | ------------------------ | --------------------------------------------- | ----- |
| 01001a | Spider-Man               | 01001a.spider-sense                           | 168   |
| 01002  | Black Cat                | 01002.black-cat-forced-response               | 95    |
| 01002  | Black Cat                | played                                        | 38    |
| 01002  | Black Cat                | activation                                    | 23    |
| 01003  | Backflip                 | 01003.backflip-interrupt                      | 34    |
| 01003  | Backflip                 | played                                        | 34    |
| 01003  | Backflip                 | activation                                    | 73    |
| 01004  | Enhanced Spider-Sense    | 01004.enhanced-spider-sense-interrupt         | 26    |
| 01004  | Enhanced Spider-Sense    | played                                        | 26    |
| 01004  | Enhanced Spider-Sense    | activation                                    | 176   |
| 01005  | Swinging Web Kick        | 01005.swinging-web-kick-action                | 52    |
| 01005  | Swinging Web Kick        | played                                        | 37    |
| 01005  | Swinging Web Kick        | activation                                    | 273   |
| 01006  | Aunt May                 | 01006.aunt-may-action                         | 60    |
| 01006  | Aunt May                 | played                                        | 34    |
| 01006  | Aunt May                 | activation                                    | 10    |
| 01007  | Spider-Tracer            | 01007.spider-tracer-forced-interrupt          | 4     |
| 01007  | Spider-Tracer            | played                                        | 51    |
| 01007  | Spider-Tracer            | activation                                    | 57    |
| 01008  | Web-Shooter              | played                                        | 88    |
| 01008  | Web-Shooter              | activation                                    | 28    |
| 01009  | Webbed Up                | 01009.webbed-up-forced-interrupt              | 36    |
| 01009  | Webbed Up                | played                                        | 39    |
| 01009  | Webbed Up                | activation                                    | 380   |
| 01010a | Captain Marvel           | 01010a.rechannel                              | 15    |
| 01010a | Captain Marvel           | 01010b.commander                              | 28    |
| 01011  | Spider-Woman             | 01011.spider-woman-response                   | 8     |
| 01011  | Spider-Woman             | played                                        | 8     |
| 01012  | Crisis Interdiction      | 01012.crisis-interdiction-action              | 13    |
| 01012  | Crisis Interdiction      | played                                        | 9     |
| 01012  | Crisis Interdiction      | activation                                    | 2     |
| 01013  | Photonic Blast           | 01013.photonic-blast-action                   | 23    |
| 01013  | Photonic Blast           | played                                        | 11    |
| 01013  | Photonic Blast           | activation                                    | 72    |
| 01014  | Energy Absorption        | activation                                    | 7     |
| 01015  | Alpha Flight Station     | 01015.alpha-flight-station-action             | 24    |
| 01015  | Alpha Flight Station     | played                                        | 8     |
| 01015  | Alpha Flight Station     | activation                                    | 2     |
| 01016  | Captain Marvel's Helmet  | played                                        | 15    |
| 01017  | Cosmic Flight            | activation                                    | 6     |
| 01018  | Energy Channel           | 01018.energy-channel-action                   | 12    |
| 01018  | Energy Channel           | 01018.energy-channel-hero-action              | 18    |
| 01018  | Energy Channel           | played                                        | 15    |
| 01018  | Energy Channel           | activation                                    | 1     |
| 01020  | Hellcat                  | 01020.hellcat-action                          | 4     |
| 01020  | Hellcat                  | played                                        | 4     |
| 01021  | Gamma Slam               | 01021.gamma-slam-action                       | 2     |
| 01021  | Gamma Slam               | played                                        | 2     |
| 01021  | Gamma Slam               | activation                                    | 1     |
| 01022  | Ground Stomp             | 01022.ground-stomp-action                     | 16    |
| 01022  | Ground Stomp             | played                                        | 10    |
| 01022  | Ground Stomp             | activation                                    | 9     |
| 01023  | Legal Practice           | 01023.legal-practice-action                   | 4     |
| 01023  | Legal Practice           | played                                        | 6     |
| 01024  | One-Two Punch            | 01024.one-two-punch-response                  | 2     |
| 01024  | One-Two Punch            | played                                        | 2     |
| 01025  | Split Personality        | 01025.split-personality-action                | 34    |
| 01025  | Split Personality        | played                                        | 9     |
| 01026  | Superhuman Law Division  | 01026.superhuman-law-division-action          | 3     |
| 01026  | Superhuman Law Division  | played                                        | 8     |
| 01026  | Superhuman Law Division  | activation                                    | 5     |
| 01027  | Focused Rage             | 01027.focused-rage-action                     | 20    |
| 01027  | Focused Rage             | played                                        | 9     |
| 01027  | Focused Rage             | activation                                    | 3     |
| 01028  | Superhuman Strength      | 01028.superhuman-strength-forced-response     | 15    |
| 01028  | Superhuman Strength      | played                                        | 24    |
| 01030  | War Machine              | 01030.war-machine-action                      | 5     |
| 01031  | Repulsor Blast           | 01031.repulsor-blast-action                   | 24    |
| 01031  | Repulsor Blast           | played                                        | 3     |
| 01031  | Repulsor Blast           | activation                                    | 156   |
| 01032  | Supersonic Punch         | 01032.supersonic-punch-action                 | 4     |
| 01032  | Supersonic Punch         | played                                        | 4     |
| 01032  | Supersonic Punch         | activation                                    | 157   |
| 01033  | Pepper Potts             | played                                        | 4     |
| 01034  | Stark Tower              | 01034.stark-tower-action                      | 3     |
| 01034  | Stark Tower              | activation                                    | 1     |
| 01035  | Arc Reactor              | 01035.arc-reactor-action                      | 15    |
| 01035  | Arc Reactor              | played                                        | 6     |
| 01036  | Mark V Armor             | played                                        | 16    |
| 01037  | Mark V Helmet            | 01037.mark-v-helmet-action                    | 20    |
| 01037  | Mark V Helmet            | played                                        | 6     |
| 01038  | Powered Gauntlets        | 01038.powered-gauntlets-action                | 30    |
| 01038  | Powered Gauntlets        | played                                        | 15    |
| 01038  | Powered Gauntlets        | activation                                    | 3     |
| 01039  | Rocket Boots             | played                                        | 4     |
| 01039  | Rocket Boots             | activation                                    | 1     |
| 01039  | Rocket Boots             | lasting effect                                | 4     |
| 01041  | Shuri                    | played                                        | 8     |
| 01042  | Ancestral Knowledge      | played                                        | 2     |
| 01042  | Ancestral Knowledge      | activation                                    | 4     |
| 01043a | Wakanda Forever!         | 01043a.wakanda-forever-action                 | 3     |
| 01043a | Wakanda Forever!         | played                                        | 3     |
| 01043a | Wakanda Forever!         | activation                                    | 4     |
| 01043b | Wakanda Forever!         | 01043b.wakanda-forever-action                 | 2     |
| 01043b | Wakanda Forever!         | played                                        | 4     |
| 01043c | Wakanda Forever!         | 01043c.wakanda-forever-action                 | 5     |
| 01043c | Wakanda Forever!         | played                                        | 9     |
| 01043d | Wakanda Forever!         | 01043d.wakanda-forever-action                 | 4     |
| 01043d | Wakanda Forever!         | played                                        | 7     |
| 01043d | Wakanda Forever!         | activation                                    | 4     |
| 01045  | The Golden City          | 01045.the-golden-city-action                  | 16    |
| 01045  | The Golden City          | played                                        | 8     |
| 01046  | Energy Daggers           | played                                        | 15    |
| 01047  | Panther Claws            | 01047.panther-claws-special                   | 4     |
| 01048  | Tactical Genius          | 01048.tactical-genius-special                 | 6     |
| 01048  | Tactical Genius          | played                                        | 12    |
| 01049  | Vibranium Suit           | 01049.vibranium-suit-special                  | 9     |
| 01049  | Vibranium Suit           | played                                        | 24    |
| 01050  | Hulk                     | 01050.hulk-forced-response                    | 81    |
| 01050  | Hulk                     | played                                        | 10    |
| 01050  | Hulk                     | activation                                    | 1     |
| 01051  | Tigra                    | 01051.tigra-response                          | 3     |
| 01051  | Tigra                    | played                                        | 4     |
| 01051  | Tigra                    | activation                                    | 2     |
| 01052  | Chase Them Down          | 01052.chase-them-down-response                | 4     |
| 01052  | Chase Them Down          | played                                        | 4     |
| 01053  | Relentless Assault       | 01053.relentless-assault-action               | 32    |
| 01053  | Relentless Assault       | played                                        | 17    |
| 01054  | Uppercut                 | 01054.uppercut-action                         | 15    |
| 01054  | Uppercut                 | played                                        | 10    |
| 01054  | Uppercut                 | activation                                    | 13    |
| 01055  | The Power of Aggression  | activation                                    | 5     |
| 01056  | Tac Team                 | 01056.tac-team-action                         | 74    |
| 01056  | Tac Team                 | played                                        | 33    |
| 01056  | Tac Team                 | activation                                    | 7     |
| 01057  | Combat Training          | played                                        | 35    |
| 01057  | Combat Training          | activation                                    | 7     |
| 01058  | Daredevil                | 01058.daredevil-response                      | 12    |
| 01058  | Daredevil                | played                                        | 24    |
| 01058  | Daredevil                | activation                                    | 53    |
| 01059  | Jessica Jones            | played                                        | 32    |
| 01059  | Jessica Jones            | activation                                    | 72    |
| 01060  | For Justice!             | 01060.for-justice-action                      | 32    |
| 01060  | For Justice!             | played                                        | 24    |
| 01060  | For Justice!             | activation                                    | 288   |
| 01061  | Great Responsibility     | 01061.great-responsibility-interrupt          | 50    |
| 01061  | Great Responsibility     | played                                        | 49    |
| 01061  | Great Responsibility     | activation                                    | 1     |
| 01062  | The Power of Justice     | activation                                    | 1     |
| 01063  | Interrogation Room       | 01063.interrogation-room-response             | 15    |
| 01063  | Interrogation Room       | played                                        | 44    |
| 01063  | Interrogation Room       | activation                                    | 71    |
| 01064  | Surveillance Team        | 01064.surveillance-team-action                | 177   |
| 01064  | Surveillance Team        | played                                        | 92    |
| 01065  | Heroic Intuition         | played                                        | 50    |
| 01065  | Heroic Intuition         | activation                                    | 100   |
| 01066  | Hawkeye                  | 01066.hawkeye-constant                        | 22    |
| 01066  | Hawkeye                  | 01066.hawkeye-response                        | 16    |
| 01066  | Hawkeye                  | played                                        | 20    |
| 01067  | Maria Hill               | 01067.maria-hill-response                     | 2     |
| 01067  | Maria Hill               | played                                        | 8     |
| 01068  | Vision                   | 01068.vision-action                           | 8     |
| 01068  | Vision                   | played                                        | 2     |
| 01068  | Vision                   | activation                                    | 43    |
| 01068  | Vision                   | lasting effect                                | 6     |
| 01069  | Get Ready                | 01069.get-ready-action                        | 4     |
| 01069  | Get Ready                | played                                        | 3     |
| 01069  | Get Ready                | activation                                    | 8     |
| 01070  | Lead from the Front      | 01070.lead-from-the-front-action              | 8     |
| 01070  | Lead from the Front      | played                                        | 8     |
| 01070  | Lead from the Front      | lasting effect                                | 40    |
| 01071  | Make the Call            | 01071.make-the-call-action                    | 6     |
| 01071  | Make the Call            | played                                        | 3     |
| 01072  | The Power of Leadership  | activation                                    | 2     |
| 01073  | The Triskelion           | played                                        | 10    |
| 01074  | Inspired                 | played                                        | 44    |
| 01075  | Black Widow              | 01075.black-widow-interrupt                   | 12    |
| 01075  | Black Widow              | played                                        | 6     |
| 01076  | Luke Cage                | played                                        | 12    |
| 01076  | Luke Cage                | activation                                    | 3     |
| 01077  | Counter-Punch            | 01077.counter-punch-response                  | 17    |
| 01077  | Counter-Punch            | played                                        | 18    |
| 01077  | Counter-Punch            | activation                                    | 328   |
| 01078  | Get Behind Me!           | 01078.get-behind-me-interrupt                 | 35    |
| 01078  | Get Behind Me!           | played                                        | 6     |
| 01079  | The Power of Protection  | activation                                    | 4     |
| 01080  | Med Team                 | 01080.med-team-action                         | 23    |
| 01080  | Med Team                 | played                                        | 18    |
| 01081  | Armored Vest             | played                                        | 17    |
| 01081  | Armored Vest             | activation                                    | 8     |
| 01082  | Indomitable              | 01082.indomitable-response                    | 27    |
| 01082  | Indomitable              | played                                        | 36    |
| 01083  | Mockingbird              | 01083.mockingbird-response                    | 35    |
| 01083  | Mockingbird              | played                                        | 41    |
| 01083  | Mockingbird              | activation                                    | 4     |
| 01084  | Nick Fury                | 01084.nick-fury-forced-response               | 67    |
| 01084  | Nick Fury                | played                                        | 41    |
| 01084  | Nick Fury                | activation                                    | 3     |
| 01085  | Emergency                | 01085.emergency-interrupt                     | 37    |
| 01085  | Emergency                | played                                        | 70    |
| 01085  | Emergency                | activation                                    | 5     |
| 01086  | First Aid                | 01086.first-aid-action                        | 33    |
| 01086  | First Aid                | played                                        | 23    |
| 01086  | First Aid                | activation                                    | 3     |
| 01087  | Haymaker                 | 01087.haymaker-action                         | 63    |
| 01087  | Haymaker                 | played                                        | 40    |
| 01087  | Haymaker                 | activation                                    | 11    |
| 01088  | Energy                   | activation                                    | 42    |
| 01089  | Genius                   | activation                                    | 7     |
| 01090  | Strength                 | activation                                    | 412   |
| 01091  | Avengers Mansion         | 01091.avengers-mansion-action                 | 63    |
| 01091  | Avengers Mansion         | played                                        | 23    |
| 01091  | Avengers Mansion         | activation                                    | 8     |
| 01092  | Helicarrier              | 01092.helicarrier-action                      | 100   |
| 01092  | Helicarrier              | played                                        | 48    |
| 01092  | Helicarrier              | activation                                    | 7     |
| 01092  | Helicarrier              | lasting effect                                | 50    |
| 01093  | Tenacity                 | 01093.tenacity-action                         | 70    |
| 01093  | Tenacity                 | played                                        | 87    |
| 01093  | Tenacity                 | activation                                    | 4     |
| 01094  | Rhino                    | 01096.when-revealed                           | 2     |
| 01094  | Rhino                    | activation                                    | 3598  |
| 01094  | Rhino                    | revealed                                      | 0     |
| 01098  | Armored Rhino Suit       | 01098.armored-rhino-suit-forced-interrupt     | 28    |
| 01098  | Armored Rhino Suit       | revealed                                      | 15    |
| 01099  | Charge                   | 01099.charge-forced-interrupt                 | 7     |
| 01099  | Charge                   | revealed                                      | 31    |
| 01100  | Enhanced Ivory Horn      | 01100.enhanced-ivory-horn-action              | 12    |
| 01100  | Enhanced Ivory Horn      | revealed                                      | 19    |
| 01101  | Hydra Mercenary          | revealed                                      | 58    |
| 01101  | Hydra Mercenary          | activation                                    | 9     |
| 01102  | Sandman                  | revealed                                      | 24    |
| 01102  | Sandman                  | activation                                    | 366   |
| 01103  | Shocker                  | 01103.when-revealed                           | 7     |
| 01103  | Shocker                  | revealed                                      | 10    |
| 01103  | Shocker                  | activation                                    | 2     |
| 01104  | Hard to Keep Down        | 01104.when-revealed                           | 30    |
| 01104  | Hard to Keep Down        | revealed                                      | 34    |
| 01104  | Hard to Keep Down        | keyword surge                                 | 2     |
| 01105  | "I'm Tough!"             | 01105.when-revealed                           | 69    |
| 01105  | "I'm Tough!"             | revealed                                      | 77    |
| 01105  | "I'm Tough!"             | keyword surge                                 | 1     |
| 01106  | Stampede                 | 01106.when-revealed-hero                      | 38    |
| 01106  | Stampede                 | revealed                                      | 52    |
| 01106  | Stampede                 | keyword surge                                 | 8     |
| 01107  | Breakin' & Takin'        | 01107.when-revealed                           | 26    |
| 01107  | Breakin' & Takin'        | revealed                                      | 22    |
| 01108  | Crowd Control            | revealed                                      | 231   |
| 01109  | Bomb Scare               | 01109.when-revealed                           | 30    |
| 01109  | Bomb Scare               | revealed                                      | 30    |
| 01110  | Hydra Bomber             | 01110.when-revealed                           | 46    |
| 01110  | Hydra Bomber             | revealed                                      | 48    |
| 01110  | Hydra Bomber             | activation                                    | 21    |
| 01111  | Explosion                | 01111.when-revealed                           | 9     |
| 01111  | Explosion                | revealed                                      | 20    |
| 01111  | Explosion                | keyword surge                                 | 6     |
| 01112  | False Alarm              | 01112.when-revealed                           | 22    |
| 01112  | False Alarm              | revealed                                      | 38    |
| 01112  | False Alarm              | keyword surge                                 | 2     |
| 01113  | Klaw                     | 01113.klaw-forced-interrupt                   | 101   |
| 01113  | Klaw                     | 01114.klaw-forced-interrupt                   | 5     |
| 01113  | Klaw                     | activation                                    | 1833  |
| 01113  | Klaw                     | revealed                                      | 0     |
| 01116a | Underground Distribution | 01117a.when-revealed                          | 247   |
| 01118  | Sonic Converter          | 01118.sonic-converter-action                  | 4     |
| 01118  | Sonic Converter          | revealed                                      | 7     |
| 01120  | Armored Guard            | revealed                                      | 39    |
| 01120  | Armored Guard            | activation                                    | 389   |
| 01121  | Weapons Runner           | 01121.boost                                   | 78    |
| 01121  | Weapons Runner           | revealed                                      | 18    |
| 01121  | Weapons Runner           | activation                                    | 290   |
| 01121  | Weapons Runner           | keyword surge                                 | 8     |
| 01122  | Klaw's Vengeance         | 01122.when-revealed-alter-ego                 | 36    |
| 01122  | Klaw's Vengeance         | 01122.when-revealed-hero                      | 53    |
| 01122  | Klaw's Vengeance         | revealed                                      | 28    |
| 01123  | Sonic Boom               | 01123.when-revealed                           | 20    |
| 01123  | Sonic Boom               | 01123.boost                                   | 21    |
| 01123  | Sonic Boom               | revealed                                      | 18    |
| 01124  | Sound Manipulation       | 01124.when-revealed-alter-ego                 | 11    |
| 01124  | Sound Manipulation       | 01124.when-revealed-hero                      | 9     |
| 01124  | Sound Manipulation       | revealed                                      | 23    |
| 01124  | Sound Manipulation       | keyword surge                                 | 2     |
| 01126  | Illegal Arms Factory     | 01126.when-revealed                           | 6     |
| 01126  | Illegal Arms Factory     | revealed                                      | 6     |
| 01127  | The "Immortal" Klaw      | revealed                                      | 6     |
| 01128  | The Masters of Evil      | 01128.when-revealed                           | 42    |
| 01128  | The Masters of Evil      | revealed                                      | 6     |
| 01129  | Radioactive Man          | 01129.radioactive-man-forced-response         | 16    |
| 01129  | Radioactive Man          | 01129.boost                                   | 20    |
| 01129  | Radioactive Man          | revealed                                      | 6     |
| 01129  | Radioactive Man          | activation                                    | 44    |
| 01130  | Whirlwind                | 01130.whirlwind-forced-interrupt              | 29    |
| 01130  | Whirlwind                | 01130.boost                                   | 1     |
| 01130  | Whirlwind                | revealed                                      | 12    |
| 01130  | Whirlwind                | activation                                    | 38    |
| 01131  | Tiger Shark              | 01131.tiger-shark-forced-response             | 22    |
| 01131  | Tiger Shark              | 01131.boost                                   | 15    |
| 01131  | Tiger Shark              | revealed                                      | 12    |
| 01131  | Tiger Shark              | activation                                    | 462   |
| 01132  | Melter                   | 01132.boost                                   | 7     |
| 01132  | Melter                   | revealed                                      | 8     |
| 01132  | Melter                   | activation                                    | 803   |
| 01133  | Masters of Mayhem        | 01133.when-revealed                           | 25    |
| 01133  | Masters of Mayhem        | revealed                                      | 14    |
| 01134  | Ultron                   | 01134.ultron-forced-response                  | 151   |
| 01134  | Ultron                   | 01135.ultron-forced-interrupt                 | 9     |
| 01134  | Ultron                   | activation                                    | 2063  |
| 01134  | Ultron                   | lasting effect                                | 6     |
| 01134  | Ultron                   | revealed                                      | 0     |
| 01137a | The Crimson Cowl         | 01138b.assault-on-norad-forced-response       | 240   |
| 01137a | The Crimson Cowl         | 01138a.when-revealed                          | 72    |
| 01137a | The Crimson Cowl         | 01139a.when-revealed                          | 81    |
| 01141  | Program Transmitter      | revealed                                      | 39    |
| 01142  | Upgraded Drones          | 01142.upgraded-drones-action                  | 9     |
| 01142  | Upgraded Drones          | revealed                                      | 18    |
| 01143  | Advanced Ultron Drone    | revealed                                      | 14    |
| 01143  | Advanced Ultron Drone    | activation                                    | 100   |
| 01144a | Android Efficiency       | 01144a.when-revealed                          | 12    |
| 01144a | Android Efficiency       | 01144a.boost                                  | 18    |
| 01144a | Android Efficiency       | revealed                                      | 8     |
| 01144b | Android Efficiency       | 01144b.boost                                  | 18    |
| 01144c | Android Efficiency       | 01144c.when-revealed                          | 6     |
| 01144c | Android Efficiency       | 01144c.boost                                  | 26    |
| 01144c | Android Efficiency       | revealed                                      | 4     |
| 01145  | Rage of Ultron           | 01145.when-revealed-alter-ego                 | 31    |
| 01145  | Rage of Ultron           | 01145.when-revealed-hero                      | 51    |
| 01145  | Rage of Ultron           | revealed                                      | 16    |
| 01146  | Repair Sequence          | 01146.when-revealed                           | 7     |
| 01146  | Repair Sequence          | 01146.boost                                   | 7     |
| 01146  | Repair Sequence          | revealed                                      | 13    |
| 01146  | Repair Sequence          | keyword surge                                 | 3     |
| 01147  | Swarm Attack             | 01147.when-revealed                           | 4     |
| 01147  | Swarm Attack             | revealed                                      | 9     |
| 01148  | Drone Factory            | 01148.when-revealed                           | 12    |
| 01148  | Drone Factory            | revealed                                      | 6     |
| 01149  | Invasive AI              | 01149.when-revealed                           | 42    |
| 01149  | Invasive AI              | revealed                                      | 18    |
| 01150  | Ultron's Imperative      | 01150.when-revealed                           | 30    |
| 01150  | Ultron's Imperative      | revealed                                      | 18    |
| 01151  | Under Attack             | 01151.when-revealed                           | 89    |
| 01151  | Under Attack             | revealed                                      | 19    |
| 01152  | Vibranium Armor          | 01152.vibranium-armor-forced-response         | 6     |
| 01152  | Vibranium Armor          | revealed                                      | 18    |
| 01153  | Concussion Blasters      | revealed                                      | 5     |
| 01154  | Concussive Blast         | 01154.when-revealed                           | 20    |
| 01154  | Concussive Blast         | 01154.boost                                   | 9     |
| 01154  | Concussive Blast         | revealed                                      | 19    |
| 01155  | Affairs of State         | 01155.obligation                              | 19    |
| 01155  | Affairs of State         | revealed                                      | 10    |
| 01156  | Usurp the Throne         | revealed                                      | 12    |
| 01157  | Killmonger               | revealed                                      | 8     |
| 01157  | Killmonger               | activation                                    | 219   |
| 01158  | Heart-Shaped Herb        | 01158.when-revealed                           | 3     |
| 01158  | Heart-Shaped Herb        | revealed                                      | 2     |
| 01158  | Heart-Shaped Herb        | keyword surge                                 | 1     |
| 01159  | Ritual Combat            | 01159.when-revealed                           | 4     |
| 01159  | Ritual Combat            | revealed                                      | 2     |
| 01160  | Legal Work               | 01160.obligation                              | 14    |
| 01160  | Legal Work               | revealed                                      | 12    |
| 01161  | Personal Challenge       | 01161.when-revealed                           | 6     |
| 01161  | Personal Challenge       | revealed                                      | 7     |
| 01162  | Titania                  | revealed                                      | 4     |
| 01162  | Titania                  | activation                                    | 7     |
| 01163  | Genetically Enhanced     | 01163.genetically-enhanced-constant           | 2     |
| 01163  | Genetically Enhanced     | revealed                                      | 5     |
| 01163  | Genetically Enhanced     | keyword surge                                 | 1     |
| 01164  | Titania's Fury           | 01164.when-revealed                           | 4     |
| 01164  | Titania's Fury           | 01164.boost                                   | 1     |
| 01164  | Titania's Fury           | revealed                                      | 6     |
| 01164  | Titania's Fury           | keyword surge                                 | 1     |
| 01165  | Eviction Notice          | 01165.obligation                              | 27    |
| 01165  | Eviction Notice          | revealed                                      | 18    |
| 01165  | Eviction Notice          | keyword surge                                 | 6     |
| 01166  | Highway Robbery          | 01166.when-revealed                           | 55    |
| 01166  | Highway Robbery          | 01166.when-defeated                           | 16    |
| 01166  | Highway Robbery          | revealed                                      | 11    |
| 01167  | Vulture                  | revealed                                      | 40    |
| 01167  | Vulture                  | activation                                    | 16    |
| 01168  | Sweeping Swoop           | 01168.when-revealed                           | 18    |
| 01168  | Sweeping Swoop           | 01168.boost                                   | 3     |
| 01168  | Sweeping Swoop           | revealed                                      | 45    |
| 01168  | Sweeping Swoop           | keyword surge                                 | 14    |
| 01169  | The Vulture's Plans      | 01169.when-revealed                           | 8     |
| 01169  | The Vulture's Plans      | revealed                                      | 4     |
| 01170  | Business Problems        | 01170.obligation                              | 10    |
| 01170  | Business Problems        | revealed                                      | 6     |
| 01171  | Imminent Overload        | 01171.when-revealed                           | 4     |
| 01171  | Imminent Overload        | revealed                                      | 4     |
| 01172  | Whiplash                 | revealed                                      | 2     |
| 01173  | Electric Whip Attack     | 01173.when-revealed                           | 4     |
| 01173  | Electric Whip Attack     | 01173.boost                                   | 2     |
| 01173  | Electric Whip Attack     | revealed                                      | 4     |
| 01174  | Electromagnetic Backlash | 01174.when-revealed                           | 12    |
| 01174  | Electromagnetic Backlash | revealed                                      | 2     |
| 01175  | Family Emergency         | 01175.obligation                              | 9     |
| 01175  | Family Emergency         | revealed                                      | 6     |
| 01175  | Family Emergency         | keyword surge                                 | 1     |
| 01176  | The Psyche-Magnitron     | 01176.when-revealed                           | 2     |
| 01176  | The Psyche-Magnitron     | revealed                                      | 2     |
| 01177  | Yon-Rogg                 | 01177.yon-rogg-forced-response                | 2     |
| 01177  | Yon-Rogg                 | revealed                                      | 2     |
| 01177  | Yon-Rogg                 | activation                                    | 1     |
| 01178  | Kree Manipulator         | 01178.when-revealed                           | 2     |
| 01178  | Kree Manipulator         | 01178.boost                                   | 2     |
| 01178  | Kree Manipulator         | revealed                                      | 3     |
| 01178  | Kree Manipulator         | keyword surge                                 | 1     |
| 01179  | Yon-Rogg's Treason       | 01179.when-revealed                           | 8     |
| 01179  | Yon-Rogg's Treason       | revealed                                      | 4     |
| 01179  | Yon-Rogg's Treason       | keyword surge                                 | 1     |
| 01180  | Legions of Hydra         | 01180.when-revealed                           | 12    |
| 01180  | Legions of Hydra         | revealed                                      | 6     |
| 01181  | Madame Hydra             | 01181.madame-hydra-forced-response            | 9     |
| 01181  | Madame Hydra             | revealed                                      | 6     |
| 01181  | Madame Hydra             | activation                                    | 14    |
| 01182  | Hydra Soldier            | 01182.when-defeated                           | 12    |
| 01182  | Hydra Soldier            | revealed                                      | 14    |
| 01182  | Hydra Soldier            | activation                                    | 12    |
| 01183  | The Doomsday Chair       | 01183.when-revealed                           | 16    |
| 01183  | The Doomsday Chair       | revealed                                      | 12    |
| 01184  | M.O.D.O.K.               | activation                                    | 399   |
| 01185  | Biomechanical Upgrades   | 01185.biomechanical-upgrades-forced-interrupt | 3     |
| 01185  | Biomechanical Upgrades   | revealed                                      | 11    |
| 01185  | Biomechanical Upgrades   | keyword surge                                 | 4     |
| 01186  | Advance                  | 01186.when-revealed                           | 70    |
| 01186  | Advance                  | revealed                                      | 109   |
| 01187  | Assault                  | 01187.when-revealed-alter-ego                 | 16    |
| 01187  | Assault                  | 01187.when-revealed-hero                      | 16    |
| 01187  | Assault                  | revealed                                      | 35    |
| 01187  | Assault                  | keyword surge                                 | 11    |
| 01188  | Caught Off Guard         | 01188.when-revealed                           | 44    |
| 01188  | Caught Off Guard         | revealed                                      | 43    |
| 01188  | Caught Off Guard         | keyword surge                                 | 4     |
| 01189  | Gang-Up                  | 01189.when-revealed-alter-ego                 | 26    |
| 01189  | Gang-Up                  | 01189.when-revealed-hero                      | 26    |
| 01189  | Gang-Up                  | revealed                                      | 68    |
| 01189  | Gang-Up                  | keyword surge                                 | 18    |
| 01190  | Shadow of the Past       | 01190.when-revealed                           | 71    |
| 01190  | Shadow of the Past       | revealed                                      | 28    |
| 01190  | Shadow of the Past       | keyword surge                                 | 1     |
| 01191  | Exhaustion               | 01191.when-revealed                           | 4     |
| 01191  | Exhaustion               | revealed                                      | 4     |
| 01191  | Exhaustion               | keyword surge                                 | 2     |
| 01192  | Masterplan               | 01192.when-revealed                           | 10    |
| 01192  | Masterplan               | revealed                                      | 6     |
| 01193  | Under Fire               | 01193.when-revealed                           | 1     |
| 01193  | Under Fire               | revealed                                      | 2     |
| 01193  | Under Fire               | keyword surge                                 | 1     |

## How the table shows things (what the check accepts)

Beat fields (`BEAT_FIELDS`): a beat with a "table" field is played out on the table by `present()` in main.ts.

| Field             | Class | Where                                                                                 |
| ----------------- | ----- | ------------------------------------------------------------------------------------- |
| text              | meta  | the dock's title and its feed                                                         |
| enemy             | meta  | the dock's colour (villain or hero)                                                   |
| activity          | meta  | the dock's eyebrow in the villain phase                                               |
| actor             | meta  | the card is marked on the table while the words show (markActor): words, not a change |
| round             | meta  | the round on a phase banner                                                           |
| random            | meta  | with handDiscard/tucked: a light hops across the hand first                           |
| penalty           | meta  | with encounterDeal: marks the deal as the run-out price                               |
| returnedFrom      | meta  | with returned: where the cards fly from                                               |
| nemesis           | meta  | with intoEncounterDeck: the nemesis set's cards                                       |
| removedFromGame   | meta  | with leftPlay: the card evaporates instead of going to a pile                         |
| millSource        | meta  | with milled: the card that did it, and the miss line                                  |
| droneWas          | meta  | with defeatedCard: the card under the Drone, named                                    |
| gameEnded         | meta  | ends the play-out; the game-over panel follows                                        |
| phase             | table | the phase banner (Your turn / Villain phase)                                          |
| statusChange      | table | a status card added to or taken off the card, with a ring                             |
| enemyActivation   | table | the enemy activates: it lifts and is stamped                                          |
| scheming          | table | the enemy is stamped Schemes                                                          |
| discardEvent      | table | the event card flies to the discard pile                                              |
| interrupt         | table | the card pulses (an interrupt), cancelling what it is held over                       |
| deflection        | table | the attack is knocked away by the card, Blocked floats up                             |
| modifier          | table | a stat token on the card, with a ring                                                 |
| attackAim         | table | the attacker aims at its target                                                       |
| stunnedAttempt    | table | the stunned enemy strains, its stun goes                                              |
| turned            | table | the card turns (exhausts or readies)                                                  |
| draw              | table | cards fly from the deck into the hand                                                 |
| encounterDeal     | table | an encounter card flies to the player facedown                                        |
| villainStage      | table | the villain card turns to its next stage                                              |
| villainFlip       | table | the villain card flips                                                                |
| schemeAdvance     | table | the main scheme turns to its next stage                                               |
| entersPlay        | table | the card comes onto the table                                                         |
| droneIn           | table | the card leaves its pile facedown as a Drone                                          |
| defeat            | table | the Defeated stamp and banner                                                         |
| defeatedCard      | table | the card flashes and leaves for its pile                                              |
| leftPlay          | table | the card leaves the table for its pile                                                |
| handDiscard       | table | the cards fly from the hand to the discard pile                                       |
| returned          | table | the cards fly back into the hand                                                      |
| milled            | table | the deck's top cards turn up and go to the discard pile                               |
| encounterMilled   | table | the encounter deck's top cards turn up and go to its discard pile                     |
| tucked            | table | the cards go facedown under the card                                                  |
| deckReset         | table | the discard pile shuffles into a new deck                                             |
| intoEncounterDeck | table | the cards are shown and shuffled into the encounter deck                              |
| encounterReset    | table | the encounter discard pile shuffles into a new deck                                   |
| acceleration      | table | an acceleration token on the main scheme, stamped                                     |
| overkill          | table | the Overkill stamp on the card the damage spills onto                                 |
| discount          | table | the cost stamp on the card that gave it                                               |
| nothingFound      | table | the No target stamp on the card                                                       |
| boostFor          | table | the boost card lies facedown beside its enemy                                         |
| surge             | table | the Surge! stamp, then the extra card                                                 |
| reveal            | table | the encounter card turns up in the middle of the table                                |
| encounterResolved | table | the revealed card goes to the encounter discard pile                                  |
| activate          | table | the card's ability is shown activating on it                                          |
| threat            | table | threat flies onto or off the scheme                                                   |
| hit               | table | the strike, the damage burst and the hit-point label                                  |

The table's standing picture (`STANDING`): a change with no beat still counts as shown when the picture changes:

| Change       | Where it is seen                                                                             |
| ------------ | -------------------------------------------------------------------------------------------- |
| zone         | the card is seen in a new place (hand, table, a discard pile, under a card, beside an enemy) |
| faceup       | the card is seen faceup or facedown                                                          |
| damage       | the damage marker or hit-point label on the card                                             |
| threat       | the threat on the scheme                                                                     |
| statuses     | the status markers on the card                                                               |
| counters     | the counters on the card                                                                     |
| exhausted    | the card is drawn turned                                                                     |
| attachedTo   | the card is drawn on its host                                                                |
| tucked       | the tucked count on the card                                                                 |
| stats        | the stat tokens on the card (its markers)                                                    |
| villainStage | the villain card's picture and name                                                          |
| acceleration | the acceleration marker on the main scheme                                                   |

Engine events (`EVENT_RULES`): "bookkeeping" has no game fact of its own; "state" is checked as the change it
makes; "beat" leaves nothing in the state to see, so a beat must name its card.

| Event                          | Rule        | Why / what                                                                          |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------- |
| abilityIgnored                 | beat        | an ability ignored                                                                  |
| abilityNotOffered              | beat        | an ability not offered                                                              |
| abilityResolved                | beat        | the ability fired                                                                   |
| abilityUseRecorded             | bookkeeping | a use limit counted                                                                 |
| accelerationTokenAdded         | state       | checked as the change it makes                                                      |
| activationAwaitsAbility        | bookkeeping | the activation waits for a question the dock asks                                   |
| activationBlocked              | beat        | an activation blocked                                                               |
| activationCancelled            | beat        | an activation cancelled                                                             |
| activationSkipped              | beat        | an activation skipped                                                               |
| attackAwaitsAbility            | bookkeeping | the attack waits for a question the dock asks                                       |
| attackResolved                 | bookkeeping | the attack's damage is a change of its own                                          |
| attackResumed                  | bookkeeping | the attack goes on: what it does is checked                                         |
| basicPowerNotMade              | beat        | a basic power not made                                                              |
| boostCancelled                 | beat        | a boost cancelled                                                                   |
| boostCardDealt                 | state       | checked as the change it makes                                                      |
| boostCardFlipped               | state       | checked as the change it makes                                                      |
| boostIconsCounted              | bookkeeping | the attack's numbers line says the boost ("2 SCH · 1 boost")                        |
| boostIgnored                   | beat        | a boost ignored                                                                     |
| boostWithheld                  | beat        | a boost withheld                                                                    |
| cardDiscardedFromDeck          | state       | checked as the change it makes                                                      |
| cardDiscardedFromEncounterDeck | state       | checked as the change it makes                                                      |
| cardDiscardedFromHand          | state       | checked as the change it makes                                                      |
| cardDiscardedFromPlay          | state       | checked as the change it makes                                                      |
| cardDrawn                      | state       | checked as the change it makes                                                      |
| cardExhausted                  | state       | checked as the change it makes                                                      |
| cardFound                      | beat        | a card found by a search                                                            |
| cardMoved                      | state       | checked as the change it makes                                                      |
| cardPlayed                     | state       | checked as the change it makes                                                      |
| cardPutIntoPlayFacedown        | state       | checked as the change it makes                                                      |
| cardReadied                    | state       | checked as the change it makes                                                      |
| cardsLookedAt                  | beat        | cards looked at                                                                     |
| cardTurnedFacedown             | state       | checked as the change it makes                                                      |
| cardTurnedFaceup               | state       | checked as the change it makes                                                      |
| characterDefeated              | state       | checked as the change it makes                                                      |
| choiceFoundNothing             | beat        | a choice with nothing to choose                                                     |
| choiceRequested                | bookkeeping | the question is the dock's                                                          |
| choiceResolved                 | bookkeeping | the player's own answer                                                             |
| costDamageSettled              | bookkeeping | a cost the player chose to pay                                                      |
| costPartPaidBy                 | bookkeeping | the payment screen showed it                                                        |
| counterAdded                   | state       | checked as the change it makes                                                      |
| counterRemoved                 | state       | checked as the change it makes                                                      |
| damageBeyondZeroLost           | bookkeeping | damage past the last hit point: the card is defeated                                |
| damageCapped                   | beat        | damage capped                                                                       |
| damageDealt                    | state       | checked as the change it makes                                                      |
| damageDoubled                  | beat        | damage doubled                                                                      |
| damageHealed                   | state       | checked as the change it makes                                                      |
| damageIncreased                | beat        | damage increased                                                                    |
| damageNotDealt                 | beat        | damage not dealt                                                                    |
| damagePlaced                   | state       | checked as the change it makes                                                      |
| damagePrevented                | beat        | damage prevented                                                                    |
| damageReduced                  | beat        | damage reduced                                                                      |
| deckShuffled                   | beat        | a deck shuffled                                                                     |
| deckStacked                    | bookkeeping | set-up only                                                                         |
| deckTopShown                   | beat        | the deck's top card shown                                                           |
| defenderDeclared               | bookkeeping | the player's own answer                                                             |
| defenseDeclined                | bookkeeping | the player's own answer                                                             |
| discardRefused                 | beat        | a discard refused                                                                   |
| encounterCardDealt             | state       | checked as the change it makes                                                      |
| encounterCardPassed            | beat        | an encounter card passed on                                                         |
| encounterCardRevealed          | state       | checked as the change it makes                                                      |
| encounterTopShown              | beat        | the encounter deck's top card shown                                                 |
| enemyActivated                 | beat        | the enemy activates                                                                 |
| firstPlayerChanged             | bookkeeping | one player: always first                                                            |
| formChanged                    | state       | checked as the change it makes                                                      |
| framePopped                    | bookkeeping | the engine's stack                                                                  |
| framePushed                    | bookkeeping | the engine's stack                                                                  |
| gameEnded                      | bookkeeping | the game-over panel                                                                 |
| handRefilled                   | bookkeeping | each card drawn is a change of its own                                              |
| healBlocked                    | beat        | healing blocked                                                                     |
| interruptConditionLapsed       | beat        | an interrupt's condition lapsed                                                     |
| keywordResolved                | beat        | a keyword resolved                                                                  |
| lastingEffectAdded             | beat        | an effect that lasts begins                                                         |
| lastingEffectEnded             | beat        | an effect that lasts ends                                                           |
| leavePlayBlocked               | beat        | a card kept in play                                                                 |
| mainSchemeAdvanced             | state       | checked as the change it makes                                                      |
| mainSchemeCompleted            | state       | the game ends: the game-over panel                                                  |
| optionChosen                   | bookkeeping | the player's answer, or the only one there was: what it does is checked             |
| overkillSpilled                | beat        | overkill                                                                            |
| paymentCommitted               | bookkeeping | the payment screen showed it                                                        |
| playCostReduced                | beat        | a cost reduced                                                                      |
| playerDeckReset                | state       | checked as the change it makes                                                      |
| playerEliminated               | bookkeeping | the game-over panel                                                                 |
| preThenUnresolved              | beat        | the text before a 'then' did not resolve                                            |
| putIntoPlayRefused             | beat        | a card kept out of play                                                             |
| resourcesGenerated             | bookkeeping | the payment screen showed it                                                        |
| retaliateIgnoredByRanged       | beat        | retaliate ignored by ranged                                                         |
| revealCancelled                | beat        | a revealed card cancelled                                                           |
| revealReplaced                 | beat        | a reveal replaced                                                                   |
| roundStarted                   | bookkeeping | the phase banner shows the round                                                    |
| schemeDefeated                 | state       | checked as the change it makes                                                      |
| schemeResolved                 | bookkeeping | the scheme's threat is a change of its own                                          |
| searchFoundNothing             | beat        | a search that found nothing                                                         |
| setupOptionApplied             | bookkeeping | set-up only                                                                         |
| statusGiven                    | state       | checked as the change it makes                                                      |
| statusRemoved                  | state       | checked as the change it makes                                                      |
| stepChanged                    | bookkeeping | the phase banner and the dock's eyebrow                                             |
| surgeTriggered                 | beat        | surge                                                                               |
| targetChosen                   | bookkeeping | the player's answer, or the only one there was: what it does to the card is checked |
| thenSkipped                    | beat        | the text after a 'then' was skipped                                                 |
| threatPlaced                   | state       | checked as the change it makes                                                      |
| threatPrevented                | beat        | threat prevented                                                                    |
| threatRemovalBlocked           | beat        | threat removal blocked                                                              |
| threatRemoved                  | state       | checked as the change it makes                                                      |
| triggerEvent                   | bookkeeping | the engine's timing points                                                          |
| turnEnded                      | bookkeeping | the phase banner shows the turn                                                     |
| turnStarted                    | bookkeeping | the phase banner shows the turn                                                     |
| uniqueEntryBlocked             | beat        | a unique card kept out                                                              |
| villainFlipped                 | state       | checked as the change it makes                                                      |
| villainStageAdvanced           | state       | checked as the change it makes                                                      |
| villainStageRevealed           | state       | checked as the change it makes                                                      |
| windowOpened                   | bookkeeping | a timing window: what is used in it is checked                                      |

Event types met with no rule yet: none.
