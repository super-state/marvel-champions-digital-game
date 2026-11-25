import { describe, expect, it } from "vitest";
import { CORE_DEPS, coreScenario } from "@mc/cards";
import { createGame } from "@mc/engine";
import { STARTER, chooseDeck, chosenDeck } from "./chosen-deck.js";
import { dealVerdict } from "./deal-gate.js";
import { addCopy, binderPage, cardCount, chooseAspect, ownCardsDraft, starterDraft, type Draft } from "./deck-model.js";
import type { DeckStorage, SavedDeck } from "./deck-store.js";
import { TABLE_ASPECTS } from "./table-pool.js";

const filled = (draft: Draft, size = 40): Draft => {
  let next = draft;
  for (const tab of ["aspect", "basic"] as const)
    for (let pass = 0; pass < 3; pass++)
      for (const entry of binderPage(next, tab)) if (cardCount(next) < size) next = addCopy(next, entry.cardId);
  return next;
};
const saved = (draft: Draft, name = "Deck"): SavedDeck => ({ ...draft, id: "d1", name, updatedAt: "t" });

describe("which saved decks can be dealt", () => {
  it("offers the aspects checked on the table so far, not Protection (Black Panther's, still to come)", () => {
    expect([...TABLE_ASPECTS].sort()).toEqual(["aggression", "justice", "leadership"]);
  });

  it("passes a legal deck of an opened aspect, as one card id per copy, and coreScenario deals it", () => {
    const deck = saved(filled(chooseAspect(ownCardsDraft("01001a"), "leadership").draft), "Spidey leads");
    const verdict = dealVerdict(deck);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.deck).toMatchObject({ id: "d1", name: "Spidey leads", identityCardId: "01001a" });
    expect(verdict.deck.cards).toHaveLength(40);
    const game = createGame(
      coreScenario("rhino", {
        seed: 2,
        players: [{ identityCardId: "01001a", deck: verdict.deck.cards, aspects: verdict.deck.aspects }],
      }),
      CORE_DEPS,
    );
    expect(game.ok).toBe(true);
  });

  it("holds back a deck of an aspect not yet on the table, and says so", () => {
    const deck = saved(starterDraft("01040a"));
    expect(dealVerdict(deck)).toEqual({ ok: false, reason: "Protection cards aren't on the 3D table yet." });
    // Once the aspect is opened, the same deck deals.
    expect(dealVerdict(deck, [...TABLE_ASPECTS, "protection"]).ok).toBe(true);
  });

  it("holds back a deck that is no longer legal, in the engine's words", () => {
    const verdict = dealVerdict(saved(ownCardsDraft("01001a")));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/^Not legal yet: The deck has 15 cards; a deck must have between 40 and 50/);
  });

  it("holds back a deck whose hero isn't in the pool", () => {
    expect(dealVerdict(saved({ identityCardId: "99999a" as never, aspects: [], cards: [] })).ok).toBe(false);
  });
});

describe("the chosen deck for each hero", () => {
  const memory = (): DeckStorage => {
    const values = new Map<string, string>();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
  };

  it("is the starter deck until one is chosen, then the one chosen, per hero", () => {
    const storage = memory();
    expect(chosenDeck("spider-man", storage)).toBe(STARTER);
    chooseDeck("spider-man", "d1", storage);
    expect(chosenDeck("spider-man", storage)).toBe("d1");
    expect(chosenDeck("captain-marvel", storage)).toBe(STARTER);
  });

  it("reads as the starter deck without storage", () => {
    expect(chosenDeck("spider-man", null)).toBe(STARTER);
  });
});
