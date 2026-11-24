import { writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { arrangeScene, sceneNames, sceneVillain } from "./debug-scenes.js";
import { BattleModel, type BattleSnapshot } from "./model.js";

type Beat = BattleSnapshot["beats"][number];

/**
 * End the turn and answer every question until the hero's turn: every beat shown, and every question asked on the
 * way. `prefer` picks an option by its label where one matches; otherwise the last option (or none).
 */
function throughVillainPhase(battle: BattleModel, prefer: RegExp | null = null) {
  const beats: Beat[] = [];
  const asked: string[] = [];
  expect(battle.endTurn()).toBe(true);
  beats.push(...battle.snapshot().beats);
  for (let i = 0; i < 40; i++) {
    const view = battle.snapshot();
    if (view.outcome || (view.turn === "player" && !view.choice)) break;
    const options = view.choice?.options ?? [];
    if (view.choice) asked.push(`${view.choice.prompt} [${options.map((o) => o.label).join(" | ")}]`);
    const wanted = prefer ? options.find((o) => prefer.test(o.label)) : undefined;
    const picked =
      (wanted ? battle.choose(wanted.id) : false) ||
      (view.choice && view.choice.min > 1
        ? battle.chooseMany(options.slice(0, view.choice.min).map((o) => o.id))
        : false) ||
      battle.choose(options.at(-1)?.id ?? null) ||
      battle.choose(null);
    expect(picked, JSON.stringify(view.choice)).toBe(true);
    beats.push(...battle.snapshot().beats);
  }
  return { beats, asked, texts: beats.map((beat) => beat.text).filter(Boolean) };
}

function deal(scene: string, seed = 7): BattleModel {
  const battle = new BattleModel();
  battle.reset({ villain: "ultron", seed, arrange: arrangeScene(scene)! });
  return battle;
}

const drones = (view: BattleSnapshot) => view.enemyCards.filter((card) => card.drone);

/** Ultron's dev scenes (`/battle/?scene=ultron…`) must deal on any shuffle: the cards under the Drones vary by seed. */
describe("Ultron's dev scenes", () => {
  const ultron = sceneNames().filter((name) => sceneVillain(name) === "ultron");

  test("there are scenes for Ultron", () => {
    expect(ultron.length).toBeGreaterThanOrEqual(12);
  });

  test.each(ultron)("%s deals on twenty different shuffles", (name) => {
    for (let seed = 1; seed <= 20; seed++) {
      const view = deal(name, seed).snapshot();
      expect(view.villain.name).toBe("Ultron");
      expect(view.turn).toBe("player");
      // Setup's own Drone is always there, on the villain's side and never among the player's cards.
      expect(drones(view).length).toBeGreaterThanOrEqual(1);
      expect(view.inPlay.some((card) => card.drone)).toBe(false);
    }
  });

  // What each scene shows, in words, for reading while building (ULTRON_SCENES_REPORT=<file>).
  test.runIf(process.env.ULTRON_SCENES_REPORT)("report", () => {
    const lines: string[] = [];
    for (const name of ultron) {
      const battle = deal(name);
      const view = battle.snapshot();
      lines.push(`\n===== ${name}`);
      lines.push(
        `villain ${view.villain.name} ${view.villainHp}hp ${JSON.stringify(view.villain.markers)} | hero ${view.hero.name} ${view.heroHp}hp`,
      );
      for (const card of view.enemyCards)
        lines.push(
          `  enemy ${card.name} (${card.type}${card.attachedTo ? ", attached" : ""}) hp=${card.hp ?? "-"} threat=${card.threat ?? "-"}/${card.threatTarget ?? "-"} ${JSON.stringify(card.markers)} actions=${JSON.stringify(battle.fieldActions(card.id).map((a) => a.label))}`,
        );
      lines.push(`  heroActions ${JSON.stringify(view.heroActions.map((a) => a.label))}`);
      if (view.heroActions.some((a) => a.kind === "basicThwart")) {
        battle.heroAction("basicThwart");
        const pick = battle.snapshot().choice;
        lines.push(`  thwart -> ${pick ? pick.options.map((o) => o.label).join(" | ") : "(went straight through)"}`);
        if (pick) battle.cancel();
        else battle.undo();
      }
      const { beats, asked } = throughVillainPhase(battle, /Drone/);
      for (const beat of beats) if (beat.text) lines.push(`  beat ${beat.text}${beat.droneIn ? "  [droneIn]" : ""}`);
      for (const question of asked) lines.push(`  asked ${question}`);
      const after = battle.snapshot();
      lines.push(
        `  after: drones=${drones(after).length} deck=${after.deckCount} discard=${after.discard.length} main=${after.enemyCards.find((c) => c.type === "main_scheme")?.name} ${after.enemyCards.find((c) => c.type === "main_scheme")?.threat}`,
      );
    }
    writeFileSync(process.env.ULTRON_SCENES_REPORT!, lines.join("\n"));
  });
});
