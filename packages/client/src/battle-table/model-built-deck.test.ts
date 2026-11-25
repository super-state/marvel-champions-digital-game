import { describe, expect, it } from "vitest";
import { cardOf } from "@mc/engine";
import { addCopy, binderPage, cardCount, chooseAspect, ownCardsDraft, type Draft } from "./decks/deck-model.js";
import { BattleModel, type BuiltDeck } from "./model.js";

/** Spider-Man with Leadership, a pairing no starter deck has: his 15 cards, then the aspect and basic cards to 40. */
function spiderManLeadership(): BuiltDeck {
  let draft: Draft = chooseAspect(ownCardsDraft("01001a"), "leadership").draft;
  for (const tab of ["aspect", "basic"] as const)
    for (let pass = 0; pass < 3; pass++)
      for (const entry of binderPage(draft, tab)) if (cardCount(draft) < 40) draft = addCopy(draft, entry.cardId);
  return {
    id: "deck-1",
    name: "Spidey leads",
    identityCardId: draft.identityCardId,
    aspects: draft.aspects,
    cards: draft.cards.flatMap((line) => Array.from({ length: line.quantity }, () => line.cardId as string)),
  };
}

describe("a built deck in the deal", () => {
  it("deals the hero with the deck built for them, in place of the starter deck", () => {
    const deck = spiderManLeadership();
    expect(deck.cards).toHaveLength(40);
    const model = new BattleModel();
    model.reset({ hero: "spider-man", deck, seed: 5, mulligan: true });
    const game = model.game;
    const player = game.players[0]!;
    const owned = [...player.deck, ...player.hand].map((id) => cardOf(game, id)!);
    expect(owned).toHaveLength(40);
    expect(owned.some((card) => "aspect" in card && card.aspect === "leadership")).toBe(true);
    expect(owned.some((card) => "aspect" in card && card.aspect === "justice")).toBe(false);
  });

  it("refuses a deck built for another hero", () => {
    const deck = { ...spiderManLeadership(), identityCardId: "01010a" };
    expect(() => new BattleModel().reset({ hero: "spider-man", deck, seed: 5, mulligan: true })).toThrow(
      /not a deck for spider-man/,
    );
  });

  it("deals the starter deck when no deck is given", () => {
    const model = new BattleModel();
    model.reset({ hero: "spider-man", seed: 5, mulligan: true });
    const game = model.game;
    const player = game.players[0]!;
    const owned = [...player.deck, ...player.hand].map((id) => cardOf(game, id)!);
    expect(owned.some((card) => "aspect" in card && card.aspect === "justice")).toBe(true);
  });
});
