import { describe, expect, test } from "vitest";

import { tuckPath } from "./tuck-path.js";

describe("a boost card going under its enemy", () => {
  test("starts at the deck and ends in its place, down on the table", () => {
    expect(tuckPath(0)).toEqual({ fly: 0, hop: 0, slide: 0 });
    expect(tuckPath(1)).toEqual({ fly: 1, hop: 0, slide: 1 });
  });

  test("is in the air on its way over, and down on the table before it slides in", () => {
    expect(tuckPath(0.3).hop).toBeGreaterThan(0.9);
    for (let i = 0; i <= 100; i++) {
      const { fly, hop, slide } = tuckPath(i / 100);
      if (slide > 0) {
        expect(hop).toBe(0);
        expect(fly).toBe(1);
      }
    }
  });

  test("only ever moves forward", () => {
    let last = tuckPath(0);
    for (let i = 1; i <= 100; i++) {
      const next = tuckPath(i / 100);
      expect(next.fly).toBeGreaterThanOrEqual(last.fly);
      expect(next.slide).toBeGreaterThanOrEqual(last.slide);
      last = next;
    }
  });
});
