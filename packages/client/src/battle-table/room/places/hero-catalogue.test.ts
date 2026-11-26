import { describe, expect, test } from "vitest";
import * as content from "@mc/content";
import { HEROES } from "../../model.js";
import { BUILDER_HEROES } from "../../decks/deck-model.js";
import { SHELF_HEROES, SHELF_RELEASES } from "./hero-catalogue.js";

/** Every hero identity `@mc/content` exports, by its card id (Ironheart's two upgrade cards are the same hero). */
function contentHeroes(): Map<string, { hero: { faceName: string }; alterEgo: { faceName: string } }> {
  const found = new Map();
  for (const value of Object.values(content)) {
    if (!Array.isArray(value)) continue;
    for (const card of value as { type?: string; id?: string }[])
      if (card?.type === "hero_identity" && card.id && !found.has(card.id)) found.set(card.id, card);
  }
  found.delete("29002a");
  found.delete("29003a");
  return found;
}

describe("the hero shelf's catalogue", () => {
  test("has every hero in the card data, once, with their printed names", () => {
    const heroes = contentHeroes();
    expect(SHELF_HEROES.map((hero) => hero.code).sort()).toEqual([...heroes.keys()].sort());
    for (const shelf of SHELF_HEROES) {
      const card = heroes.get(shelf.code)!;
      expect([shelf.name, shelf.alterEgo]).toEqual([card.hero.faceName, card.alterEgo.faceName]);
    }
  });

  test("puts every hero in a known release, and every release has heroes", () => {
    const releases = new Set(SHELF_RELEASES.map((release) => release.id));
    for (const hero of SHELF_HEROES) expect(releases).toContain(hero.release);
    for (const release of releases) expect(SHELF_HEROES.some((hero) => hero.release === release)).toBe(true);
  });

  test("has every hero the table deals", () => {
    const codes = new Set(SHELF_HEROES.map((hero) => hero.code));
    for (const hero of HEROES) {
      const card = BUILDER_HEROES.find((each) => each.starterDeckId === hero.starterDeckId);
      expect(card && codes.has(card.identityCardId), hero.name).toBe(true);
    }
  });
});
