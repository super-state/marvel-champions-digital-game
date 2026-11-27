import { expect, test } from "vitest";
import { indirectClick, indirectShares } from "./indirect-split.js";

// 3 damage to divide between the hero (2 hit points left) and an ally (3 left).
const choice = {
  indirect: { amount: 3 },
  options: [
    { id: "hero#1", label: "Hero (1)", cardId: "hero" },
    { id: "hero#2", label: "Hero (2)", cardId: "hero" },
    { id: "ally#1", label: "Ally (1)", cardId: "ally" },
    { id: "ally#2", label: "Ally (2)", cardId: "ally" },
    { id: "ally#3", label: "Ally (3)", cardId: "ally" },
  ],
};

const click = (picks: Set<string>, card: string) => indirectClick(choice, picks, card);

test("each click puts 1 more damage on the character clicked", () => {
  let picks = new Set<string>();
  picks = click(picks, "hero").picks;
  picks = click(picks, "ally").picks;
  picks = click(picks, "ally").picks;
  expect([...picks]).toEqual(["hero#1", "ally#1", "ally#2"]);
  expect(indirectShares(choice, picks)).toEqual(
    new Map([
      ["hero", 1],
      ["ally", 2],
    ]),
  );
});

test("a character at its limit takes its damage back off when clicked", () => {
  let picks = new Set<string>();
  picks = click(picks, "hero").picks;
  picks = click(picks, "hero").picks;
  const third = click(picks, "hero");
  expect(third.did).toBe("clear");
  expect(third.picks.size).toBe(0);
});

test("once all the damage is placed, a click takes that character's back off, and one with none does nothing", () => {
  let picks = new Set<string>();
  for (const card of ["ally", "ally", "ally"]) picks = click(picks, card).picks;
  expect(click(picks, "hero").did).toBe("none");
  const back = click(picks, "ally");
  expect(back.did).toBe("clear");
  expect(back.picks.size).toBe(0);
});

test("only a question that divides damage has shares", () => {
  expect(indirectShares({ options: choice.options }, ["hero#1"]).size).toBe(0);
});
