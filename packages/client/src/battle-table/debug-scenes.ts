import { activeEncounterDeck, activeEncounterDeckId, type GameState, type InstanceId } from "@mc/engine";

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
  hero?: { form?: "hero" | "alterEgo"; damage?: number; statuses?: Record<string, number>; exhausted?: boolean };
  villain?: { damage?: number; statuses?: Record<string, number> };
  mainThreat?: number;
  /** Player cards in play (allies, supports, upgrades). */
  play?: Placement[];
  /** Minions engaged with the hero. */
  minions?: Placement[];
  /** Side schemes in the villain area. */
  schemes?: Placement[];
  /** Encounter attachments on Rhino. */
  villainAttachments?: Placement[];
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

function arrange(state: GameState, scene: Scene): GameState {
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
  const schemeIds = (scene.schemes ?? []).map((p) => place(p));
  const attached = (scene.villainAttachments ?? []).map((p) => place(p, { attachedTo: villain }));
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
    players: [
      {
        ...player,
        identity: { ...player.identity, form: scene.hero?.form ?? player.identity.form },
        hand,
        deck,
        discard,
        setAside: gone(player.setAside),
        playArea: [...player.playArea, ...playIds, ...minionIds],
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
