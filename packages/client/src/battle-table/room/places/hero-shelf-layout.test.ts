import { describe, expect, test } from "vitest";
import { SHELF_HEROES, SHELF_RELEASES } from "./hero-catalogue.js";
import { CASE_SPAN, layoutShelf, type ShelfLook } from "./hero-shelf-layout.js";

/** The Core Set's five, lit as the table deals them today. */
const CORE = new Set(["01001a", "01010a", "01019a", "01029a", "01040a"]);
const PLACE = { back: 0, bottom: 0 };
const inOrder = SHELF_RELEASES.flatMap((release) => SHELF_HEROES.filter((hero) => hero.release === release.id));

describe.each<ShelfLook>(["faces", "spines"])("the hero shelf, %s", (look) => {
  const layout = layoutShelf(CORE, PLACE, look);

  test("stands every hero once: the lit ones first, then the rest in release order", () => {
    const expected = [...inOrder.filter((hero) => CORE.has(hero.code)), ...inOrder.filter((h) => !CORE.has(h.code))];
    expect(layout.slots.map((slot) => slot.hero.code)).toEqual(expected.map((hero) => hero.code));
  });

  test("turns every box the same way, and puts the lit heroes first, on the top shelf", () => {
    const pose = look === "faces" ? "face" : "flat";
    for (const slot of layout.slots) {
      expect(slot.pose, slot.hero.name).toBe(pose);
      expect(slot.lit).toBe(CORE.has(slot.hero.code));
      if (slot.lit) expect(slot.at.y - slot.size.tall / 2, slot.hero.name).toBeGreaterThanOrEqual(layout.floors[0]!);
    }
  });

  test("keeps every box inside the bookcase, none overlapping another", () => {
    const left = CASE_SPAN.z + CASE_SPAN.width / 2;
    const right = CASE_SPAN.z - CASE_SPAN.width / 2;
    const bounds = layout.slots.map(({ at, size }) => ({
      z: [at.z - size.across / 2, at.z + size.across / 2] as const,
      y: [at.y - size.tall / 2, at.y + size.tall / 2] as const,
    }));
    for (const [i, slot] of layout.slots.entries()) {
      const b = bounds[i]!;
      expect(b.z[1]).toBeLessThanOrEqual(left);
      expect(b.z[0]).toBeGreaterThanOrEqual(right);
      expect(slot.at.x + slot.size.deep / 2).toBeLessThanOrEqual(CASE_SPAN.depth);
      expect(b.y[1]).toBeLessThan(layout.top);
      for (const other of bounds.slice(i + 1)) {
        const apart =
          other.z[0] >= b.z[1] - 1e-6 ||
          other.z[1] <= b.z[0] + 1e-6 ||
          other.y[0] >= b.y[1] - 1e-6 ||
          other.y[1] <= b.y[0] + 1e-6;
        expect(apart, slot.hero.name).toBe(true);
      }
    }
  });
});

test("faces: the lit heroes stand on display, on a shelf of their own", () => {
  const layout = layoutShelf(CORE, PLACE, "faces");
  for (const slot of layout.slots) {
    expect(slot.onDisplay).toBe(slot.lit);
    expect(slot.at.y - slot.size.tall / 2 >= layout.floors[0]!).toBe(slot.lit);
  }
});
