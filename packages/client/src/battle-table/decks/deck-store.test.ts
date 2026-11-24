import { describe, expect, it } from "vitest";
import { DECKS_KEY, browserDeckStore, duplicateOf, freeName, type DeckStorage, type SavedDeck } from "./deck-store.js";
import { ownCardsDraft, starterDraft } from "./deck-model.js";

/** A storage keyed by name, like the browser's; `full` makes every write throw. */
const memory = (
  initial?: string,
  full = false,
): DeckStorage & { raw: (key?: string) => string | null; keys: () => string[] } => {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(DECKS_KEY, initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (full) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    raw: (key = DECKS_KEY) => values.get(key) ?? null,
    keys: () => [...values.keys()],
  };
};

const saved = (id: string, name: string, updatedAt: string, draft = starterDraft("01001a")): SavedDeck => ({
  ...draft,
  id,
  name,
  updatedAt,
});

describe("the saved-deck store", () => {
  it("puts, lists (newest first), gets and removes", () => {
    const store = browserDeckStore(memory());
    store.put(saved("a", "Webs", "2026-11-24T10:00:00Z"));
    store.put(saved("b", "Smash", "2026-11-24T11:00:00Z"));
    expect(store.list().map((d) => d.name)).toEqual(["Smash", "Webs"]);
    expect(store.get("a")?.name).toBe("Webs");
    store.remove("a");
    expect(store.list().map((d) => d.id)).toEqual(["b"]);
    expect(store.get("a")).toBeUndefined();
  });

  it("replaces a deck saved under the same id (rename, re-save)", () => {
    const store = browserDeckStore(memory());
    store.put(saved("a", "Webs", "2026-11-24T10:00:00Z"));
    store.put({ ...store.get("a")!, name: "Webs II", updatedAt: "2026-11-24T12:00:00Z" });
    expect(store.list()).toHaveLength(1);
    expect(store.get("a")?.name).toBe("Webs II");
  });

  it("saves an illegal deck as it is", () => {
    const store = browserDeckStore(memory());
    const half = saved("h", "Half built", "2026-11-24T10:00:00Z", ownCardsDraft("01001a"));
    store.put(half);
    expect(store.get("h")).toEqual(half);
  });

  it("keeps its data under one versioned key, as plain JSON", () => {
    const storage = memory();
    browserDeckStore(storage).put(saved("a", "Webs", "t"));
    expect(JSON.parse(storage.raw()!)[0]).toMatchObject({ id: "a", name: "Webs", identityCardId: "01001a" });
    expect(DECKS_KEY).toBe("mc-table-decks-v1");
  });

  it("skips what does not read as a deck, and reads broken storage as empty", () => {
    const good = saved("a", "Webs", "t");
    const mixed = memory(JSON.stringify([good, { id: 3 }, null, { ...good, id: "b", cards: [{ cardId: 1 }] }]));
    expect(
      browserDeckStore(mixed)
        .list()
        .map((d) => d.id),
    ).toEqual(["a"]);
    expect(browserDeckStore(memory("{not json")).list()).toEqual([]);
    expect(browserDeckStore(memory('{"a":1}')).list()).toEqual([]);
    expect(browserDeckStore(null).list()).toEqual([]);
  });
});

describe("what the store could not read", () => {
  it("skips a deck with a line of no copies or a card listed twice", () => {
    const good = saved("a", "Webs", "t");
    const zero = { ...good, id: "z", cards: [...good.cards, { cardId: "01088", quantity: 0 }] };
    const twice = { ...good, id: "w", cards: [...good.cards, good.cards[0]] };
    expect(
      browserDeckStore(memory(JSON.stringify([good, zero, twice])))
        .list()
        .map((d) => d.id),
    ).toEqual(["a"]);
  });

  it("writes unreadable entries back untouched when it saves", () => {
    const future = { id: "f", name: "From a later version", shape: 2 };
    const storage = memory(JSON.stringify([future]));
    browserDeckStore(storage).put(saved("a", "Webs", "t"));
    expect(JSON.parse(storage.raw()!)).toEqual([future, expect.objectContaining({ id: "a" })]);
  });

  it("moves a stored value that is not a list aside before the first save", () => {
    const storage = memory("{not json");
    expect(browserDeckStore(storage).put(saved("a", "Webs", "t"))).toBe(true);
    const aside = storage.keys().find((k) => k.startsWith(`${DECKS_KEY}-unreadable-`));
    expect(aside && storage.raw(aside)).toBe("{not json");
    expect(
      browserDeckStore(storage)
        .list()
        .map((d) => d.id),
    ).toEqual(["a"]);
  });

  it("says so when the browser refuses to store the deck", () => {
    const store = browserDeckStore(memory(undefined, true));
    expect(store.put(saved("a", "Webs", "t"))).toBe(false);
    expect(store.list()).toEqual([]);
  });
});

describe("names", () => {
  it("finds a free name", () => {
    expect(freeName("Webs", [])).toBe("Webs");
    expect(freeName("Webs", ["Webs", "Webs (2)"])).toBe("Webs (3)");
    expect(freeName("  ", [])).toBe("My deck");
  });

  it("duplicates under a new id and a copy name", () => {
    const copy = duplicateOf(saved("a", "Webs", "t"), "z", "t2", ["Webs", "Webs copy"]);
    expect(copy).toMatchObject({ id: "z", name: "Webs copy (2)", updatedAt: "t2", identityCardId: "01001a" });
  });
});
