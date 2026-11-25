/**
 * Achievements and stats, worked out from the list of finished games and never stored (the room plan,
 * `docs/project/room-plan.md` "Achievements, stats and rewards"): nothing to farm or lose, and a game saved anywhere
 * counts. Pure: no page, no storage.
 *
 * `trophyRoom(games)` is everything the trophy cabinet and the record board show; `newlyEarned(games, id)` is what one
 * finished game earned, for the "Achievement unlocked" pop-up.
 *
 * The names are placeholders (Adam renames them); each reward is an id only (`mat:rhino`), drawn by a later task.
 *
 * A game saved before the record kept its facts (`facts: null`) counts for what it can. Those games were all dealt by
 * the 3D table as it was then: Spider-Man's starter deck, Standard, the villain's recommended module, so those are
 * filled in (`knownOf`). What it can't say (hit points, allies, Undo) earns nothing: an unknown never earns a feat.
 */
import { CORE_CARDS, CORE_SCENARIOS, CORE_STARTER_DECKS } from "@mc/content";
import type { FinishedGame } from "./game.js";

export type Family = "villains" | "heroes" | "modules" | "decks" | "feats" | "trying";

export interface Achievement {
  readonly id: string;
  readonly family: Family;
  /** A plain placeholder name. */
  readonly name: string;
  /** How to earn it, in a sentence. */
  readonly how: string;
  /** How far along, where it counts something (games, villains, stamps); null for a single game's feat. */
  readonly progress: { readonly have: number; readonly need: number } | null;
  readonly earned: boolean;
  /** When the game that earned it ended; null while not earned. */
  readonly earnedAt: number | null;
  /** What earning it gives (`mat:rhino`): an id only for now. */
  readonly reward: string;
  /** What it shows: the card it is about, or an emblem. */
  readonly symbol: AchievementSymbol;
}

/**
 * The picture of an achievement: the card it is about (the villain beaten, the hero won with, a card of the module),
 * else an emblem drawn from the table's icons (`icons.ts` names), on a colour that says what kind it is.
 */
export interface AchievementSymbol {
  readonly cardId: string | null;
  readonly icon: string;
  readonly tone:
    | "gold"
    | "hero"
    | "villain"
    | "expert"
    | "trying"
    | "aggression"
    | "justice"
    | "leadership"
    | "protection";
}

export interface Tally {
  readonly played: number;
  readonly won: number;
  readonly lost: number;
}

export interface Stats {
  readonly total: Tally;
  /** Every Core Set villain, played or not, in the campaign's order. */
  readonly byVillain: readonly { readonly id: string; readonly name: string; readonly tally: Tally }[];
  /** Every hero played, in the order first played. */
  readonly byHero: readonly { readonly id: string; readonly name: string; readonly tally: Tally }[];
  /** The win in the fewest rounds (then the fewest minutes). */
  readonly fastestWin: {
    readonly rounds: number;
    readonly minutes: number;
    readonly hero: string;
    readonly villain: string;
    readonly endedAt: number;
  } | null;
  /** The most wins in a row, ever. */
  readonly longestWinningRun: number;
  /** The wins in a row up to the latest game (0 after a loss). */
  readonly currentWinningRun: number;
}

/** A hero against a villain: one of the 15 stamps. */
export interface Stamp {
  readonly heroId: string;
  readonly hero: string;
  readonly villainId: string;
  readonly villain: string;
  readonly won: boolean;
}

export interface TrophyRoom {
  readonly achievements: readonly Achievement[];
  readonly earned: number;
  readonly stats: Stats;
  readonly stamps: readonly Stamp[];
}

// ── The Core Set ─────────────────────────────────────────────────────────────────────────────────────────────────

const cardName = (id: string) => CORE_CARDS.find((card) => card.id === id)?.name ?? id;

export const VILLAINS: readonly {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly cardId: string;
}[] = CORE_SCENARIOS.map((s) => ({
  id: s.id as string,
  name: cardName(s.villainCardId),
  module: (s.recommendedModularSetIds[0] ?? "") as string,
  cardId: s.villainCardId as string,
}));

/** The Core Set's five heroes, once each (Captain Marvel has two starter decks). */
export const HEROES: readonly { readonly id: string; readonly name: string }[] = [
  ...new Set(CORE_STARTER_DECKS.map((d) => d.identityCardId as string)),
].map((id) => ({ id, name: cardName(id) }));

export const ASPECTS: readonly {
  readonly id: "aggression" | "justice" | "leadership" | "protection";
  readonly name: string;
  readonly icon: string;
}[] = [
  { id: "aggression", name: "Aggression", icon: "attack" },
  { id: "justice", name: "Justice", icon: "thwart" },
  { id: "leadership", name: "Leadership", icon: "hero" },
  { id: "protection", name: "Protection", icon: "tough" },
];

/** A card that stands for an encounter set: its first minion, else its first card. */
const cardOfSet = (set: string) => {
  const cards = CORE_CARDS.filter(
    (card) => "encounterSetIds" in card && (card.encounterSetIds as readonly string[]).includes(set),
  );
  return ((cards.find((card) => card.type === "minion") ?? cards[0])?.id ?? null) as string | null;
};

export const MODULES: readonly { readonly id: string; readonly name: string; readonly cardId: string | null }[] = [
  { id: "bomb_scare", name: "Bomb Scare" },
  { id: "masters_of_evil", name: "Masters of Evil" },
  { id: "under_attack", name: "Under Attack" },
  { id: "legions_of_hydra", name: "Legions of Hydra" },
  { id: "the_doomsday_chair", name: "The Doomsday Chair" },
].map((m) => ({ ...m, cardId: cardOfSet(m.id) }));

// ── What a game is known to have been ────────────────────────────────────────────────────────────────────────────

/** A game's facts, with what an older game left out filled in where the table then always did one thing. */
interface Known {
  readonly game: FinishedGame;
  readonly won: boolean;
  readonly heroId: string | null;
  readonly aspects: readonly string[];
  readonly difficulty: "standard" | "expert";
  readonly modules: readonly string[];
  /** The deck was one the player built (not a starter deck); null when unknown. */
  readonly built: boolean | null;
  readonly deckSize: number | null;
  /** Null when the game didn't keep them. */
  readonly heroHp: number | null;
  readonly alliesPlayed: number | null;
  readonly undo: boolean | null;
}

const heroByName = (name: string) => HEROES.find((h) => h.name === name)?.id ?? null;
const starter = (id: string | undefined) => CORE_STARTER_DECKS.find((d) => d.id === id);
const deckSizeOf = (deck: NonNullable<ReturnType<typeof starter>>) => deck.cards.reduce((n, c) => n + c.quantity, 0);

function knownOf(game: FinishedGame): Known {
  const won = game.result === "win";
  const f = game.facts;
  if (f)
    return {
      game,
      won,
      heroId: f.heroId,
      aspects: f.aspects,
      difficulty: f.difficulty,
      modules: f.modules,
      built: f.starterDeck === null,
      deckSize: f.deckSize,
      heroHp: f.heroHp,
      alliesPlayed: f.alliesPlayed,
      undo: f.undo,
    };
  const deck = starter(game.deck[0]);
  const villain = VILLAINS.find((v) => v.id === game.villain);
  return {
    game,
    won,
    heroId: deck ? (deck.identityCardId as string) : heroByName(game.hero),
    aspects: deck ? [...deck.aspects] : [],
    difficulty: "standard",
    modules: villain?.module ? [villain.module] : [],
    built: deck ? false : null,
    deckSize: deck ? deckSizeOf(deck) : null,
    heroHp: null,
    alliesPlayed: null,
    undo: null,
  };
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How an achievement is earned. `count`: `need` games that each pass the test. `cover`: every one of `keys` named by
 * some game (`key` names the one a game covers, or null).
 */
type Rule =
  | { readonly kind: "count"; readonly test: (g: Known) => boolean; readonly need: number }
  | { readonly kind: "cover"; readonly key: (g: Known) => string | null; readonly keys: readonly string[] };

interface Definition {
  readonly symbol: AchievementSymbol;
  readonly id: string;
  readonly family: Family;
  readonly name: string;
  readonly how: string;
  readonly reward: string;
  readonly rule: Rule;
  /** Show progress (`have` of `need`) even for a count of 1? Only counts above 1 and covers show it by default. */
}

const one = (test: (g: Known) => boolean): Rule => ({ kind: "count", test, need: 1 });
const slug = (s: string) => s.replace(/_/g, "-");

export const DEFINITIONS: readonly Definition[] = [
  // Villains
  ...VILLAINS.map((v): Definition => ({
    id: `beat-${v.id}`,
    family: "villains",
    name: `Beat ${v.name}`,
    how: `Win a game against ${v.name}.`,
    reward: `mat:${v.id}`,
    symbol: { cardId: v.cardId, icon: "villain", tone: "villain" },
    rule: one((g) => g.won && g.game.villain === v.id),
  })),
  {
    id: "beat-all-villains",
    family: "villains",
    name: "Beat all three",
    how: `Beat ${VILLAINS.map((v) => v.name)
      .join(", ")
      .replace(/, ([^,]*)$/, " and $1")}.`,
    reward: "mat:all-villains",
    symbol: { cardId: null, icon: "villain", tone: "villain" },
    rule: { kind: "cover", key: (g) => (g.won ? g.game.villain : null), keys: VILLAINS.map((v) => v.id) },
  },
  ...VILLAINS.map((v): Definition => ({
    id: `beat-${v.id}-expert`,
    family: "villains",
    name: `Beat ${v.name} on Expert`,
    how: `Win a game against ${v.name} on Expert.`,
    reward: `mat:${v.id}-expert`,
    symbol: { cardId: v.cardId, icon: "villain", tone: "expert" },
    rule: one((g) => g.won && g.game.villain === v.id && g.difficulty === "expert"),
  })),
  {
    id: "beat-all-villains-expert",
    family: "villains",
    name: "Beat all three on Expert",
    how: "Beat every villain on Expert.",
    reward: "mat:all-villains-expert",
    symbol: { cardId: null, icon: "villain", tone: "expert" },
    rule: {
      kind: "cover",
      key: (g) => (g.won && g.difficulty === "expert" ? g.game.villain : null),
      keys: VILLAINS.map((v) => v.id),
    },
  },
  // Heroes
  ...HEROES.map((h): Definition => ({
    id: `win-as-${slug(h.name.toLowerCase().replace(/[^a-z]+/g, "-"))}`,
    family: "heroes",
    name: `Win as ${h.name}`,
    how: `Win a game as ${h.name}.`,
    reward: `mat:${h.name.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    symbol: { cardId: h.id, icon: "hero", tone: "hero" },
    rule: one((g) => g.won && g.heroId === h.id),
  })),
  ...ASPECTS.map((a): Definition => ({
    id: `win-with-${a.id}`,
    family: "heroes",
    name: `Win with ${a.name}`,
    how: `Win a game with ${/^[AEIOU]/.test(a.name) ? "an" : "a"} ${a.name} deck.`,
    reward: `mat:aspect-${a.id}`,
    symbol: { cardId: null, icon: a.icon, tone: a.id },
    rule: one((g) => g.won && g.aspects.includes(a.id)),
  })),
  {
    id: "every-hero-every-villain",
    family: "heroes",
    name: "Every hero against every villain",
    how: `Win with each of the ${HEROES.length} heroes against each of the ${VILLAINS.length} villains.`,
    reward: "mat:every-hero",
    symbol: { cardId: null, icon: "hero", tone: "gold" },
    rule: {
      kind: "cover",
      key: (g) => (g.won && g.heroId ? `${g.heroId}/${g.game.villain}` : null),
      keys: HEROES.flatMap((h) => VILLAINS.map((v) => `${h.id}/${v.id}`)),
    },
  },
  // Modules
  ...MODULES.map((m): Definition => ({
    id: `win-with-${slug(m.id)}`,
    family: "modules",
    name: `Win with ${m.name}`,
    how: `Win a game with the ${m.name} module in the encounter deck.`,
    reward: `decor:${slug(m.id)}`,
    symbol: { cardId: m.cardId, icon: "scheme", tone: "villain" },
    rule: one((g) => g.won && g.modules.includes(m.id)),
  })),
  // Decks
  {
    id: "win-built-deck",
    family: "decks",
    name: "Win with your own deck",
    how: "Win a game with a deck you built.",
    reward: "deckbox:built",
    symbol: { cardId: null, icon: "deck", tone: "hero" },
    rule: one((g) => g.won && g.built === true),
  },
  {
    id: "win-fifty-cards",
    family: "decks",
    name: "Win with 50 cards",
    how: "Win a game with a 50-card deck.",
    reward: "deckbox:fifty",
    symbol: { cardId: null, icon: "draw", tone: "hero" },
    rule: one((g) => g.won && g.deckSize === 50),
  },
  // Feats
  {
    id: "win-on-one-hp",
    family: "feats",
    name: "Hanging on",
    how: "Win with your hero on 1 hit point.",
    reward: "tokens:last-stand",
    symbol: { cardId: null, icon: "heart", tone: "gold" },
    rule: one((g) => g.won && g.heroHp === 1),
  },
  {
    id: "win-in-five-rounds",
    family: "feats",
    name: "Quick work",
    how: "Win in 5 rounds or fewer.",
    reward: "tokens:quick",
    symbol: { cardId: null, icon: "energy", tone: "gold" },
    rule: one((g) => g.won && g.game.rounds <= 5),
  },
  {
    id: "win-without-ally",
    family: "feats",
    name: "On your own",
    how: "Win without playing an ally.",
    reward: "tokens:solo",
    symbol: { cardId: null, icon: "hero", tone: "gold" },
    rule: one((g) => g.won && g.alliesPlayed === 0),
  },
  {
    id: "win-without-undo",
    family: "feats",
    name: "No take-backs",
    how: "Win without using Undo.",
    reward: "tokens:no-undo",
    symbol: { cardId: null, icon: "check", tone: "gold" },
    rule: one((g) => g.won && g.undo === false),
  },
  // For trying
  {
    id: "lose-ten",
    family: "trying",
    name: "Keep at it",
    how: "Lose 10 games.",
    reward: "silly:trophy",
    symbol: { cardId: null, icon: "defeated", tone: "trying" },
    rule: { kind: "count", test: (g) => !g.won, need: 10 },
  },
  {
    id: "lose-in-round-one",
    family: "trying",
    name: "That was quick",
    how: "Lose in round 1.",
    reward: "silly:sign",
    symbol: { cardId: null, icon: "undo", tone: "trying" },
    rule: one((g) => !g.won && g.game.rounds <= 1),
  },
  {
    id: "lose-to-scheme-five",
    family: "trying",
    name: "Out-schemed",
    how: "Lose to the main scheme 5 times.",
    reward: "silly:clock",
    symbol: { cardId: null, icon: "threat", tone: "trying" },
    rule: { kind: "count", test: (g) => !g.won && g.game.reason === "mainSchemeCompleted", need: 5 },
  },
];

/** Oldest first; games ending at the same moment keep their order. */
const inOrder = (games: readonly FinishedGame[]) => games.map(knownOf).sort((a, b) => a.game.endedAt - b.game.endedAt);

function judge(def: Definition, games: readonly Known[]): Achievement {
  const rule = def.rule;
  let have = 0;
  let earnedAt: number | null = null;
  if (rule.kind === "count") {
    for (const g of games) {
      if (!rule.test(g)) continue;
      have++;
      if (have === rule.need) earnedAt = g.game.endedAt;
    }
    have = Math.min(have, rule.need);
  } else {
    const covered = new Set<string>();
    for (const g of games) {
      const key = rule.key(g);
      if (!key || !rule.keys.includes(key) || covered.has(key)) continue;
      covered.add(key);
      if (covered.size === rule.keys.length) earnedAt = g.game.endedAt;
    }
    have = covered.size;
  }
  const need = rule.kind === "count" ? rule.need : rule.keys.length;
  return {
    id: def.id,
    family: def.family,
    name: def.name,
    how: def.how,
    progress: need > 1 ? { have, need } : null,
    earned: earnedAt !== null,
    earnedAt,
    reward: def.reward,
    symbol: def.symbol,
  };
}

/** Every achievement, earned or not, in the list's order. */
export function achievementsOf(games: readonly FinishedGame[]): Achievement[] {
  const known = inOrder(games);
  return DEFINITIONS.map((def) => judge(def, known));
}

/** The achievements game `id` earned: earned with it, not without it. For the pop-up. */
export function newlyEarned(games: readonly FinishedGame[], id: string): Achievement[] {
  const before = new Set(
    achievementsOf(games.filter((g) => g.id !== id))
      .filter((a) => a.earned)
      .map((a) => a.id),
  );
  return achievementsOf(games).filter((a) => a.earned && !before.has(a.id));
}

// ── Stats ────────────────────────────────────────────────────────────────────────────────────────────────────────

const tally = (games: readonly Known[]): Tally => {
  const won = games.filter((g) => g.won).length;
  return { played: games.length, won, lost: games.length - won };
};
const minutes = (g: FinishedGame) => Math.max(0, Math.round((g.endedAt - g.startedAt) / 60000));
const heroName = (g: Known) => HEROES.find((h) => h.id === g.heroId)?.name ?? g.game.hero;

export function statsOf(games: readonly FinishedGame[]): Stats {
  const known = inOrder(games);
  const heroes: { id: string; name: string }[] = [];
  for (const g of known) {
    const id = g.heroId ?? g.game.hero;
    if (!heroes.some((h) => h.id === id)) heroes.push({ id, name: heroName(g) });
  }
  let fastest: Known | null = null;
  for (const g of known) {
    if (!g.won) continue;
    if (
      !fastest ||
      g.game.rounds < fastest.game.rounds ||
      (g.game.rounds === fastest.game.rounds && minutes(g.game) < minutes(fastest.game))
    )
      fastest = g;
  }
  let run = 0;
  let longest = 0;
  for (const g of known) {
    run = g.won ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return {
    total: tally(known),
    byVillain: VILLAINS.map((v) => ({
      id: v.id,
      name: v.name,
      tally: tally(known.filter((g) => g.game.villain === v.id)),
    })),
    byHero: heroes.map((h) => ({
      ...h,
      tally: tally(known.filter((g) => (g.heroId ?? g.game.hero) === h.id)),
    })),
    fastestWin: fastest
      ? {
          rounds: fastest.game.rounds,
          minutes: minutes(fastest.game),
          hero: heroName(fastest),
          villain: VILLAINS.find((v) => v.id === fastest!.game.villain)?.name ?? fastest.game.villain,
          endedAt: fastest.game.endedAt,
        }
      : null,
    longestWinningRun: longest,
    currentWinningRun: run,
  };
}

/** Every hero against every villain: won or not yet. */
export function stampsOf(games: readonly FinishedGame[]): Stamp[] {
  const won = new Set(
    games
      .map(knownOf)
      .filter((g) => g.won && g.heroId)
      .map((g) => `${g.heroId}/${g.game.villain}`),
  );
  return HEROES.flatMap((h) =>
    VILLAINS.map((v) => ({
      heroId: h.id,
      hero: h.name,
      villainId: v.id,
      villain: v.name,
      won: won.has(`${h.id}/${v.id}`),
    })),
  );
}

/** Everything the trophy cabinet and the record board show, from the finished games. */
export function trophyRoom(games: readonly FinishedGame[]): TrophyRoom {
  const achievements = achievementsOf(games);
  return {
    achievements,
    earned: achievements.filter((a) => a.earned).length,
    stats: statsOf(games),
    stamps: stampsOf(games),
  };
}
