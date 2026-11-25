import { afterEach, describe, expect, test } from "vitest";
import { arrangeScene } from "./debug-scenes.js";
import { BattleModel, observeCommits, type CommittedMove } from "./model.js";
import { judge, newMemory } from "./shown-check.js";

/**
 * The watcher has teeth: a move the table shows is judged shown, and the same move with its beats taken away is
 * judged silent (`shown-check.ts`).
 */
function capture(battle: BattleModel, move: () => void) {
  const moves: { move: CommittedMove; before: ReturnType<BattleModel["snapshot"]> }[] = [];
  let after: ReturnType<BattleModel["snapshot"]> | null = null;
  observeCommits((m) => {
    moves.push({ move: m, before: m.model.snapshot() });
    return () => (after = m.model.snapshot());
  });
  move();
  observeCommits(null);
  expect(moves).toHaveLength(1);
  return { ...moves[0]!, after: after! };
}

afterEach(() => observeCommits(null));

describe("the watcher judges a move", () => {
  test("Helicarrier's discount: shown with its beats, silent without them", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("helicarrier")! });
    const heli = battle.snapshot().inPlay.find((card) => card.name === "Helicarrier")!;
    const action = battle.fieldActions(heli.id)[0]!;
    const { move, before, after } = capture(battle, () => battle.fieldAction(heli.id, action.kind));

    const shown = judge(move.before, move.after, move.events, move.beats, before, after, newMemory());
    const begins = shown.filter((r) => r.kind === "an effect that lasts begins");
    expect(begins.length).toBeGreaterThan(0);
    expect(begins.every((r) => r.cls === "table")).toBe(true);
    expect(shown.find((r) => r.kind === "the ability fired")?.cls).toBe("table");

    // The same move with nothing played out: the discount and the ability are silent; the card turning still shows,
    // as the table draws it turned.
    const bare = judge(move.before, move.after, move.events, [], before, after, newMemory());
    expect(bare.find((r) => r.kind === "an effect that lasts begins")?.cls).toBe("silent");
    expect(bare.find((r) => r.kind === "exhausted")?.cls).toBe("table");
    expect(bare.find((r) => r.kind === "exhausted")?.how).toMatch(/^standing/);
  });

  test("a beat with only words and its card marked is words only, not on the table", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("helicarrier")! });
    const heli = battle.snapshot().inPlay.find((card) => card.name === "Helicarrier")!;
    const action = battle.fieldActions(heli.id)[0]!;
    const { move, before, after } = capture(battle, () => battle.fieldAction(heli.id, action.kind));
    const words = move.beats.map((b) => ({ text: b.text, enemy: b.enemy, actor: heli.id }));
    const said = judge(move.before, move.after, move.events, words, before, after, newMemory());
    expect(said.find((r) => r.kind === "an effect that lasts begins")?.cls).toBe("log");
  });
});
