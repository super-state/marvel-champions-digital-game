import { describe, expect, test } from "vitest";

import { tuckPath } from "./tuck-path.js";

describe("a boost card sliding under its enemy", () => {
  test("starts at the deck and ends in its place, down on the table", () => {
    expect(tuckPath(0)).toEqual({ drop: 0, across: 0 });
    expect(tuckPath(1)).toEqual({ drop: 1, across: 1 });
  });

  test("is down on the table before it has come a fifth of the way across, so it never passes over the enemy", () => {
    for (let i = 0; i <= 100; i++) {
      const { drop, across } = tuckPath(i / 100);
      if (across > 0.2) expect(drop).toBe(1);
    }
  });

  test("only ever moves forward", () => {
    let last = tuckPath(0);
    for (let i = 1; i <= 100; i++) {
      const next = tuckPath(i / 100);
      expect(next.drop).toBeGreaterThanOrEqual(last.drop);
      expect(next.across).toBeGreaterThanOrEqual(last.across);
      last = next;
    }
  });
});
