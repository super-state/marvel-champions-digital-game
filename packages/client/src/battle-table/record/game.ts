/**
 * A finished game as the record keeps it, wherever it is kept (the test site's database or this browser's storage).
 *
 * Plain data with no imports, so the test site's worker (`test-site/players.ts`) reads and checks it with the same code
 * as the page.
 *
 * `facts` came in with the record (2026-11-24): a game saved before it has none, and counts for what it can
 * (`knownFacts` fills in what the table always did then).
 */

/** What a finished game tells the achievements beyond who played whom and who won. */
export interface GameFacts {
  /** The shape of these facts: bumped when a field is added. */
  readonly v: 1;
  readonly difficulty: "standard" | "expert";
  /** The modular encounter sets the game was played with, by id (`bomb_scare`). */
  readonly modules: readonly string[];
  /** The hero's identity card id (`01001a`, Spider-Man). */
  readonly heroId: string;
  /** The deck's aspects (`justice`); empty for a deck of basic cards only. */
  readonly aspects: readonly string[];
  /** Cards in the player deck, the hero's own included, the identity, obligation and nemesis set not. */
  readonly deckSize: number;
  /** The starter deck it was, card for card (`core-spider-man-justice`); null for a deck the player built. */
  readonly starterDeck: string | null;
  /** The hero's hit points left at the end (0 when knocked out). */
  readonly heroHp: number;
  /** The face up at the end. */
  readonly form: "hero" | "alterEgo";
  /** Allies played from hand over the whole game, undone moves left out. */
  readonly alliesPlayed: number;
  /** Undo was used at least once this game (the game-over Undo too). */
  readonly undo: boolean;
  /**
   * The card that dealt the last blow: at a win the villain's last damage, at a knock-out the hero's. Null when the
   * game ended another way (the main scheme) or nothing named a source.
   */
  readonly lastBlow: { readonly cardId: string; readonly name: string } | null;
}

export type Result = "win" | "loss";

/** One finished game, the same shape from either home. */
export interface FinishedGame {
  readonly id: string;
  /** The hero's name as the table shows it ("Spider-Man"). */
  readonly hero: string;
  /** The villain's id (`rhino`). */
  readonly villain: string;
  readonly result: Result;
  /** The engine's reason: `villainDefeated`, `mainSchemeCompleted`, `allPlayersDefeated`. */
  readonly reason: string;
  readonly rounds: number;
  readonly version: string;
  /** The starter deck's id, or the deck's card ids for a built one. */
  readonly deck: readonly string[];
  readonly startedAt: number;
  readonly endedAt: number;
  /** Null on a game saved before the record kept them. */
  readonly facts: GameFacts | null;
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isCount = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const textList = (v: unknown, max: number): string[] | null =>
  Array.isArray(v) && v.length <= 12 && v.every((x) => isText(x, max)) ? [...(v as string[])] : null;

/**
 * Facts as sent by a page or read back from storage, checked field by field: anything off makes the whole block null
 * (the game still saves, without them), never half-right facts.
 */
export function readFacts(raw: unknown): GameFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (f.v !== 1) return null;
  if (f.difficulty !== "standard" && f.difficulty !== "expert") return null;
  if (f.form !== "hero" && f.form !== "alterEgo") return null;
  const modules = textList(f.modules, 40);
  const aspects = textList(f.aspects, 20);
  if (!modules || !aspects || !isText(f.heroId, 20)) return null;
  if (!isCount(f.deckSize, 200) || !isCount(f.heroHp, 99) || !isCount(f.alliesPlayed, 999)) return null;
  if (f.starterDeck !== null && !isText(f.starterDeck, 60)) return null;
  if (typeof f.undo !== "boolean") return null;
  let lastBlow: GameFacts["lastBlow"] = null;
  if (f.lastBlow !== null) {
    const b = f.lastBlow as Record<string, unknown> | undefined;
    if (!b || typeof b !== "object" || !isText(b.cardId, 20) || !isText(b.name, 80)) return null;
    lastBlow = { cardId: b.cardId, name: b.name };
  }
  return {
    v: 1,
    difficulty: f.difficulty,
    modules,
    heroId: f.heroId,
    aspects,
    deckSize: f.deckSize,
    starterDeck: f.starterDeck as string | null,
    heroHp: f.heroHp,
    form: f.form,
    alliesPlayed: f.alliesPlayed,
    undo: f.undo,
    lastBlow,
  };
}

/** Facts kept as text (the test site's `facts` column): null when missing or unreadable. */
export function factsFromText(text: unknown): GameFacts | null {
  if (typeof text !== "string" || !text) return null;
  try {
    return readFacts(JSON.parse(text));
  } catch {
    return null;
  }
}
