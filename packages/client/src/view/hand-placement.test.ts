import { describe, expect, test } from "vitest";
import { HAND_PLACEMENT_MS, handPlacementAt, handPlacementSlot } from "./hand-placement.js";

describe("hand placement", () => {
  const window = { x: 0, y: 64, width: 900, height: 390 };
  const area = { x: 330, y: 275, width: 560, height: 300 };

  test.each([false, true])("keeps the whole card in the visible play area, landscape=%s", (landscape) => {
    const slot = handPlacementSlot(area, window, landscape)!;
    expect(slot.x).toBeGreaterThan(area.x);
    expect(slot.x + slot.width).toBeLessThan(area.x + area.width);
    expect(slot.y).toBeGreaterThan(area.y);
    expect(slot.y + slot.height).toBeLessThan(window.y + window.height);
    expect(slot.width > slot.height).toBe(landscape);
  });

  test("flies from the actual origin and finishes at the reserved slot", () => {
    const from = { x: 420, y: 525, width: 90, height: 126 };
    const to = handPlacementSlot(area, window, false)!;
    expect(handPlacementAt(from, to, 0)).toEqual(from);
    expect(handPlacementAt(from, to, HAND_PLACEMENT_MS + 50)).toEqual(to);
    expect(handPlacementAt(from, to, HAND_PLACEMENT_MS / 2).y).toBeLessThan((from.y + to.y) / 2);
  });
});
