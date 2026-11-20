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
}

interface Scene {
  hero?: { form?: "hero" | "alterEgo"; damage?: number; statuses?: Record<string, number> };
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
  /** Black Cat in hand with Genius on top of the deck: her pick-up while paying with Peter Parker's Scientist. */
  blackcat: {
    hand: ["01002", "01090"],
    deckTop: ["01089", "01087"],
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
    hand: ["01005", "01089", "01087", "01090"],
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
    instances[id] = {
      ...instances[id]!,
      faceup: true,
      exhausted: p.exhausted ?? false,
      damage: p.damage ?? 0,
      threat: p.threat ?? 0,
      statuses: { ...instances[id]!.statuses, ...p.statuses },
      counters: { ...instances[id]!.counters, ...p.counters },
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
  };
  const main = state.mainScheme.instanceId;
  if (scene.mainThreat !== undefined) instances[main] = { ...instances[main]!, threat: scene.mainThreat };
  const gone = (list: readonly InstanceId[]) => list.filter((id) => !used.has(id));
  const deckId = activeEncounterDeckId(state);
  // Chosen cards first, then keep the hand full from the deck; chosen deck-top cards go back on top.
  const handIds = (scene.hand ?? []).map(take);
  const encounterTopIds = (scene.encounterTop ?? []).map(take);
  const topIds = (scene.deckTop ?? []).map(take);
  const held = [...handIds, ...gone(player.hand)];
  const hand = held.slice(0, player.hand.length);
  // Anything the chosen cards pushed out of the hand goes back into the deck, so no card ends up nowhere.
  const deck = [...held.slice(player.hand.length), ...gone(player.deck)];
  while (hand.length < player.hand.length && deck.length) hand.push(deck.shift()!);
  deck.unshift(...topIds);
  return {
    ...state,
    instances,
    players: [
      {
        ...player,
        identity: { ...player.identity, form: scene.hero?.form ?? player.identity.form },
        hand,
        deck,
        setAside: gone(player.setAside),
        playArea: [...player.playArea, ...playIds, ...minionIds],
      },
    ],
    villainArea: [...state.villainArea, ...schemeIds],
    encounterSetAside: gone(state.encounterSetAside),
    encounterDecks: {
      ...state.encounterDecks,
      [deckId]: { ...piles, deck: [...encounterTopIds, ...gone(piles.deck)], discard: gone(piles.discard) },
    },
  };
}
