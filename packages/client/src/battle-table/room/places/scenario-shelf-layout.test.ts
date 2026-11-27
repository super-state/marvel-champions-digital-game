import { expect, test } from "vitest";
import { SHELF_PRODUCTS } from "./scenario-catalogue.js";
import { SCENARIO_CASE, layoutScenarios } from "./scenario-shelf-layout.js";

const layout = layoutScenarios(SHELF_PRODUCTS, { back: 0, bottom: 0 });

test("stands every box once, in the order they came out, left to right and top to bottom", () => {
  expect(layout.slots.map((slot) => slot.product.code)).toEqual(SHELF_PRODUCTS.map((p) => p.code));
  for (let i = 1; i < layout.slots.length; i++) {
    const [a, b] = [layout.slots[i - 1]!, layout.slots[i]!];
    const sameShelf = Math.abs(a.at.y - a.size.tall / 2 - (b.at.y - b.size.tall / 2)) < 1e-6;
    if (sameShelf) expect(b.at.x).toBeGreaterThan(a.at.x);
    else expect(b.at.y).toBeLessThan(a.at.y);
  }
});

test("keeps every box inside the bookcase, standing on a shelf, none overlapping another", () => {
  const left = SCENARIO_CASE.x - SCENARIO_CASE.width / 2;
  const right = SCENARIO_CASE.x + SCENARIO_CASE.width / 2;
  const boxes = layout.slots.map(({ at, size }) => ({
    x: [at.x - size.across / 2, at.x + size.across / 2] as const,
    y: [at.y - size.tall / 2, at.y + size.tall / 2] as const,
  }));
  for (const [i, slot] of layout.slots.entries()) {
    const b = boxes[i]!;
    expect(b.x[0]).toBeGreaterThanOrEqual(left);
    expect(b.x[1]).toBeLessThanOrEqual(right);
    expect(slot.at.z + slot.size.deep / 2).toBeLessThanOrEqual(SCENARIO_CASE.depth);
    expect(
      layout.floors.some((floor) => Math.abs(floor - b.y[0]) < 1e-6),
      slot.product.code,
    ).toBe(true);
    expect(b.y[1]).toBeLessThan(layout.top);
    for (const other of boxes.slice(i + 1)) {
      const apart =
        other.x[0] >= b.x[1] - 1e-6 ||
        other.x[1] <= b.x[0] + 1e-6 ||
        other.y[0] >= b.y[1] - 1e-6 ||
        other.y[1] <= b.y[0] + 1e-6;
      expect(apart, slot.product.code).toBe(true);
    }
  }
});
