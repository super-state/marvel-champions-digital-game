/**
 * The facts of a finished game on the 3D table, worked out from the engine's final state and the events of its moves
 * (`BattleModel.game`, `BattleModel.events`). Pure: no page, no storage.
 *
 * The old 2D game does the same for its achievements (`engine/game-summary.ts`, folded from `engine/game-record.ts`);
 * this is the table's own, smaller copy of what the table's record needs.
 */
import { CORE_DEPS } from "@mc/cards";
import { CORE_ENCOUNTER_SETS, CORE_SCENARIOS, CORE_STARTER_DECKS } from "@mc/content";
import { remainingHitPoints, type GameEvent, type GameState, type InstanceId } from "@mc/engine";
import type { GameFacts } from "./game.js";

/** The card types a player deck is built from (RRG Appendix I): the identity, obligation and nemesis cards are not. */
const DECK_TYPES: ReadonlySet<string> = new Set([
  "ally",
  "event",
  "support",
  "upgrade",
  "resource",
  "player_side_scheme",
]);
const ASPECTS: ReadonlySet<string> = new Set(["aggression", "justice", "leadership", "protection"]);

/** The Core Set's modular encounter sets: every set that is not a scenario's own, a nemesis set, Standard or Expert. */
export const CORE_MODULES: readonly string[] = (() => {
  const scenarioSets = new Set<string>(CORE_SCENARIOS.flatMap((s) => s.encounterSetIds));
  return CORE_ENCOUNTER_SETS.filter(
    (set) => !set.classification && !set.nemesisOfIdentityId && !scenarioSets.has(set.id),
  ).map((set) => set.id as string);
})();

const cardAt = (state: GameState, id: InstanceId | string | null | undefined) => {
  const instance = id ? state.instances[id] : undefined;
  return instance ? state.cardPool[instance.cardId] : undefined;
};

/** The hero's name and identity card id, as the table shows them ("Spider-Man"). */
export function heroOf(state: GameState): { id: string; name: string } {
  const identity = state.players[0]!.identity;
  return { id: identity.cardId, name: state.cardPool[identity.cardId]?.name ?? identity.cardId };
}

/** The player deck the game was dealt: its size, aspects, and the starter deck it is card for card (else null). */
export function deckOf(state: GameState): {
  size: number;
  aspects: string[];
  starterDeck: string | null;
  ids: string[];
} {
  const player = state.players[0]!;
  const counts = new Map<string, number>();
  const aspects = new Set<string>();
  for (const instance of Object.values(state.instances)) {
    if (instance.ownerId !== player.playerId) continue;
    const card = state.cardPool[instance.cardId];
    if (!card || !DECK_TYPES.has(card.type)) continue;
    counts.set(instance.cardId, (counts.get(instance.cardId) ?? 0) + 1);
    if ("aspect" in card && ASPECTS.has(card.aspect as string)) aspects.add(card.aspect as string);
  }
  const size = [...counts.values()].reduce((a, b) => a + b, 0);
  const starter = CORE_STARTER_DECKS.find(
    (deck) =>
      deck.identityCardId === player.identity.cardId &&
      deck.cards.length === counts.size &&
      deck.cards.every((entry) => counts.get(entry.cardId) === entry.quantity),
  );
  return {
    size,
    aspects: [...aspects].sort(),
    starterDeck: starter ? starter.id : null,
    ids: [...counts.keys()].sort(),
  };
}

/** The modular sets among the game's encounter cards. */
export function modulesOf(state: GameState): string[] {
  const found = new Set<string>();
  for (const instance of Object.values(state.instances)) {
    const card = state.cardPool[instance.cardId];
    const sets = card && "encounterSetIds" in card ? (card.encounterSetIds as readonly string[]) : [];
    for (const set of sets) if (CORE_MODULES.includes(set)) found.add(set);
  }
  return CORE_MODULES.filter((set) => found.has(set));
}

/** What the table calls a player card in play facedown as a minion (Ultron's Drones), as `model.ts` does. */
export const DRONE = { cardId: "drone", name: "Drone" } as const;

/** A player card facedown as a minion when event `at` happened: put so by these events (or at setup) and not moved since. */
function droneAt(state: GameState, events: readonly GameEvent[], id: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "cardPutIntoPlayFacedown" && e.instanceId === id) return e.as === "minion";
    if (e.type === "cardMoved" && e.instanceId === id) return false;
  }
  return state.instances[id]?.facedownAs?.kind === "minion";
}

/** The card of the last damage dealt (or placed) to one of `targets`; null when that damage named no source. */
function lastBlowAt(state: GameState, events: readonly GameEvent[], targets: (id: string) => boolean) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if ((e.type !== "damageDealt" && e.type !== "damagePlaced") || !targets(e.targetInstanceId)) continue;
    if (!e.sourceInstanceId) return null;
    if (droneAt(state, events, e.sourceInstanceId, i)) return { ...DRONE };
    const instance = state.instances[e.sourceInstanceId];
    const card = instance ? state.cardPool[instance.cardId] : undefined;
    return instance && card ? { cardId: instance.cardId as string, name: card.name } : null;
  }
  return null;
}

/** Everything the record keeps about a finished game besides who, whom, how and how long. */
export function factsOf(state: GameState, events: readonly GameEvent[], undo: boolean): GameFacts {
  const player = state.players[0]!;
  const deck = deckOf(state);
  const outcome = state.outcome;
  const lastBlow =
    outcome?.result === "win"
      ? lastBlowAt(state, events, (id) => cardAt(state, id)?.type === "villain")
      : outcome?.reason === "allPlayersDefeated"
        ? lastBlowAt(state, events, (id) => id === player.identity.instanceId)
        : null;
  return {
    v: 1,
    difficulty: state.scenarioRules.difficulty === "expert" ? "expert" : "standard",
    modules: modulesOf(state),
    heroId: player.identity.cardId,
    aspects: deck.aspects,
    deckSize: deck.size,
    starterDeck: deck.starterDeck,
    heroHp: Math.max(0, remainingHitPoints(state, player.identity.instanceId, CORE_DEPS) ?? 0),
    form: player.identity.form === "hero" ? "hero" : "alterEgo",
    alliesPlayed: events.filter((e) => e.type === "cardPlayed" && state.cardPool[e.cardId]?.type === "ally").length,
    undo,
    lastBlow,
  };
}

/**
 * What the table reports of the game on it, read from the game rather than assumed: the hero by name, the deck (the
 * starter deck's id, or the card ids of a built one) and the facts.
 */
export function gameOnTable(
  state: GameState,
  events: readonly GameEvent[],
  undo: boolean,
): { hero: string; deck: string[]; facts: GameFacts } {
  const deck = deckOf(state);
  return {
    hero: heroOf(state).name,
    deck: deck.starterDeck ? [deck.starterDeck] : deck.ids,
    facts: factsOf(state, events, undo),
  };
}
