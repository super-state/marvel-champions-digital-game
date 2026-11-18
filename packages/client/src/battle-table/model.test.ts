import { beforeEach, describe, expect, test } from "vitest";
import { BattleModel } from "./model.js";

describe("Peter Parker and Rhino's practice turn", () => {
  let battle: BattleModel;

  beforeEach(() => {
    battle = new BattleModel();
    battle.reset();
  });

  function pick(name: string) {
    const card = battle.snapshot().hand.find((candidate) => candidate.name === name)!;
    expect(battle.pick(card.id)).toBe(true);
    return card;
  }

  function spend(label: string) {
    const source = battle.snapshot().payment!.sources.find((candidate) => candidate.label === label)!;
    expect(source).toBeDefined();
    battle.toggle(source.id);
    return source;
  }

  test("ends the player turn, resolves the enemy turn, and starts the next round", () => {
    expect(battle.snapshot()).toMatchObject({ turn: "player", round: 1, canEndTurn: true });
    expect(battle.endTurn()).toBe(true);
    expect(battle.snapshot()).toMatchObject({
      turn: "ending",
      canEndTurn: false,
      choice: { discardFromHand: true, min: 1 },
    });
    expect(battle.endTurn()).toBe(false);
    const strength = battle.snapshot().choice!.options.find((option) => option.label === "Strength")!;
    expect(battle.chooseMany([])).toBe(false);
    expect(battle.chooseMany([strength.id])).toBe(true);
    expect(battle.snapshot()).toMatchObject({ turn: "enemy", canEndTurn: false });
    for (let i = 0; i < 12 && battle.snapshot().turn === "enemy"; i++) {
      const choice = battle.snapshot().choice!;
      expect(choice).not.toBeNull();
      expect(battle.chooseMany(choice.options.slice(0, choice.min).map((option) => option.id))).toBe(true);
    }
    expect(battle.snapshot()).toMatchObject({ turn: "player", round: 2, canEndTurn: true });
    expect(battle.snapshot().heroHp).toBeLessThan(10);
    expect(battle.snapshot().discard.some((card) => card.name === "Strength")).toBe(true);
  });

  test("deals the same visible cards after reset and identifies cards that only pay", () => {
    const opening = battle.snapshot();
    expect(opening.hero.name).toContain("Spider-Man");
    expect(opening.villain.name).toContain("Rhino");
    expect(opening.heroHp).toBe(10);
    expect(opening.villainHp).toBe(14);
    expect(opening.hand).toHaveLength(6);
    expect(opening.discard).toEqual([]);
    expect(opening.hand.every((card) => card.art.includes("/card-art/") && !card.art.includes("back"))).toBe(true);
    const strength = opening.hand.find((card) => card.name === "Strength")!;
    expect(strength).toMatchObject({ playable: false, type: "resource" });
    expect(battle.pick(strength.id)).toBe(false);
    battle.reset();
    expect(battle.snapshot()).toEqual(opening);
  });

  test("requires manual payment and commits only the chosen resources to play a support", () => {
    const subject = pick("Helicarrier");
    let priced = battle.snapshot().payment!;
    expect(priced).toMatchObject({ subject, paid: 0, required: 3, canPay: false });
    expect(priced.sources.some((source) => source.cardId === subject.id)).toBe(false);
    expect(battle.pay()).toBe(false);
    const strength = spend("Strength");
    expect(strength.icons).toEqual(["physical", "physical"]);
    expect(battle.snapshot().payment).toMatchObject({ paid: 2, canPay: false });
    expect(battle.pay()).toBe(false);
    const extra = spend("Heroic Intuition");
    expect(extra.icons).toHaveLength(1);
    priced = battle.snapshot().payment!;
    expect(priced).toMatchObject({ paid: 3, required: 3, canPay: true });
    expect(battle.snapshot().hand).toHaveLength(6);
    expect(battle.pay()).toBe(true);
    expect(battle.pay()).toBe(false);
    const result = battle.snapshot();
    expect(result.hand).toHaveLength(3);
    expect(result.hand.some((card) => [subject.id, extra.cardId, strength.cardId].includes(card.id))).toBe(false);
    expect(result.inPlay.some((card) => card.id === subject.id)).toBe(true);
    expect(result.discard.map((card) => card.id)).toEqual([strength.cardId, extra.cardId]);
  });

  test("deselecting or cancelling a staged card leaves the original hand intact", () => {
    const opening = battle.snapshot();
    pick("Heroic Intuition");
    spend("Strength");
    expect(battle.snapshot().payment?.canPay).toBe(true);
    spend("Strength");
    expect(battle.snapshot().payment?.paid).toBe(0);
    expect(battle.snapshot().payment?.discards).toEqual([]);
    spend("Strength");
    battle.cancel();
    expect(battle.snapshot()).toEqual(opening);
  });

  test("reselecting a source moves its card to the top of the proposed and committed discard stack", () => {
    pick("Helicarrier");
    const strength = spend("Strength");
    const intuition = spend("Heroic Intuition");
    spend("Strength");
    spend("Strength");
    const proposed = [intuition.cardId, strength.cardId];
    const before = battle.snapshot();
    expect(before.payment?.discards).toEqual(proposed);
    expect(before.discard).toHaveLength(0);
    expect(battle.pay()).toBe(true);
    const { discard } = battle.snapshot();
    expect(discard.map((card) => card.id)).toEqual(proposed);
    expect(discard.map((card) => card.name)).toEqual(["Heroic Intuition", "Strength"]);
    for (const card of discard) {
      expect(card.art).toBe(before.hand.find((source) => source.id === card.id)!.art);
    }
  });

  test("paying for Swinging Web Kick allows the real engine to damage Rhino", () => {
    const kick = pick("Swinging Web Kick");
    const strength = spend("Strength");
    const intuition = spend("Heroic Intuition");
    expect(battle.pay()).toBe(true);
    const pending = battle.snapshot().choice;
    if (pending) {
      expect(battle.snapshot().discard.map((card) => card.id)).toEqual([strength.cardId, intuition.cardId]);
      const target = pending.options.find((option) => option.label.includes("Rhino"))!;
      expect(target).toBeDefined();
      expect(battle.choose(target.id)).toBe(true);
    }
    expect(battle.snapshot().villainHp).toBe(6);
    expect(battle.snapshot().inPlay.some((card) => card.name === "Swinging Web Kick")).toBe(false);
    expect(battle.snapshot().discard.map((card) => card.id)).toEqual([strength.cardId, intuition.cardId, kick.id]);
    expect(battle.snapshot().discard.at(-1)?.art).toBe(kick.art);
  });
});
