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

  test("undo restores one committed move, including payment, hand order and End Turn", () => {
    const opening = battle.snapshot();
    expect(battle.undo()).toBe(false);
    battle.heroAction("changeForm");
    pick("Helicarrier");
    spend("Strength");
    spend("Jessica Jones");
    expect(battle.pay()).toBe(true);
    const paid = battle.snapshot();
    expect(battle.endTurn()).toBe(true);
    expect(battle.undo()).toBe(true);
    expect(battle.snapshot()).toMatchObject({
      inPlay: paid.inPlay,
      discard: paid.discard,
      hand: paid.hand,
      choice: null,
    });
    expect(battle.undo()).toBe(true);
    expect(battle.snapshot()).toMatchObject({ inPlay: [], discard: [], payment: null, hero: { name: "Spider-Man" } });
    expect(battle.snapshot().hand.map((c) => c.id)).toEqual(opening.hand.map((c) => c.id));
    expect(battle.undo()).toBe(true);
    expect(battle.snapshot().hero).toEqual(opening.hero);
    expect(battle.canUndo).toBe(false);
    battle.endTurn();
    battle.reset();
    expect(battle.canUndo).toBe(false);
  });

  test("shows the basic attack impact before turning the attacker sideways", () => {
    battle.heroAction("changeForm");
    const hero = battle.snapshot().hero.id;
    expect(battle.heroAction("basicAttack")).toBe(true);
    const { beats } = battle.snapshot();
    const impact = beats.findIndex((beat) => beat.hit?.source === hero);
    expect(impact).toBeGreaterThanOrEqual(0);
    expect(beats.findIndex((beat) => beat.turned?.id === hero && beat.turned.exhausted)).toBeGreaterThan(impact);
    expect(battle.snapshot().hero.exhausted).toBe(true);
  });

  test("Spider-Man stays exhausted after defending Rhino and cannot also defend Hydra Bomber", () => {
    battle.heroAction("changeForm");
    const hero = battle.snapshot().hero.id;
    const defended: string[] = [];
    const attackHits: string[] = [];
    for (let round = 1; round <= 2; round++) {
      expect(battle.endTurn()).toBe(true);
      for (let step = 0; step < 24; step++) {
        const { beats, choice, turn } = battle.snapshot();
        for (const beat of beats) if (beat.hit?.target === hero && beat.activity) attackHits.push(beat.activity);
        if (turn === "player" && !choice) break;
        expect(choice).toBeTruthy();
        if (!choice) break;
        if (choice.defense) {
          const defender = choice.options.find((opt) => opt.cardId === hero);
          expect(defender).toBeDefined();
          defended.push(choice.defense.attacker);
          expect(battle.choose(defender!.id)).toBe(true);
        } else {
          const options = choice.options.filter((o) => o.label === "Strength" && choice.discardFromHand);
          const picks = options.length ? [options[0]!] : choice.options.slice(0, choice.min);
          expect(battle.chooseMany(picks.map((opt) => opt.id))).toBe(true);
        }
      }
      expect(battle.snapshot().hero.exhausted).toBe(true);
    }
    expect(defended).toEqual(["Rhino", "Rhino"]);
    expect(attackHits).toContain("Hydra Bomber attacks");
  });

  test("ends the player turn, resolves the enemy turn, and starts the next round", () => {
    expect(battle.snapshot()).toMatchObject({ turn: "player", round: 1, canEndTurn: true });
    expect(battle.heroAction("changeForm")).toBe(true);
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
    expect(opening.hero.name).toContain("Peter Parker");
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

  test("a newly played ally can attack, exhausts and takes consequential damage", () => {
    const ally = pick("Jessica Jones");
    spend("Strength");
    spend("Heroic Intuition");
    expect(battle.pay()).toBe(true);
    expect(battle.fieldActions(ally.id)).toContainEqual({ kind: "basicAttack", label: "Attack" });
    expect(battle.fieldAction(ally.id, "basicAttack")).toBe(true);
    const board = battle.snapshot();
    expect(board.villainHp).toBeLessThan(14);
    expect(board.inPlay.find((c) => c.id === ally.id)).toMatchObject({
      exhausted: true,
      markers: [{ name: "damage", count: 1 }],
    });
    expect(battle.fieldAction(ally.id, "basicAttack")).toBe(false);
  });

  test("can exhaust a newly played Helicarrier to discount the next play", () => {
    const carrier = pick("Helicarrier");
    spend("Strength");
    spend("Jessica Jones");
    expect(battle.pay()).toBe(true);
    const [action] = battle.fieldActions(carrier.id);
    expect(action).toBeDefined();
    expect(battle.fieldAction(carrier.id, action!.kind)).toBe(true);
    expect(battle.snapshot().inPlay.find((c) => c.id === carrier.id)?.exhausted).toBe(true);
    expect(battle.fieldActions(carrier.id)).toEqual([]);
    pick("Heroic Intuition");
    expect(battle.snapshot().payment?.required).toBe(1);
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
    const spare = priced.sources.find((s) => !s.selected)!;
    expect(spare.available).toBe(false);
    battle.toggle(spare.id);
    expect(battle.snapshot().payment!.paid).toBe(3);
    battle.toggle(extra.id);
    expect(battle.snapshot().payment!.sources.find((s) => s.id === spare.id)?.available).toBe(true);
    battle.toggle(extra.id);
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
    expect(battle.heroAction("changeForm")).toBe(true);
    const kick = pick("Swinging Web Kick");
    const strength = spend("Strength");
    const intuition = spend("Heroic Intuition");
    expect(battle.pay()).toBe(true);
    expect(battle.snapshot().choice).toBeNull();
    expect(
      battle
        .snapshot()
        .beats.some((beat) => beat.hit?.target === battle.snapshot().villain.id && beat.hit.amount === 8),
    ).toBe(true);
    expect(battle.snapshot().villainHp).toBe(6);
    expect(battle.snapshot().inPlay.some((card) => card.name === "Swinging Web Kick")).toBe(false);
    expect(battle.snapshot().discard.map((card) => card.id)).toEqual([strength.cardId, intuition.cardId, kick.id]);
    expect(battle.snapshot().discard.at(-1)?.art).toBe(kick.art);
  });
});

describe("the opening hand", () => {
  test("a dealt game waits on the mulligan, swaps the picked cards and then starts the hero phase", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 75, mulligan: true });
    const opening = battle.snapshot();
    expect(opening.choice).toMatchObject({ mulligan: true, min: 0, max: opening.hand.length });
    expect(opening.canEndTurn).toBe(false);
    const picks = opening.choice!.options.slice(0, 2);
    const swapped = picks.map((option) => option.cardId!);
    expect(battle.chooseMany(picks.map((option) => option.id))).toBe(true);

    const after = battle.snapshot();
    expect(after.choice).toBeNull();
    expect(after.turn).toBe("player");
    expect(after.hand).toHaveLength(opening.hand.length);
    expect(after.discard.map((card) => card.id)).toEqual(expect.arrayContaining(swapped));
    const discarded = after.beats.findIndex((beat) => beat.handDiscard);
    const drawn = after.beats.findIndex((beat) => beat.draw?.length === 2);
    const heroPhase = after.beats.findIndex((beat) => beat.phase === "hero");
    expect(after.beats[discarded]?.handDiscard).toEqual(expect.arrayContaining(swapped));
    expect(drawn).toBeGreaterThan(discarded);
    expect(heroPhase).toBeGreaterThan(drawn);

    // Undo goes back to the same opening hand, still waiting on the mulligan.
    expect(battle.undo()).toBe(true);
    expect(battle.snapshot().choice?.mulligan).toBe(true);
    expect(battle.snapshot().hand.map((card) => card.id)).toEqual(opening.hand.map((card) => card.id));
    expect(battle.canUndo).toBe(false);
  });

  test("keeping the hand shows only the hero phase starting", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 75, mulligan: true });
    expect(battle.chooseMany([])).toBe(true);
    const { beats } = battle.snapshot();
    expect(beats.filter((beat) => beat.handDiscard || beat.draw)).toHaveLength(0);
    expect(beats.some((beat) => beat.phase === "hero")).toBe(true);
  });

  test("each seed is its own deal, and the same seed deals the same hand again", () => {
    const hand = (seed: number) => {
      const battle = new BattleModel();
      battle.reset({ seed, mulligan: true });
      return battle.snapshot().hand.map((card) => card.name);
    };
    expect(hand(1234)).toEqual(hand(1234));
    expect(hand(1234)).not.toEqual(hand(75));
  });
});
