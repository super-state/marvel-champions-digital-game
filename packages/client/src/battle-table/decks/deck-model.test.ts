import { describe, expect, it } from "vitest";
import { CORE_DEPS, coreScenario } from "@mc/cards";
import { createGame, validateDeck } from "@mc/engine";
import {
  BUILDER_ASPECTS,
  BUILDER_HEROES,
  BUILDER_POOL,
  addCopy,
  binderPage,
  canRemove,
  cardCount,
  chooseAspect,
  copiesLeft,
  corePlayerOf,
  deckChart,
  legalityOf,
  ownCardsDraft,
  quantityOf,
  removeCopy,
  sameDeck,
  starterDraft,
  trayGroups,
  type Draft,
} from "./deck-model.js";

const SPIDER_MAN = "01001a";

/** Adds every card the binder tab offers, one copy at a time, until the deck reaches `size` or nothing more goes in. */
function fillFrom(draft: Draft, tab: "aspect" | "basic", size: number): Draft {
  let next = draft;
  for (let pass = 0; pass < 3; pass++) {
    for (const entry of binderPage(next, tab)) {
      if (cardCount(next) >= size) return next;
      next = addCopy(next, entry.cardId);
    }
  }
  return next;
}

describe("the heroes and aspects on offer", () => {
  it("are the five Core Set heroes, each with their starter deck's aspect", () => {
    expect(BUILDER_HEROES.map((h) => [h.name, h.starterAspect])).toEqual([
      ["Spider-Man", "justice"],
      ["Captain Marvel", "leadership"],
      ["She-Hulk", "aggression"],
      ["Iron Man", "aggression"],
      ["Black Panther", "protection"],
    ]);
  });

  it("are the four aspects the Core Set has cards for ('Pool has none)", () => {
    expect([...BUILDER_ASPECTS].sort()).toEqual(["aggression", "justice", "leadership", "protection"]);
  });
});

describe("starting a deck", () => {
  it("every starter deck is legal by the engine", () => {
    for (const hero of BUILDER_HEROES) {
      const draft = starterDraft(hero.identityCardId);
      expect(legalityOf(draft), hero.name).toMatchObject({ legal: true });
      expect(draft.aspects).toEqual([hero.starterAspect]);
    }
  });

  it("just the hero's own cards is 15 cards, no aspect, and the engine names the deck size as the thing to fix", () => {
    for (const hero of BUILDER_HEROES) {
      const draft = ownCardsDraft(hero.identityCardId);
      expect(cardCount(draft), hero.name).toBe(15);
      expect(draft.aspects).toEqual([]);
      const legality = legalityOf(draft);
      expect(legality.legal).toBe(false);
      expect(legality.problems[0]?.code).toBe("deck_size");
      const verdict = validateDeck(draft, BUILDER_POOL);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(legality.line).toBe(verdict.problems[0]!.message);
    }
  });
});

describe("the binder", () => {
  it("shows the hero's own cards as fixed: none can be added or taken out", () => {
    const draft = ownCardsDraft(SPIDER_MAN);
    const page = binderPage(draft, "hero");
    expect(page.length).toBeGreaterThan(0);
    expect(page.every((c) => c.fixed && !c.canAdd && !c.canRemove && c.inDeck > 0)).toBe(true);
    const first = page[0]!.cardId;
    expect(removeCopy(draft, first)).toBe(draft);
    expect(addCopy(draft, first)).toBe(draft);
  });

  it("offers no aspect card until an aspect is chosen, and basic cards always", () => {
    const draft = ownCardsDraft(SPIDER_MAN);
    expect(binderPage(draft, "aspect")).toEqual([]);
    const justice = binderPage(draft, "aspect", "justice");
    expect(justice.length).toBeGreaterThan(0);
    expect(justice.every((c) => !c.canAdd)).toBe(true);
    expect(binderPage(draft, "basic").every((c) => c.canAdd)).toBe(true);
  });

  it("asks the engine for the copy limit: three by title, one of a unique card", () => {
    let draft = chooseAspect(ownCardsDraft(SPIDER_MAN), "aggression").draft;
    const basics = binderPage(draft, "basic");
    const plain = basics.find((c) => !c.card.unique && c.card.deckLimit === 3)!;
    for (let i = 0; i < 3; i++) draft = addCopy(draft, plain.cardId);
    expect(quantityOf(draft, plain.cardId)).toBe(3);
    expect(copiesLeft(draft, plain.cardId)).toBe(0);
    expect(addCopy(draft, plain.cardId)).toBe(draft);

    const unique = basics.find((c) => c.card.unique)!;
    draft = addCopy(draft, unique.cardId);
    expect(copiesLeft(draft, unique.cardId)).toBe(0);
    expect(binderPage(draft, "basic").find((c) => c.cardId === unique.cardId)).toMatchObject({
      canAdd: false,
      canRemove: true,
      inDeck: 1,
    });
  });

  it("reads a card's own deck limit from the engine: Energy one copy, The Power of Aggression two", () => {
    let draft = chooseAspect(ownCardsDraft(SPIDER_MAN), "aggression").draft;
    draft = addCopy(draft, "01088");
    expect(quantityOf(draft, "01088")).toBe(1);
    expect(copiesLeft(draft, "01088")).toBe(0);
    draft = addCopy(addCopy(draft, "01055"), "01055");
    expect(quantityOf(draft, "01055")).toBe(2);
    expect(copiesLeft(draft, "01055")).toBe(0);
    expect(addCopy(draft, "01055")).toBe(draft);
  });

  it("takes out a line whose card is not in the pool, so a deck saved from a bigger pool can be put right", () => {
    const draft = {
      ...ownCardsDraft(SPIDER_MAN),
      cards: [...ownCardsDraft(SPIDER_MAN).cards, { cardId: "99999" as never, quantity: 1 }],
    };
    expect(legalityOf(draft).problems.some((p) => p.code === "unknown_card")).toBe(true);
    expect(canRemove(draft, "99999")).toBe(true);
    expect(quantityOf(removeCopy(draft, "99999"), "99999")).toBe(0);
  });

  it("takes copies out one at a time", () => {
    let draft = ownCardsDraft(SPIDER_MAN);
    const basic = binderPage(draft, "basic").find((c) => !c.card.unique)!;
    draft = addCopy(addCopy(draft, basic.cardId), basic.cardId);
    expect(canRemove(draft, basic.cardId)).toBe(true);
    draft = removeCopy(draft, basic.cardId);
    expect(quantityOf(draft, basic.cardId)).toBe(1);
    draft = removeCopy(draft, basic.cardId);
    expect(quantityOf(draft, basic.cardId)).toBe(0);
    expect(draft.cards.some((l) => l.cardId === basic.cardId)).toBe(false);
  });
});

describe("choosing an aspect", () => {
  it("takes out the old aspect's cards and says how many went", () => {
    const starter = starterDraft(SPIDER_MAN);
    const justiceCopies = starter.cards
      .filter((l) => BUILDER_POOL.find((c) => c.id === l.cardId && "aspect" in c && c.aspect === "justice"))
      .reduce((n, l) => n + l.quantity, 0);
    expect(justiceCopies).toBeGreaterThan(0);
    const { draft, removed } = chooseAspect(starter, "aggression");
    expect(removed).toBe(justiceCopies);
    expect(draft.aspects).toEqual(["aggression"]);
    expect(cardCount(draft)).toBe(cardCount(starter) - justiceCopies);
  });

  it("refuses Basic, which is not an aspect", () => {
    const starter = starterDraft(SPIDER_MAN);
    expect(chooseAspect(starter, "basic")).toEqual({ draft: starter, removed: 0 });
  });

  it("with an aspect chosen but none of its cards, the engine judges only the size", () => {
    let draft = chooseAspect(ownCardsDraft(SPIDER_MAN), "protection").draft;
    draft = fillFrom(draft, "basic", 50);
    expect(legalityOf(draft).problems.map((p) => p.code)).toEqual(["deck_size"]);
  });

  it("keeps the deck as it is when the same aspect is chosen again", () => {
    const starter = starterDraft(SPIDER_MAN);
    expect(chooseAspect(starter, "justice")).toEqual({ draft: starter, removed: 0 });
  });
});

describe("legality", () => {
  it("lets a 51st card in and lets the engine say the deck is too big", () => {
    let draft = chooseAspect(ownCardsDraft(SPIDER_MAN), "aggression").draft;
    draft = fillFrom(fillFrom(draft, "aspect", 51), "basic", 51);
    expect(cardCount(draft)).toBe(51);
    const legality = legalityOf(draft);
    expect(legality.legal).toBe(false);
    expect(legality.line).toMatch(/51 cards; a deck must have between 40 and 50/);
  });

  it("says a legal deck is legal, with its size", () => {
    expect(legalityOf(starterDraft(SPIDER_MAN)).line).toBe("Legal deck: 40 cards.");
  });
});

describe("the tray and the chart", () => {
  it("groups the deck by kind with a count each, adding up to the deck", () => {
    const draft = starterDraft(SPIDER_MAN);
    const groups = trayGroups(draft);
    expect(groups.map((g) => g.kind)).toEqual(["ally", "event", "support", "upgrade", "resource"]);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(cardCount(draft));
    expect(
      groups
        .flatMap((g) => g.lines)
        .filter((l) => l.fixed)
        .reduce((n, l) => n + l.quantity, 0),
    ).toBe(15);
  });

  it("charts costs (resources left out) and printed resource icons", () => {
    const draft = starterDraft(SPIDER_MAN);
    const chart = deckChart(draft);
    const resources = trayGroups(draft).find((g) => g.kind === "resource")!.count;
    expect(chart.costs.reduce((a, b) => a + b, 0)).toBe(cardCount(draft) - resources);
    const icons = chart.resources;
    expect(icons.physical + icons.mental + icons.energy + icons.wild).toBeGreaterThan(cardCount(draft) - 1);
  });
});

describe("handing a built deck to a game", () => {
  it("is nothing while the engine says the deck is not legal", () => {
    expect(corePlayerOf(ownCardsDraft(SPIDER_MAN))).toBeNull();
  });

  it("deals Spider-Man with Aggression, built through the builder, against Rhino", () => {
    let draft = chooseAspect(ownCardsDraft(SPIDER_MAN), "aggression").draft;
    draft = fillFrom(fillFrom(draft, "aspect", 40), "basic", 40);
    expect(legalityOf(draft)).toMatchObject({ legal: true, line: "Legal deck: 40 cards." });
    const seat = corePlayerOf(draft, { id: "deck-1", name: "Spidey smash" });
    expect(seat).toMatchObject({ identityCardId: SPIDER_MAN, aspects: ["aggression"], deckName: "Spidey smash" });
    const created = createGame(coreScenario("rhino", { seed: 7, players: [seat!] }), CORE_DEPS);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.state.pendingChoice?.prompt.kind).toBe("mulligan");
  });

  it("deals every starter deck through the same conversion", () => {
    for (const hero of BUILDER_HEROES) {
      const seat = corePlayerOf(starterDraft(hero.identityCardId))!;
      const created = createGame(coreScenario("rhino", { seed: 3, players: [seat] }), CORE_DEPS);
      expect(created.ok, hero.name).toBe(true);
    }
  });
});

describe("sameDeck", () => {
  it("ignores line order and notices a changed copy", () => {
    const starter = starterDraft(SPIDER_MAN);
    expect(sameDeck(starter, { ...starter, cards: [...starter.cards].reverse() })).toBe(true);
    const basic = binderPage(starter, "basic").find((c) => c.canRemove)!;
    expect(sameDeck(starter, removeCopy(starter, basic.cardId))).toBe(false);
  });
});
