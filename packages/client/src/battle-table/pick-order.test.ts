import { describe, expect, test } from "vitest";
import { arrangeScene } from "./debug-scenes.js";
import { BattleModel, type BattleSnapshot } from "./model.js";
import { cardPlaces, pickOrder } from "./pick-order.js";

const options = ["a", "b", "c"].map((id) => ({ id, label: id, cardId: id }));

describe("pickOrder", () => {
  test("numbers the picks of an ordered question in the order they were picked", () => {
    expect([...pickOrder({ ordered: true, options }, ["c", "a"])]).toEqual([
      ["c", 1],
      ["a", 2],
    ]);
  });

  test("unpicking one moves the picks after it up", () => {
    const picks = new Set(["b", "a", "c"]);
    picks.delete("b");
    expect([...pickOrder({ ordered: true, options }, picks)]).toEqual([
      ["a", 1],
      ["c", 2],
    ]);
  });

  test("a question that orders nothing has no numbers", () => {
    expect(pickOrder({ ordered: false, options }, ["a"]).size).toBe(0);
    expect(pickOrder({ options }, ["a"]).size).toBe(0);
    expect(pickOrder(null, ["a"]).size).toBe(0);
  });

  test("a pick that isn't one of the question's options is left out", () => {
    expect([...pickOrder({ ordered: true, options }, ["x", "b"])]).toEqual([["b", 1]]);
  });
});

describe("cardPlaces", () => {
  test("a card that is one option of the question wears its place", () => {
    expect([...cardPlaces({ ordered: true, options }, ["b", "a"])]).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  test("a card the question asks about twice (Quickstrike and Teamwork) wears no number: the list numbers them", () => {
    const keywords = [
      { id: "quickstrike", label: "Quickstrike", cardId: "m" },
      { id: "teamwork", label: "Teamwork", cardId: "m" },
      { id: "c", label: "c", cardId: "c" },
    ];
    expect([...pickOrder({ ordered: true, options: keywords }, ["teamwork", "c"])]).toEqual([
      ["teamwork", 1],
      ["c", 2],
    ]);
    expect([...cardPlaces({ ordered: true, options: keywords }, ["teamwork", "c"])]).toEqual([["c", 2]]);
  });

  test("an option with no card wears nothing on the table", () => {
    const listed = [{ id: "x", label: "x", cardId: null }, ...options];
    expect([...cardPlaces({ ordered: true, options: listed }, ["x", "a"])]).toEqual([["a", 2]]);
  });
});

/**
 * Klaw's Masters of Mayhem (`/battle/?scene=klawmasters`): "Order the enemies" is an ordered question, and the order
 * the badges show is the order the minions attack in.
 */
describe("Masters of Mayhem's order", () => {
  /** End the turn and answer plainly (pass, don't defend, the first cards) until a question orders the enemies. */
  function untilOrdered(battle: BattleModel, seen: string[] = []): NonNullable<BattleSnapshot["choice"]> {
    expect(battle.endTurn()).toBe(true);
    for (let i = 0; i < 40; i++) {
      const choice = battle.snapshot().choice;
      if (choice?.ordered) return choice;
      // Every question before it is not ordered: noted by kind, so the test can say which kinds those were.
      seen.push(choice?.offers?.length ? "offer" : choice?.max === 1 ? "single" : "other");
      expect(choice, "Masters of Mayhem's question never came").toBeTruthy();
      const options = choice!.options;
      const decline = options.find((o) => !o.cardId);
      const answered =
        (!!choice!.offers?.length && battle.choose(null)) ||
        (choice!.min > 1 && battle.chooseMany(options.slice(0, choice!.min).map((o) => o.id))) ||
        battle.choose(decline?.id ?? options.at(-1)?.id ?? null) ||
        battle.choose(null);
      expect(answered, JSON.stringify(choice)).toBe(true);
    }
    throw new Error("Masters of Mayhem's question never came");
  }

  test.each([[false], [true]])("the minions attack in the order their badges show (reversed: %s)", (reversed) => {
    const battle = new BattleModel();
    battle.reset({ villain: "klaw", seed: 7, arrange: arrangeScene("klawmasters")! });
    const seen: string[] = [];
    const choice = untilOrdered(battle, seen);
    // On the way, reaction windows (Spider-Sense) and single picks (defenders) came up, none of them ordered.
    expect(seen).toContain("offer");
    expect(seen).toContain("single");
    expect(choice.prompt).toBe("Order the enemies");
    expect(choice.options.map((o) => o.label).sort()).toEqual(["Melter", "Tiger Shark"]);
    const picks = choice.options.map((o) => o.id);
    if (reversed) picks.reverse();
    // The badges read 1, 2 in the order picked, and that list is what Confirm sends.
    const badges = pickOrder(choice, picks);
    const byBadge = [...badges].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(byBadge).toEqual(picks);
    expect(battle.chooseMany(byBadge)).toBe(true);
    // Each attack asks for a defender: the attacker numbered 1 comes first, then 2.
    const cardOf = (id: string) => choice.options.find((o) => o.id === id)!.cardId;
    for (const id of byBadge) {
      const defense = battle.snapshot().choice?.defense;
      expect(defense?.attackerId).toBe(cardOf(id));
      const decline = battle.snapshot().choice!.options.find((o) => !o.cardId)!;
      expect(battle.choose(decline.id)).toBe(true);
    }
  });
});
