/**
 * Saved decks: list, get, put, remove, kept in this browser's storage for now. The room plan gives the table one
 * record with two homes (the test site's database for friends, this browser on Adam's table); saved decks move onto
 * it later, so the store stays this small and a saved deck stays plain data: the engine's `DeckContents` plus an id,
 * a name and when it was last saved.
 *
 * An illegal deck saves like any other (a deck half built is still worth keeping). Anything in storage that does not
 * read as a saved deck is skipped, never thrown, and never lost: a save writes skipped entries back as they were, and
 * a stored value that is not a list at all is moved aside to its own key before the first save overwrites it.
 */
import type { CoreAspect, DeckCardEntry, DeckContents } from "@mc/content";

export interface SavedDeck extends DeckContents {
  readonly id: string;
  readonly name: string;
  /** ISO 8601, set by whoever saves it. */
  readonly updatedAt: string;
}

export interface DeckStore {
  /** Every saved deck, the most recently saved first. */
  list(): readonly SavedDeck[];
  get(id: string): SavedDeck | undefined;
  /** Saves the deck under its id, replacing one already there. False when the browser refused to store it. */
  put(deck: SavedDeck): boolean;
  remove(id: string): boolean;
}

export type DeckStorage = Pick<Storage, "getItem" | "setItem">;

/** The storage key, versioned so a later shape can move old decks over rather than misread them. */
export const DECKS_KEY = "mc-table-decks-v1";

/** A line the builder can show and change: a card id and at least one copy. */
const isLine = (raw: unknown): raw is DeckCardEntry =>
  typeof raw === "object" &&
  raw !== null &&
  typeof (raw as DeckCardEntry).cardId === "string" &&
  Number.isInteger((raw as DeckCardEntry).quantity) &&
  (raw as DeckCardEntry).quantity >= 1;

function readDeck(raw: unknown): SavedDeck | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== "string" || typeof d.name !== "string" || typeof d.identityCardId !== "string") return null;
  if (!Array.isArray(d.aspects) || !d.aspects.every((a) => typeof a === "string")) return null;
  if (!Array.isArray(d.cards) || !d.cards.every(isLine)) return null;
  // The same card on two lines is a deck the builder could never put right; it is left as it was, unread.
  if (new Set(d.cards.map((line: DeckCardEntry) => line.cardId)).size !== d.cards.length) return null;
  return {
    id: d.id,
    name: d.name,
    identityCardId: d.identityCardId as SavedDeck["identityCardId"],
    aspects: d.aspects as CoreAspect[],
    cards: d.cards.map((line: DeckCardEntry) => ({ cardId: line.cardId, quantity: line.quantity })),
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
  };
}

/** A store over this browser's storage (or any storage given, for tests). A storage that throws reads as empty. */
export function browserDeckStore(storage: DeckStorage | null = safeLocalStorage()): DeckStore {
  /** Every stored entry, read or not, so a save can keep the ones it could not read. */
  const readRaw = (): { readonly entries: readonly unknown[]; readonly broken: string | null } => {
    let text: string | null = null;
    try {
      text = storage?.getItem(DECKS_KEY) ?? null;
      const parsed: unknown = JSON.parse(text ?? "[]");
      return Array.isArray(parsed) ? { entries: parsed, broken: null } : { entries: [], broken: text };
    } catch {
      return { entries: [], broken: text };
    }
  };
  const readAll = (): SavedDeck[] => readRaw().entries.flatMap((raw) => readDeck(raw) ?? []);
  /** Rewrites the list: `change` maps each readable deck (null drops it); unreadable entries stay as they were. */
  const rewrite = (change: (deck: SavedDeck) => SavedDeck | null, added?: SavedDeck): boolean => {
    const { entries, broken } = readRaw();
    try {
      if (broken !== null) storage?.setItem(`${DECKS_KEY}-unreadable-${Date.now()}`, broken);
      const kept = entries.flatMap((raw) => {
        const deck = readDeck(raw);
        if (!deck) return [raw];
        const next = change(deck);
        return next ? [next] : [];
      });
      storage?.setItem(DECKS_KEY, JSON.stringify(added ? [...kept, added] : kept));
      return storage !== null;
    } catch {
      return false;
    }
  };
  return {
    list: () => readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => readAll().find((d) => d.id === id),
    put: (deck) => rewrite((d) => (d.id === deck.id ? null : d), deck),
    remove: (id) => rewrite((d) => (d.id === id ? null : d)),
  };
}

function safeLocalStorage(): DeckStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A name not yet taken: "Name", else "Name (2)", "Name (3)"… */
export function freeName(name: string, taken: readonly string[]): string {
  const base = name.trim() || "My deck";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** A copy of a saved deck under a new id and a free "copy" name. */
export function duplicateOf(deck: SavedDeck, id: string, now: string, taken: readonly string[]): SavedDeck {
  return { ...deck, id, name: freeName(`${deck.name} copy`, taken), updatedAt: now };
}
