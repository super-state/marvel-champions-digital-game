import { describe, expect, test } from "vitest";
import { handCardPose } from "./hand-presentation.js";
import { handRow } from "./hand-row.js";

describe("hand card presentation", () => {
  test("portrait and landscape cards line up along the same baseline", () => {
    const row = handRow(
      { x: 0, y: 575, width: 1100, height: 170 },
      { handCount: 5, tableTiles: 0, fan: false, piles: "flank", landscape: [false, true] },
    );
    const bottom = row.cardArea.y + row.cardArea.height;
    const cards = row.slots.map((slot) => handCardPose(slot, bottom));
    for (const [index, { face, lifted, target }] of cards.entries()) {
      expect(face.y + face.height).toBeCloseTo(bottom);
      expect(face.width / face.height).toBeCloseTo(lifted.width / lifted.height);
      expect(lifted.y).toBeLessThan(face.y);
      expect(lifted.y + lifted.height).toBeLessThan(bottom);
      expect(target.x).toBe(row.slots[index]!.x);
      expect(target.width).toBe(row.slots[index]!.width);
      const next = cards[index + 1];
      if (next) expect(target.x + target.width).toBeLessThanOrEqual(next.target.x);
    }
  });
});
