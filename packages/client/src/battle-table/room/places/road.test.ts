import { describe, expect, it } from "vitest";
import { unlockedFrom } from "../../test-site/players.js";
import type { VillainId } from "../../model.js";
import { boxLock, roadFrom, type RoadGame } from "./road.js";
import { SHELF_PRODUCTS } from "./scenario-catalogue.js";

const win = (villain: string, difficulty: "standard" | "expert" | null = "standard"): RoadGame => ({
  villain,
  result: "win",
  facts: difficulty ? ({ difficulty } as RoadGame["facts"]) : null,
});
const loss = (villain: string): RoadGame => ({ villain, result: "loss", facts: null });

/** A friend's road: the locks worked out from their games, as the test site does. */
function friend(games: RoadGame[]) {
  const open = new Set(unlockedFrom(games));
  return roadFrom({ games, lock: (v: VillainId) => (open.has(v) ? null : "Locked"), allOpen: false });
}
const statuses = (road: ReturnType<typeof roadFrom>) => road.steps.map((s) => `${s.step.key}=${s.status}`);
const box = (code: string) => SHELF_PRODUCTS.find((p) => p.code === code)!;

describe("the road's prologue", () => {
  it("starts at Rhino, the others locked; Campaign never shows Expert", () => {
    const road = friend([]);
    expect(road.next?.key).toBe("rhino");
    expect(statuses(road)).toEqual(["rhino=next", "klaw=locked", "ultron=locked"]);
    expect(road.steps.filter((s) => s.playable).map((s) => s.step.key)).toEqual(["rhino"]);
    expect(road.steps.some((s) => /expert/i.test(s.step.key + s.step.name))).toBe(false);
  });

  it("ticks a beaten villain and lights the next; a loss changes nothing", () => {
    const road = friend([loss("rhino"), win("rhino")]);
    expect(statuses(road)).toEqual(["rhino=beaten", "klaw=next", "ultron=locked"]);
    expect(road.steps[0]!.playable).toBe(false);
    expect(road.steps[0]!.line).toMatch(/Free Play/);
    expect(road.steps[2]!.line).toBe("Locked");
  });

  it("counts a win in any difficulty (call 5), an old game without facts too", () => {
    expect(statuses(friend([win("rhino", "expert")])).slice(0, 2)).toEqual(["rhino=beaten", "klaw=next"]);
    expect(statuses(friend([win("rhino", null)])).slice(0, 2)).toEqual(["rhino=beaten", "klaw=next"]);
  });

  it("is done when all three are beaten: nothing next, nothing to play from Campaign", () => {
    const road = friend([win("rhino"), win("klaw"), win("ultron")]);
    expect(road.standardDone).toBe(true);
    expect(road.next).toBeNull();
    expect(road.steps.every((s) => s.status === "beaten" && !s.playable)).toBe(true);
  });

  it("on Adam's own table (or with no record) every step plays, still ticked and marked", () => {
    const open = roadFrom({ games: [win("rhino")], lock: () => null, allOpen: true });
    expect(open.steps.every((s) => s.playable)).toBe(true);
    expect(statuses(open)).toEqual(["rhino=beaten", "klaw=next", "ultron=open"]);
    const unsaved = roadFrom({ games: null, lock: () => null, allOpen: false });
    expect(unsaved.steps.every((s) => s.playable)).toBe(true);
  });

  it("keeps the room's lock as the gate", () => {
    const road = roadFrom({
      games: [win("rhino")],
      lock: (v) => (v === "rhino" ? null : "Beat Rhino to unlock"),
      allOpen: false,
    });
    expect(road.steps[1]!.status).toBe("locked");
    expect(road.steps[1]!.line).toBe("Beat Rhino to unlock");
    expect(road.next).toBeNull();
  });
});

describe("boxes on the road", () => {
  const start = { standardDone: false, allOpen: false };
  const prologueDone = { standardDone: true, allOpen: false };

  it("reaches the Core Set and the side stories after it from the start; the chapters wait", () => {
    expect(boxLock(box("core"), start)).toBeNull();
    expect(boxLock(box("gob"), start)).toBeNull();
    expect(boxLock(box("twc"), start)).toBeNull();
    expect(boxLock(box("trors"), start)).toBe("Beat Rhino, Klaw and Ultron to reach it");
    expect(boxLock(box("toafk"), start)).toBe("Opens when the road reaches The Rise of Red Skull");
    expect(boxLock(box("gmw"), start)).toBe("Finish The Rise of Red Skull to reach it");
  });

  it("reaches the first chapter and its side story once the prologue's Standard half is done", () => {
    expect(boxLock(box("trors"), prologueDone)).toBeNull();
    expect(boxLock(box("toafk"), prologueDone)).toBeNull();
    expect(boxLock(box("gmw"), prologueDone)).toBe("Finish The Rise of Red Skull to reach it");
    expect(boxLock(box("hood"), prologueDone)).toBe("Opens when the road reaches The Mad Titan's Shadow");
  });

  it("locks nothing on an all-open table", () => {
    for (const product of SHELF_PRODUCTS) expect(boxLock(product, { standardDone: false, allOpen: true })).toBeNull();
  });
});
