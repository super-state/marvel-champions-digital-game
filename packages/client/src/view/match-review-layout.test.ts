import { describe, expect, test } from "vitest";
import { matchReviewLayout } from "./match-review-layout.js";
import { rectsOverlap } from "./layout.js";

describe("game review", () => {
  test.each([
    [320, 480],
    [390, 844],
    [800, 460],
    [1440, 900],
  ])("both actions stay visible at %i × %i with a full team", (width, height) => {
    const { header, viewport, art, start, options, readingX, readingWidth, wide } = matchReviewLayout(width, height, 4);
    for (const action of [start, options]) {
      expect(action.y + action.height).toBeLessThanOrEqual(height);
      expect(action.x + action.width).toBeLessThanOrEqual(width);
      expect(rectsOverlap(header, action) || rectsOverlap(viewport, action)).toBe(false);
    }
    expect(rectsOverlap(start, options)).toBe(false);
    expect(readingWidth).toBeGreaterThan(230);
    if (wide) expect(readingX).toBeGreaterThan(art.x + art.width);
  });
});
