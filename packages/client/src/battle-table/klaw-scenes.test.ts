import { describe, expect, test } from "vitest";
import { arrangeScene, sceneNames, sceneVillain } from "./debug-scenes.js";
import { BattleModel } from "./model.js";

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
});
