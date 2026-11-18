import { describe, expect, test } from "vitest";
import { HandLift } from "./hand-lift.js";
import { INSPECT_HOLD_MS } from "./hold-gesture.js";

const table = { x: 120, y: 50, width: 900, height: 400 };

describe("hand lift", () => {
  test("an upward mouse drag onto the tabletop activates its original card once", () => {
    const lift = new HandLift(400, 510);
    expect(lift.move(403, 505, 40)).toBe("pressed");
    expect(lift.move(406, 475, 120)).toBe("carrying");
    expect(lift.move(630, 140, 620)).toBe("carrying");
    expect(lift.release(630, 140, table, false)).toBe(true);
    expect(lift.release(630, 140, table, false)).toBe(false);
  });

  test("a diagonal drag from a far card can reach the opposite side of the table", () => {
    const lift = new HandLift(200, 510);
    expect(lift.move(230, 505, 30)).toBe("pressed");
    expect(lift.move(265, 482, 50)).toBe("carrying");
    expect(lift.release(895, 225, table, false)).toBe(true);
  });

  test.each([
    [490, 478],
    [100, 140],
    [1020, 140],
    [300, 49],
  ])("returning to the hand or leaving the table cancels the drop at %i, %i", (x, y) => {
    const lift = new HandLift(495, 514);
    lift.move(492, 474, 75);
    expect(lift.release(x, y, table, false)).toBe(false);
  });

  test("a canceled release, still click, long press or sideways drag cannot play a card", () => {
    const canceled = new HandLift(492, 500);
    canceled.move(492, 425, 80);
    expect(canceled.release(492, 425, table, true)).toBe(false);
    for (const [x, y, elapsed] of [
      [495, 498, 40],
      [493, 475, INSPECT_HOLD_MS],
      [530, 497, 50],
    ] as const) {
      const lift = new HandLift(492, 500);
      lift.move(x, y, elapsed);
      expect(lift.release(492, 425, table, false)).toBe(false);
    }
  });
});
