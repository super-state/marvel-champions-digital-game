import { activeEncounterDeck, activeEncounterDeckId, cardOf, type GameState, type InstanceId } from "@mc/engine";
import type { VillainId } from "./model.js";

/**
 * Table set-ups for looking at the presentation without playing a game to them: `/battle/?scene=crowded`.
 * They rearrange the opening state the way the deck-audit tests do; the game then plays on normally from there.
 */

interface Placement {
  code: string;
  damage?: number;
  threat?: number;
  statuses?: Record<string, number>;
  counters?: Record<string, number>;
  exhausted?: boolean;
  /** Player cards lying facedown under it (Highway Robbery's stolen cards). */
  tuck?: string[];
}

interface Scene {
  /** The scenario it is dealt from: Rhino unless it says otherwise. */
  scenario?: VillainId;
  hero?: { form?: "hero" | "alterEgo"; damage?: number; statuses?: Record<string, number>; exhausted?: boolean };
  /** `lastStage`: the stage the villain is on is his last, so defeating it wins the game (a scene's shortcut). */
  villain?: { damage?: number; statuses?: Record<string, number>; lastStage?: boolean };
  /** Dealt for whichever hero the address or the bench chose, not Spider-Man: it uses none of his cards. */
  anyHero?: true;
  /** Goes on the record like a real game when the address also says `&record=1` (the driven win's browser test). */
  recorded?: true;
  mainThreat?: number;
  /** Player cards in play (allies, supports, upgrades). */
  play?: Placement[];
  /** Minions engaged with the hero. */
  minions?: Placement[];
  /**
   * Player cards put into play facedown as Drone minions (Ultron's scenario only, which always has one to copy the
   * role from): `code` is the card under each, known only once the Drone is defeated.
   */
  drones?: Placement[];
  /** The main scheme's stage, counted from 1 (Ultron's Countdown to Oblivion is 3). */
  mainStage?: number;
  /** Side schemes in the villain area. */
  schemes?: Placement[];
  /** Encounter attachments on the villain. */
  villainAttachments?: Placement[];
  /** Encounter attachments on Ultron's environment, Ultron Drones (Upgraded Drones attaches there, not to Ultron). */
  environmentAttachments?: Placement[];
  /** Cards to have in hand (the rest of the hand is refilled from the deck). */
  hand?: string[];
  /** The top of the player's deck, top first. */
  deckTop?: string[];
  /** The top of the encounter deck, top first (Rhino's boost card comes off it before the encounter deal). */
  encounterTop?: string[];
  /** Encounter cards already dealt facedown to the player, first revealed first (an extra card dealt earlier). */
  dealt?: string[];
  /** Cards left in the player's deck; the rest go to the discard pile (to run the deck out). */
  deckLeft?: number;
  /** Cards left in the encounter deck; the rest go to its discard pile (to run it out). */
  encounterLeft?: number;
  /**
   * The minions setup put into play go to the encounter discard pile first (Klaw's main scheme brings one in, and a
   * guard among them would stop the hero attacking Klaw), so the scene's own `minions` are the only ones engaged.
   */
  clearMinions?: boolean;
}

const SCENES: Record<string, Scene> = {
  /** Everything at once: the layout's worst case for one hero. */
  crowded: {
    hero: { form: "hero", damage: 3, statuses: { tough: 1 } },
    villain: { damage: 5, statuses: { confused: 1 } },
    mainThreat: 4,
    play: [
      { code: "01008", counters: { web: 2 } },
      { code: "01065" },
      { code: "01059", damage: 1 },
      { code: "01002", exhausted: true },
      { code: "01092" },
      { code: "01064", counters: { snoop: 3 } },
      { code: "01006" },
    ],
    minions: [
      { code: "01101", damage: 2, statuses: { stunned: 1 } },
      { code: "01102", statuses: { tough: 1 } },
    ],
    schemes: [
      { code: "01107", threat: 2 },
      { code: "01109", threat: 1 },
    ],
    villainAttachments: [{ code: "01099" }, { code: "01098", damage: 2 }],
  },
  /** Peter Parker with Heroic Intuition (+1 THW) tucked under him: change to Spider-Man and watch the turn. */
  flipupgrade: {
    hero: { form: "alterEgo" },
    play: [{ code: "01065" }],
  },
  /** Black Cat in hand with Genius on top of the deck: her pick-up while paying with Peter Parker's Scientist. */
  blackcat: {
    hand: ["01002", "01090"],
    deckTop: ["01089", "01087"],
  },
  /**
   * Mutagen Formula: Pumpkin Bombs on the Green Goblin, Black Cat out beside Spider-Man. End the turn: after his attack
   * the bombs' 2 indirect damage is divided between them, a click a point (`indirect-split.ts`).
   */
  pumpkin: {
    scenario: "mutagen-formula",
    hero: { form: "hero" },
    play: [{ code: "01002" }],
    villainAttachments: [{ code: "02021" }],
  },
  /** Black Cat with no printed [mental] resource on top of the deck: "No mental resources", nothing goes to the hand. */
  blackcatmiss: {
    hand: ["01002", "01090"],
    deckTop: ["01088", "01087"],
  },
  /** Avengers Mansion ready on the table: use it to watch a card drawn by an effect come into the hand. */
  mansion: {
    play: [{ code: "01091" }],
    hand: ["01089", "01087"],
  },
  /** Helicarrier ready on the table: use it to watch its discount called out on the next card. */
  helicarrier: {
    play: [{ code: "01092" }],
  },
  /** Highway Robbery comes off the encounter deck: end the turn to watch it take a card from your hand. */
  robbery: {
    encounterTop: ["01110", "01166"],
  },
  /** End the turn: Armored Rhino Suit comes up and attaches to Rhino, sliding in under him. */
  rhinosuit: {
    encounterTop: ["01110", "01098"],
  },
  /** Four minions out: too many for one row, so they stand in a block of two rows centred on the villain. */
  minions4: {
    minions: [{ code: "01101" }, { code: "01102" }, { code: "01103" }, { code: "01110" }],
  },
  /** Three minions out and an encounter card dealt early: it waits in the first clear spot, not on a minion. */
  dealtcrowd: {
    hero: { form: "alterEgo" },
    mainThreat: 0,
    minions: [{ code: "01110" }, { code: "01102" }, { code: "01103" }],
    dealt: ["01166"],
  },
  /** Adam's round 9: two side schemes beside the main one, three cards under Rhino, two minions. */
  latewide: {
    hero: { form: "hero" },
    schemes: [
      { code: "01107", threat: 3 },
      { code: "01109", threat: 3 },
    ],
    villainAttachments: [{ code: "01099" }, { code: "01100" }],
    minions: [{ code: "01110" }, { code: "01102" }],
  },
  /** Adam's Klaw game (2026-11-24): a side scheme and three minions, the one too many standing left of the schemes. */
  minions3side: {
    schemes: [{ code: "01107", threat: 3 }],
    minions: [{ code: "01110" }, { code: "01102" }, { code: "01103" }],
  },
  /** The same later on, with encounter cards discarded: the deck steps down the right, the discard pile above it. */
  minions3discard: {
    schemes: [{ code: "01107", threat: 3 }],
    minions: [{ code: "01110" }, { code: "01102" }, { code: "01103" }],
    encounterLeft: 12,
  },
  /** Five minions and two side schemes: no room left of the schemes, so a block of two rows. */
  minions5: {
    schemes: [
      { code: "01107", threat: 3 },
      { code: "01109", threat: 3 },
    ],
    minions: [{ code: "01101" }, { code: "01102" }, { code: "01103" }, { code: "01110" }, { code: "01104" }],
  },
  /** Three minions out, as Adam had them (Sandman, Vulture, Hydra Mercenary). */
  minions3: {
    minions: [{ code: "01110" }, { code: "01102" }, { code: "01103" }],
  },
  /** Rhino stunned, Spider-Man in hero form: end the turn and Rhino strains to attack, then sheds the stun. */
  stunned: {
    hero: { form: "hero" },
    villain: { statuses: { stunned: 1 } },
  },
  /** Rhino one hit from his second stage: attack him and it brings in Breakin' & Takin', held up in the middle. */
  stagetwo: {
    hero: { form: "hero" },
    villain: { damage: 12 },
  },
  /** Armored Rhino Suit on Rhino: attack him and the suit slides out from under him to take the damage. */
  suit: {
    hero: { form: "hero" },
    villainAttachments: [{ code: "01098" }],
  },
  /** Highway Robbery in play with Genius under it: thwart it (1 threat) to get the card back. */
  robbed: {
    hero: { form: "hero" },
    schemes: [{ code: "01166", threat: 1, tuck: ["01089"] }],
  },
  /** One card left in your deck: end the turn and the draw runs it out. */
  deckout: {
    deckLeft: 1,
  },
  /** Shadow of the Past comes off the encounter deck: end the turn to watch the nemesis set come out. */
  shadow: {
    encounterTop: ["01110", "01190"],
  },
  /**
   * Shadow of the Past in hero form: Vulture's Quickstrike attacks Spider-Man, but only once Highway Robbery and the
   * shuffle are done. End the turn to watch the reticle wait for it.
   */
  shadowhero: {
    hero: { form: "hero" },
    encounterTop: ["01110", "01190"],
  },
  /**
   * Caught Off Guard comes up with Web-Shooter and Helicarrier in play: end the turn, and its When Revealed asks which
   * to discard. The card steps aside so both can be seen and picked.
   */
  offguard: {
    play: [{ code: "01008", counters: { web: 3 } }, { code: "01092" }],
    encounterTop: ["01110", "01188"],
  },
  /** One card left in the encounter deck: end the turn and the villain phase runs it out. */
  encounterout: {
    encounterLeft: 1,
  },
  /** Hydra Bomber comes up: its When Revealed asks a question (take 2 damage or place 1 threat). End the turn. */
  bomber: {
    encounterTop: ["01104", "01110"],
  },
  /**
   * Assault comes up with the hero in hero form: its When Revealed (Hero) has Rhino attack. End the turn (Rhino's own
   * attack comes first, with the first card as its boost card), and the third card is the boost for Assault's attack.
   */
  assault: {
    hero: { form: "hero" },
    hand: ["01089", "01087", "01090"],
    encounterTop: ["01104", "01187", "01105"],
  },
  /** Assault comes up with the hero in alter-ego form: it gains surge, and another encounter card follows. */
  assaultsurge: {
    hero: { form: "alterEgo" },
    encounterTop: ["01104", "01187", "01105"],
  },
  /**
   * The main scheme two threat short with Advance next: end the turn and Advance (the villain schemes) loses the game
   * while it stands aside beside Rhino. A new game must not keep it on the table.
   */
  advanceloss: {
    hero: { form: "alterEgo" },
    mainThreat: 4,
    encounterTop: ["01186", "01186"],
  },
  /**
   * Eviction Notice (Peter Parker's obligation) is the next encounter card: end the turn and its two long answers are
   * asked in the turn bar, for checking that the answer buttons stay at two lines.
   * Pick "Exhaust Peter Parker" and it is removed from the game: it lands beside Rhino and fires, Peter exhausts, it
   * evaporates, and only then does the Hero Phase banner come up. Pick the discard and it lands and fires the same way,
   * then goes to the encounter discard pile.
   */
  eviction: {
    hero: { form: "alterEgo" },
    encounterTop: ["01186", "01165"],
  },
  /** Peter Parker in alter-ego form when Shocker is dealt: end the turn (Rhino's boost card comes first) and its "each hero" damage finds no one. */
  shocker: {
    hero: { form: "alterEgo" },
    encounterTop: ["01165", "01103"],
  },
  /** Spider-Man exhausted with Heroic Intuition tucked under him: hovering him lifts him and leaves the upgrade as it lies. */
  exhausted: {
    hero: { form: "hero", exhausted: true },
    play: [{ code: "01065" }],
  },
  /** Hard to Keep Down on an unhurt Rhino surges into "I'm Tough!": end the turn to watch it. */
  surge: {
    encounterTop: ["01110", "01104", "01105"],
  },
  /** Great Responsibility in hand as the villain phase starts: the main scheme's threat waits on the interrupt. */
  threat: {
    hero: { form: "hero" },
    hand: ["01061"],
  },
  /** Rhino attacks with Sandman as his boost card and Enhanced Ivory Horn attached: Spider-Sense, the defense, Backflip. */
  attack: {
    hero: { form: "hero" },
    villainAttachments: [{ code: "01100" }],
    hand: ["01003", "01093", "01083", "01007", "01005"],
    encounterTop: ["01102", "01108"],
  },
  /** Hurt Spider-Man and allies as Rhino attacks: "Defend?" keeps every friendly health badge out of the shade. */
  defend: {
    hero: { form: "hero", damage: 2 },
    play: [{ code: "01059", damage: 2 }, { code: "01002", damage: 1, exhausted: true }, { code: "01064" }],
  },
  /** A quiet mid-game board: one minion, one side scheme, a couple of supports. */
  midgame: {
    hero: { form: "hero", damage: 2 },
    villain: { damage: 4 },
    mainThreat: 3,
    play: [{ code: "01092" }, { code: "01059" }],
    minions: [{ code: "01110", damage: 1 }],
    schemes: [{ code: "01107", threat: 3 }],
  },
  /**
   * Hydra Mercenary (guard) engaged with Spider-Man: attacking (his basic attack, or Swinging Web Kick from the hand)
   * still asks whom, Rhino can't be picked, and pointing at him says Hydra Mercenary's Guard is why (Adam, 2026-11-25).
   */
  guard: {
    hero: { form: "hero" },
    minions: [{ code: "01101" }],
    // Swinging Web Kick and the resources to pay for it: the attack card asks the same way.
    hand: ["01005", "01088", "01089", "01090"],
  },
  /** Spider-Tracer in hand with two minions out: the attachment waits over the villain's side while its host is chosen. */
  tracer: {
    hero: { form: "hero" },
    hand: ["01007"],
    minions: [{ code: "01110" }, { code: "01103" }],
  },
  /** Swinging Web Kick in hand and tokens on Spider-Man: the event lands full size, laid over the tokens. */
  kick: {
    hero: { form: "hero", damage: 3, statuses: { tough: 1 } },
    play: [{ code: "01008", counters: { web: 3 } }, { code: "01002" }],
    hand: ["01005", "01089", "01087", "01090"],
  },
  /** First Aid in hand with Spider-Man and Black Cat hurt: the event waits clear of the hero while a target is picked. */
  firstaid: {
    hero: { form: "hero", damage: 4 },
    play: [{ code: "01002", damage: 1 }],
    hand: ["01086", "01089", "01087"],
  },
  /** Enhanced Spider-Sense in hand as Hard to Keep Down is revealed: cancel its When Revealed, or pass. */
  sense: {
    hero: { form: "hero" },
    hand: ["01004", "01089", "01087"],
    encounterTop: ["01110", "01104", "01105"],
  },
  /** Enhanced Spider-Sense in hand as Shadow of the Past is revealed: paid for while the treachery is held up. */
  shadowsense: {
    hero: { form: "hero" },
    hand: ["01004", "01089", "01087"],
    encounterTop: ["01110", "01190"],
  },
  /** Two Enhanced Spider-Senses in hand as Hard to Keep Down is revealed: one question, and none after a yes. */
  senses: {
    hero: { form: "hero" },
    hand: ["01004", "01004", "01089", "01087"],
    encounterTop: ["01110", "01104", "01105"],
  },
  /** Two Backflips in hand as Rhino attacks: one question covers both copies. */
  backflips: {
    hero: { form: "hero" },
    hand: ["01003", "01003", "01089"],
  },
  /**
   * Sandman already dealt, so two encounter cards wait facedown as the villain phase deals: end the turn and Sandman
   * stands aside below the card still waiting, then joins the minions once that one has been revealed.
   */
  sandman: {
    hero: { form: "hero" },
    dealt: ["01102"],
    encounterTop: ["01110", "01105"],
  },
  // ── Klaw (Underground Distribution, the Klaw set, Masters of Evil): `/battle/?scene=klawboost` ──────────────────
  /**
   * Spider-Man in hero form: end the turn and Klaw attacks with two boost cards fanned beside him (one tag, "Boost
   * ×2"). The first is Weapons Runner, whose boost puts it into play engaged with you; Assault is dealt after.
   */
  klawboost: {
    scenario: "klaw",
    clearMinions: true,
    hero: { form: "hero" },
    encounterTop: ["01121", "01123", "01187"],
  },
  /** Klaw one hit from his second stage: attack him, Klaw (II) comes up and reveals The "Immortal" Klaw (+10 hit points). */
  klawstage: {
    scenario: "klaw",
    clearMinions: true,
    hero: { form: "hero" },
    villain: { damage: 11 },
  },
  /** Underground Distribution one threat from full: end the turn, it turns over to Secret Rendezvous and a minion comes in. */
  klawadvance: {
    scenario: "klaw",
    clearMinions: true,
    mainThreat: 5,
  },
  /**
   * As klawadvance, with two cards that aren't minions on top of the encounter deck: Secret Rendezvous turns them up
   * off the encounter deck and onto its discard pile before Melter comes in (Masterplan shows its discards the same way).
   */
  klawdiscards: {
    scenario: "klaw",
    clearMinions: true,
    mainThreat: 5,
    encounterTop: ["01123", "01124", "01132"],
  },
  /**
   * Sonic Converter and Solid-Sound Body on Klaw, the resources for one in hand: spend [energy][mental][physical] to take
   * one off, or attack him and take Solid-Sound Body's retaliate 1.
   */
  klawgear: {
    scenario: "klaw",
    clearMinions: true,
    hero: { form: "hero" },
    villainAttachments: [{ code: "01118" }, { code: "01119" }],
    hand: ["01088", "01089", "01090"],
  },
  /** The "Immortal" Klaw in play (+10 hit points on Klaw): thwart its last threat and watch his health drop back. */
  klawimmortal: {
    scenario: "klaw",
    clearMinions: true,
    hero: { form: "hero" },
    villain: { damage: 6 },
    schemes: [{ code: "01127", threat: 1 }],
  },
  /** Klaw's crowded table: five minions in two rows, a second side scheme, Sonic Converter under Klaw. */
  klawcrowd: {
    scenario: "klaw",
    clearMinions: true,
    villain: { damage: 4 },
    mainThreat: 2,
    minions: [{ code: "01129" }, { code: "01130", damage: 2 }, { code: "01131" }, { code: "01132" }, { code: "01121" }],
    schemes: [{ code: "01126", threat: 3 }],
    villainAttachments: [{ code: "01118" }],
    play: [{ code: "01002" }],
  },
  /**
   * Spider-Man in hero form with Black Cat, Melter and Tiger Shark engaged: end the turn, Klaw and both minions attack
   * (Melter's attack must be defended by Black Cat), then Masters of Mayhem has both attack again.
   */
  klawmasters: {
    scenario: "klaw",
    clearMinions: true,
    hero: { form: "hero" },
    minions: [{ code: "01131" }, { code: "01132" }],
    play: [{ code: "01002" }],
    encounterTop: ["01186", "01188", "01133"],
  },
  /**
   * As klawmasters with no minion engaged: Masters of Mayhem has nobody to attack, so it searches the encounter deck
   * and discard pile for a Masters of Evil minion and the player picks one, seeing each card (Adam, 2026-11-25: the
   * names alone didn't say what the minions do).
   */
  klawsearch: {
    scenario: "klaw",
    clearMinions: true,
    hero: { form: "hero" },
    play: [{ code: "01002" }],
    encounterTop: ["01186", "01188", "01133"],
  },
  /** Sonic Boom comes up in alter-ego form with the resources in hand: spend [energy][mental][physical] or exhaust everything. */
  klawsonic: {
    scenario: "klaw",
    clearMinions: true,
    play: [{ code: "01002" }],
    hand: ["01088", "01089", "01090"],
    encounterTop: ["01124", "01123"],
  },
  /** Spider-Man in hero form as Klaw's Vengeance comes up after Klaw's own attack: Klaw attacks a second time. */
  klawvengeance: {
    scenario: "klaw",
    clearMinions: true,
    hero: { form: "hero" },
    encounterTop: ["01186", "01187", "01122", "01124", "01188"],
  },
  /**
   * The finish against Klaw: Klaw (I) one hit from his second stage, with enough on the table for the whole of Klaw (II)
   * in one turn. Attack him to bring in Klaw (II) and The "Immortal" Klaw; For Justice! (paid with Genius) thwarts it
   * away and takes his +10 hit points; two Swinging Web Kicks (Energy, Strength, both Web-Shooters) and Daredevil and
   * Jessica Jones attacking finish his 18 for the win.
   */
  klawfinish: {
    scenario: "klaw",
    clearMinions: true,
    hero: { form: "hero" },
    villain: { damage: 11 },
    play: [
      { code: "01058" },
      { code: "01059" },
      { code: "01008", counters: { web: 3 } },
      { code: "01008", counters: { web: 3 } },
    ],
    hand: ["01005", "01005", "01060", "01089", "01090", "01088"],
  },
  // ── Ultron (The Crimson Cowl, the Ultron set, Under Attack): `/battle/?scene=ultrondrones` ─────────────────────
  /**
   * Three Drones engaged with Spider-Man as well as the one from setup (a Swinging Web Kick, Black Cat and a
   * Web-Shooter under them): attack one and it turns over to show the card it was, on its way to the discard pile.
   */
  ultrondrones: {
    scenario: "ultron",
    hero: { form: "hero" },
    drones: [{ code: "01005" }, { code: "01002" }, { code: "01008" }],
    play: [{ code: "01059" }],
  },
  /** Interrogation Room in play and two Drones out: defeat one and the room asks about the Drone, not the card it was. */
  ultronroom: {
    scenario: "ultron",
    hero: { form: "hero" },
    mainThreat: 2,
    drones: [{ code: "01005" }],
    play: [{ code: "01063" }],
  },
  /** Spider-Man in hero form: end the turn, Ultron attacks, then asks for 1 threat or the top card of the deck as a Drone. */
  ultronattack: {
    scenario: "ultron",
    hero: { form: "hero" },
    encounterTop: ["01189", "01188"],
  },
  /**
   * Spider-Man in hero form: end the turn, and Ultron's attack turns over Android Efficiency as its boost card, which
   * asks "Spend 1 energy, or put the top card of the deck into play … as a Drone minion?": first its two halves, then,
   * for "Spend 1 energy", Web-Shooter (in play) and the Energy (in hand) to pay with, and Back to the two halves.
   */
  ultronboost: {
    scenario: "ultron",
    hero: { form: "hero" },
    play: [{ code: "01008", counters: { web: 3 } }],
    hand: ["01088"],
    encounterTop: ["01144a", "01189", "01188"],
  },
  /**
   * Ultron (I) one hit from his second stage with two Drones out: attack him, then end the turn. Ultron (II) puts
   * another Drone into play as he attacks and gets +1 ATK for each.
   */
  ultronstage: {
    scenario: "ultron",
    hero: { form: "hero" },
    villain: { damage: 16 },
    drones: [{ code: "01088" }],
    encounterTop: ["01189", "01188"],
  },
  /** The Crimson Cowl one threat from full: end the turn, it turns over to Assault on NORAD and a Drone comes off the deck. */
  ultronnorad: {
    scenario: "ultron",
    mainThreat: 2,
  },
  /** Assault on NORAD in play: end the turn, and after its threat it asks for 2 more threat or a Drone. */
  ultronassault: {
    scenario: "ultron",
    mainStage: 2,
    mainThreat: 1,
  },
  /** Countdown to Oblivion with threat on it and Drone Factory beside it: thwarting reaches the side scheme only. */
  ultroncountdown: {
    scenario: "ultron",
    hero: { form: "hero" },
    mainStage: 3,
    mainThreat: 3,
    schemes: [{ code: "01148", threat: 3 }],
    hand: ["01060", "01089"],
  },
  /**
   * Upgraded Drones on the Ultron Drones environment and Program Transmitter on Ultron, two Drones out, the resources
   * to pay either off in hand.
   */
  ultrongear: {
    scenario: "ultron",
    hero: { form: "hero" },
    villainAttachments: [{ code: "01141" }],
    environmentAttachments: [{ code: "01142" }],
    drones: [{ code: "01005" }],
    hand: ["01088", "01089", "01090"],
  },
  /** Vibranium Armor and Concussion Blasters (Under Attack) on Ultron: attack him for the retaliate and the tough card. */
  ultronarmor: {
    scenario: "ultron",
    hero: { form: "hero" },
    villainAttachments: [{ code: "01152" }, { code: "01153" }],
    hand: ["01090", "01088", "01089"],
  },
  /** Swarm Attack comes up with three Drones engaged: end the turn and each Drone attacks. */
  ultronswarm: {
    scenario: "ultron",
    hero: { form: "hero" },
    drones: [{ code: "01005" }, { code: "01002" }],
    play: [{ code: "01059" }],
    dealt: ["01147"],
    encounterTop: ["01189"],
  },
  /**
   * Swarm Attack in alter-ego form, two Drones engaged: "your hero" reaches no one, so no Drone attacks and the top
   * card of the deck becomes a Drone instead (issue 222).
   */
  ultronswarmalterego: {
    scenario: "ultron",
    hero: { form: "alterEgo" },
    drones: [{ code: "01005" }, { code: "01002" }],
    dealt: ["01147"],
    encounterTop: ["01189"],
  },
  /** Repair Sequence with two Drones out and Ultron hurt: he heals 2 for each Drone. */
  ultronrepair: {
    scenario: "ultron",
    villain: { damage: 8 },
    drones: [{ code: "01005" }],
    dealt: ["01146"],
  },
  /** Rage of Ultron in hero form: Ultron attacks, and a card comes off the deck for each damage dealt. */
  ultronrage: {
    scenario: "ultron",
    hero: { form: "hero" },
    dealt: ["01145"],
    encounterTop: ["01189", "01188"],
  },
  /** Invasive AI: the top 3 cards of the deck are discarded. */
  ultroninvasive: {
    scenario: "ultron",
    dealt: ["01149"],
  },
  /** Drone Factory, then Ultron's Imperative: three more Drones, and threat on the Factory for each Drone in play. */
  ultronfactory: {
    scenario: "ultron",
    dealt: ["01148", "01150"],
  },
  /** Android Efficiency as Ultron's boost card with an Energy in hand: spend it, or the top card of the deck becomes a Drone. */
  ultronefficiency: {
    scenario: "ultron",
    hero: { form: "hero" },
    hand: ["01088"],
    encounterTop: ["01144a", "01188"],
  },
  /** Under Attack, then Concussive Blast: 2 threat or 3 damage, then 1 damage to every friendly character. */
  ultronunder: {
    scenario: "ultron",
    hero: { form: "hero" },
    play: [{ code: "01059" }, { code: "01002" }],
    dealt: ["01151", "01154"],
    encounterTop: ["01189"],
  },
  /** Advanced Ultron Drone engaged and hurt: defeat it and the top card of the deck becomes a Drone in its place. */
  ultronadvanced: {
    scenario: "ultron",
    hero: { form: "hero" },
    minions: [{ code: "01143", damage: 2 }],
    play: [{ code: "01059" }],
  },
  /** One card left in the deck as Ultron's Imperative comes up: its first Drone takes it, its second finds the deck empty. */
  ultrondeck: {
    scenario: "ultron",
    deckLeft: 1,
    dealt: ["01150"],
  },
  /**
   * The finish against Ultron: Ultron (I) one hit from his second stage, with enough on the table for the whole of
   * Ultron (II)'s 22 in one turn. Black Cat takes Ultron (I)'s last hit point; then Spider-Man (2), two Swinging Web
   * Kicks (Energy and both Web-Shooters; Strength and Genius), Jessica Jones (2) and Daredevil (2).
   */
  ultronfinish: {
    scenario: "ultron",
    hero: { form: "hero" },
    villain: { damage: 16 },
    play: [
      { code: "01058" },
      { code: "01059" },
      { code: "01002" },
      { code: "01008", counters: { web: 3 } },
      { code: "01008", counters: { web: 3 } },
    ],
    hand: ["01005", "01005", "01088", "01090", "01089"],
  },
  /** Ultron's crowded table: five Drones and an Advanced Ultron Drone, two side schemes, two attachments on Ultron. */
  ultroncrowd: {
    scenario: "ultron",
    hero: { form: "hero" },
    villain: { damage: 5 },
    mainThreat: 2,
    drones: [{ code: "01005" }, { code: "01002" }, { code: "01008" }, { code: "01088", statuses: { stunned: 1 } }],
    minions: [{ code: "01143", damage: 1 }],
    schemes: [
      { code: "01148", threat: 4 },
      { code: "01150", threat: 2 },
    ],
    villainAttachments: [{ code: "01152" }],
    environmentAttachments: [{ code: "01142" }],
    play: [{ code: "01059" }, { code: "01058" }],
  },
  /**
   * The same crowded table later in the game: a tall player discard pile and cards in the encounter discard pile, so
   * the shrunken encounter piles stand down the right just above the player's discard pile. Their counts must keep
   * off it, and a card dealt while the player's row is full must keep off the player's deck.
   */
  ultronpiles: {
    scenario: "ultron",
    hero: { form: "hero" },
    villain: { damage: 5 },
    mainThreat: 2,
    drones: [{ code: "01005" }, { code: "01002" }, { code: "01008" }, { code: "01088", statuses: { stunned: 1 } }],
    minions: [{ code: "01143", damage: 1 }],
    schemes: [
      { code: "01148", threat: 4 },
      { code: "01150", threat: 2 },
    ],
    villainAttachments: [{ code: "01152" }],
    environmentAttachments: [{ code: "01142" }],
    play: [{ code: "01059" }, { code: "01058" }],
    deckLeft: 14,
    encounterLeft: 16,
  },
  /**
   * The finish, for any hero (`?scene=finish&hero=she-hulk`): Rhino on his last hit point, this stage made his last,
   * the hero in hero form and ready, nothing engaged. One attack wins. With `&record=1` it goes on the record as a
   * game does: the driven win (`e2e/battle-win.spec.ts`) follows it to the victory screen, the record and the mats.
   * Without it, nothing is recorded, so a look at the scene on Adam's own table adds no win to his record.
   */
  finish: {
    anyHero: true,
    recorded: true,
    hero: { form: "hero" },
    villain: { damage: 13, lastStage: true },
    mainThreat: 0,
    clearMinions: true,
  },
  /**
   * `finish` against the Green Goblin in Mutagen Formula (16 hit points): one basic attack wins, for the end of a
   * scenario pack's game (the record, the replay) to be looked at. Recorded only with `&record=1`, as `finish`.
   */
  goblinfinish: {
    scenario: "mutagen-formula",
    anyHero: true,
    recorded: true,
    hero: { form: "hero" },
    villain: { damage: 15, lastStage: true },
    mainThreat: 0,
    clearMinions: true,
  },
  /**
   * Black Panther (`?scene=wakanda&hero=black-panther`) with Energy Daggers, Panther Claws and Tactical Genius out and
   * Wakanda Forever! in hand, a Hydra Bomber engaged: play it (pay with Energy) and the order of the Specials is asked
   * (on the question map as waiting for a design: the upgrades are shown as buttons of their names).
   */
  wakanda: {
    anyHero: true,
    hero: { form: "hero" },
    play: [{ code: "01046" }, { code: "01047" }, { code: "01048" }],
    hand: ["01043a", "01088", "01089"],
    minions: [{ code: "01110" }],
  },
  /** Nick Fury in hand with the resources to pay for him: his "Choose one" waits in the dock, the table blurred behind. */
  fury: {
    hero: { form: "hero" },
    hand: ["01084", "01088", "01089", "01090", "01087"],
  },
};

export function sceneNames(): string[] {
  return Object.keys(SCENES);
}

export function arrangeScene(name: string): ((state: GameState) => GameState) | undefined {
  const scene = SCENES[name];
  if (!scene) return undefined;
  return (state) => arrange(state, scene);
}

/** Whether a scene is dealt for any hero and goes on the record (the finish); the others are Spider-Man's checks. */
export function sceneOptions(name: string): { anyHero: boolean; recorded: boolean } {
  return { anyHero: !!SCENES[name]?.anyHero, recorded: !!SCENES[name]?.recorded };
}

/** The villain a scene is dealt against: it must be dealt from that scenario for its cards to be there. */
export function sceneVillain(name: string): VillainId {
  return SCENES[name]?.scenario ?? "rhino";
}

/**
 * The Drone that Ultron's setup put into play is whatever card was on top of the deck. When it is one the scene needs
 * (the deck's only Strength), it changes places with a deck card the scene has no use for, so the scene deals on every
 * shuffle.
 */
function freeSetupDrone(state: GameState, scene: Scene): GameState {
  const player = state.players[0]!;
  const needed = new Set(JSON.stringify(scene).match(/\b\d{5}[a-c]?\b/g) ?? []);
  const drone = player.playArea.find(
    (id) => state.instances[id]?.facedownAs && needed.has(state.instances[id]!.cardId),
  );
  const spare = player.deck.find((id) => !needed.has(state.instances[id]!.cardId));
  if (!drone || !spare) return state;
  const under = state.instances[drone]!;
  const other = state.instances[spare]!;
  const role = {
    faceup: under.faceup,
    controllerId: under.controllerId,
    engagedWith: under.engagedWith,
    facedownAs: under.facedownAs,
  };
  const plain = {
    faceup: other.faceup,
    controllerId: other.controllerId,
    engagedWith: other.engagedWith,
    facedownAs: other.facedownAs,
  };
  return {
    ...state,
    instances: { ...state.instances, [drone]: { ...under, ...plain }, [spare]: { ...other, ...role } },
    players: [
      {
        ...player,
        playArea: player.playArea.map((id) => (id === drone ? spare : id)),
        deck: player.deck.map((id) => (id === spare ? drone : id)),
      },
      ...state.players.slice(1),
    ],
  };
}

function arrange(state: GameState, scene: Scene): GameState {
  if (scene.clearMinions) state = discardMinions(state);
  if (scene.scenario === "ultron") state = freeSetupDrone(state, scene);
  const player = state.players[0]!;
  const piles = activeEncounterDeck(state);
  const used = new Set<InstanceId>();
  const pools = [player.deck, player.hand, piles.deck, piles.discard, player.setAside, state.encounterSetAside];
  const take = (code: string) => {
    for (const pool of pools) {
      const id = pool.find((candidate) => state.instances[candidate]?.cardId === code && !used.has(candidate));
      if (id) {
        used.add(id);
        return id;
      }
    }
    throw new Error(`scene: no spare copy of ${code}`);
  };
  const instances = { ...state.instances };
  const hero = player.identity.instanceId;
  const villain = state.villains[0]!.instanceId;
  const place = (p: Placement, extra: Partial<(typeof instances)[string]> = {}) => {
    const id = take(p.code);
    const tucked = (p.tuck ?? []).map(take);
    for (const under of tucked) instances[under] = { ...instances[under]!, faceup: false };
    instances[id] = {
      ...instances[id]!,
      faceup: true,
      exhausted: p.exhausted ?? false,
      damage: p.damage ?? 0,
      threat: p.threat ?? 0,
      statuses: { ...instances[id]!.statuses, ...p.statuses },
      counters: { ...instances[id]!.counters, ...p.counters },
      ...(tucked.length ? { tucked: [...instances[id]!.tucked, ...tucked] } : {}),
      ...extra,
    };
    return id;
  };
  const playIds = (scene.play ?? []).map((p) => place(p));
  const minionIds = (scene.minions ?? []).map((p) => place(p, { engagedWith: player.playerId }));
  // A Drone is a player card in play facedown, engaged with its owner and on the encounter side: the role is copied
  // from the Drone that Ultron's setup put into play.
  const droneRole = player.playArea
    .map((id) => state.instances[id]?.facedownAs)
    .find((role) => role?.kind === "minion");
  if (scene.drones?.length && !droneRole) throw new Error("scene: drones need Ultron's scenario");
  const droneIds = (scene.drones ?? []).map((p) =>
    place(p, { faceup: false, controllerId: null, engagedWith: player.playerId, facedownAs: droneRole! }),
  );
  const schemeIds = (scene.schemes ?? []).map((p) => place(p));
  const attached = (scene.villainAttachments ?? []).map((p) => place(p, { attachedTo: villain }));
  const environment = [...state.villainArea, ...player.playArea].find(
    (id) => cardOf(state, id)?.type === "environment",
  );
  if (scene.environmentAttachments?.length && !environment) throw new Error("scene: no environment in play");
  const onEnvironment = (scene.environmentAttachments ?? []).map((p) => place(p, { attachedTo: environment! }));
  if (environment)
    instances[environment] = {
      ...instances[environment]!,
      attachments: [...instances[environment]!.attachments, ...onEnvironment],
    };
  instances[villain] = {
    ...instances[villain]!,
    damage: scene.villain?.damage ?? 0,
    statuses: { ...instances[villain]!.statuses, ...scene.villain?.statuses },
    attachments: [...instances[villain]!.attachments, ...attached],
  };
  instances[hero] = {
    ...instances[hero]!,
    damage: scene.hero?.damage ?? 0,
    statuses: { ...instances[hero]!.statuses, ...scene.hero?.statuses },
    ...(scene.hero?.exhausted ? { exhausted: true } : {}),
  };
  const main = state.mainScheme.instanceId;
  if (scene.mainThreat !== undefined) instances[main] = { ...instances[main]!, threat: scene.mainThreat };
  const gone = (list: readonly InstanceId[]) => list.filter((id) => !used.has(id));
  const deckId = activeEncounterDeckId(state);
  // Chosen cards first, then keep the hand full from the deck; chosen deck-top cards go back on top.
  const handIds = (scene.hand ?? []).map(take);
  const encounterTopIds = (scene.encounterTop ?? []).map(take);
  const topIds = (scene.deckTop ?? []).map(take);
  const dealtIds = (scene.dealt ?? []).map(take);
  const held = [...handIds, ...gone(player.hand)];
  const hand = held.slice(0, player.hand.length);
  // Anything the chosen cards pushed out of the hand goes back into the deck, so no card ends up nowhere.
  const deck = [...held.slice(player.hand.length), ...gone(player.deck)];
  while (hand.length < player.hand.length && deck.length) hand.push(deck.shift()!);
  deck.unshift(...topIds);
  const discard = [...player.discard];
  if (scene.deckLeft !== undefined) discard.push(...deck.splice(scene.deckLeft));
  let encounterDeck = [...encounterTopIds, ...gone(piles.deck)];
  const encounterDiscard = gone(piles.discard);
  if (scene.encounterLeft !== undefined) {
    encounterDiscard.push(...encounterDeck.slice(scene.encounterLeft));
    encounterDeck = encounterDeck.slice(0, scene.encounterLeft);
  }
  return {
    ...state,
    instances,
    ...(scene.mainStage !== undefined ? { mainScheme: { ...state.mainScheme, stageIndex: scene.mainStage - 1 } } : {}),
    ...(scene.villain?.lastStage
      ? { villains: state.villains.map((v, i) => (i === 0 ? { ...v, lastStageIndex: v.stageIndex } : v)) }
      : {}),
    players: [
      {
        ...player,
        identity: { ...player.identity, form: scene.hero?.form ?? player.identity.form },
        hand,
        deck,
        discard,
        setAside: gone(player.setAside),
        playArea: [...player.playArea, ...playIds, ...minionIds, ...droneIds],
        dealtEncounter: [...player.dealtEncounter, ...dealtIds],
      },
    ],
    villainArea: [...state.villainArea, ...schemeIds],
    encounterSetAside: gone(state.encounterSetAside),
    encounterDecks: {
      ...state.encounterDecks,
      [deckId]: { ...piles, deck: encounterDeck, discard: encounterDiscard },
    },
  };
}

/** The minions engaged with the player go to the encounter discard pile, where `take` can find them again. */
function discardMinions(state: GameState): GameState {
  const player = state.players[0]!;
  const minions = player.playArea.filter((id) => cardOf(state, id)?.type === "minion");
  if (!minions.length) return state;
  const instances = { ...state.instances };
  for (const id of minions)
    instances[id] = {
      ...instances[id]!,
      engagedWith: null,
      damage: 0,
      statuses: { stunned: 0, confused: 0, tough: 0 },
    };
  const piles = activeEncounterDeck(state);
  return {
    ...state,
    instances,
    players: [
      { ...player, playArea: player.playArea.filter((id) => !minions.includes(id)) },
      ...state.players.slice(1),
    ],
    encounterDecks: {
      ...state.encounterDecks,
      [activeEncounterDeckId(state)]: { ...piles, discard: [...piles.discard, ...minions] },
    },
  };
}
