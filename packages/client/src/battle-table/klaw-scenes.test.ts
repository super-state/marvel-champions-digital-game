import { describe, expect, test } from "vitest";
import { arrangeScene, sceneNames, sceneVillain } from "./debug-scenes.js";
import { BattleModel, type BattleSnapshot } from "./model.js";

/** End the turn and answer every question with its last option (or none) until the hero's turn: every beat shown. */
function throughVillainPhase(battle: BattleModel): BattleSnapshot["beats"][number][] {
  const beats: BattleSnapshot["beats"][number][] = [];
  expect(battle.endTurn()).toBe(true);
  beats.push(...battle.snapshot().beats);
  for (let i = 0; i < 30; i++) {
    const view = battle.snapshot();
    if (view.turn === "player" && !view.choice) break;
    const options = view.choice?.options ?? [];
    const picked =
      (view.choice && view.choice.min > 1
        ? battle.chooseMany(options.slice(0, view.choice.min).map((o) => o.id))
        : false) ||
      battle.choose(options.at(-1)?.id ?? null) ||
      battle.choose(null);
    expect(picked, JSON.stringify(view.choice)).toBe(true);
    beats.push(...battle.snapshot().beats);
  }
  return beats;
}

/** Klaw's dev scenes (`/battle/?scene=klaw…`) must deal on any shuffle: setup's minion and card copies vary by seed. */
describe("Klaw's dev scenes", () => {
  const klaw = sceneNames().filter((name) => sceneVillain(name) === "klaw");

  test("there are scenes for Klaw", () => {
    expect(klaw.length).toBeGreaterThanOrEqual(6);
  });

  test.each(klaw)("%s deals on twenty different shuffles", (name) => {
    for (let seed = 1; seed <= 20; seed++) {
      const battle = new BattleModel();
      battle.reset({ villain: "klaw", seed, arrange: arrangeScene(name)! });
      const view = battle.snapshot();
      expect(view.villain.name).toBe("Klaw");
      expect(view.turn).toBe("player");
    }
  });

  test('klawstage: one attack flips Klaw to his second stage and The "Immortal" Klaw comes in', () => {
    const battle = new BattleModel();
    battle.reset({ villain: "klaw", seed: 7, arrange: arrangeScene("klawstage")! });
    expect(battle.snapshot().villainHp).toBe(1);
    expect(battle.heroAction("basicAttack")).toBe(true);
    if (battle.snapshot().choice || !battle.snapshot().enemyCards.some((c) => c.name.includes("Immortal")))
      battle.choose(battle.snapshot().villain.id);
    const view = battle.snapshot();
    expect(view.enemyCards.map((card) => card.name)).toContain('The "Immortal" Klaw');
    // Klaw (II) has 18 hit points, +10 while The "Immortal" Klaw is in play.
    expect(view.villainHp).toBe(28);
  });

  test("klawadvance: Underground Distribution completes, turns over to Secret Rendezvous, and a minion enters play", () => {
    const battle = new BattleModel();
    battle.reset({ villain: "klaw", seed: 7, arrange: arrangeScene("klawadvance")! });
    const beats = throughVillainPhase(battle);
    const texts = beats.map((beat) => beat.text);
    // The threat that completes it goes on Underground Distribution, under that name.
    expect(texts).toContain("Underground Distribution gains 1 threat");
    const advance = beats.find((beat) => beat.schemeAdvance)?.schemeAdvance;
    expect(advance).toMatchObject({
      from: "Underground Distribution",
      to: "Secret Rendezvous",
      stage: 2,
      threat: 0,
      target: 8,
    });
    const entered = beats.find((beat) => beat.entersPlay);
    expect(entered?.text).toMatch(/ enters play$/);
    expect(beats.indexOf(entered!)).toBeGreaterThan(beats.findIndex((beat) => beat.schemeAdvance));
    // The villain phase is round 1's, though the state is already round 2 by the time it is shown.
    expect(beats.find((beat) => beat.phase === "villain")?.round).toBe(1);
    expect(beats.find((beat) => beat.phase === "hero")?.round).toBe(2);
    expect(battle.snapshot().round).toBe(2);
  });

  test("klawsonic: Sonic Boom's question says what declining does", () => {
    const battle = new BattleModel();
    battle.reset({ villain: "klaw", seed: 7, arrange: arrangeScene("klawsonic")! });
    expect(battle.endTurn()).toBe(true);
    for (let i = 0; i < 6 && !/^Spend/.test(battle.snapshot().choice?.prompt ?? ""); i++) {
      const options = battle.snapshot().choice?.options ?? [];
      battle.choose(options.at(-1)?.id ?? null);
    }
    expect(battle.snapshot().choice?.prompt).toBe(
      "Spend 1 energy, 1 mental, 1 physical, or exhaust each character you control?",
    );
  });

  test("klawgear: Sonic Converter and Solid-Sound Body each offer to be paid off Klaw", () => {
    const battle = new BattleModel();
    battle.reset({ villain: "klaw", seed: 7, arrange: arrangeScene("klawgear")! });
    const gear = battle.snapshot().enemyCards.filter((card) => card.type === "attachment");
    expect(gear.map((card) => card.name).sort()).toEqual(["Solid-Sound Body", "Sonic Converter"]);
    for (const card of gear)
      expect(battle.fieldActions(card.id).map((action) => action.label)).toEqual([
        "Discard it: spend energy, mental, physical",
      ]);
  });
});
