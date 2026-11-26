import { describe, expect, test } from "vitest";
import { SHELF_HEROES, SHELF_RELEASES } from "./hero-catalogue.js";
import { CASE_SPAN, layoutShelf, type ShelfLook } from "./hero-shelf-layout.js";

/** The Core Set's five, lit as the table deals them today. */
const CORE = new Set(["01001a", "01010a", "01019a", "01029a", "01040a"]);
const PLACE = { back: 0, bottom: 0 };

describe.each<ShelfLook>(["spines", "faces"])("the hero shelf, %s", (look) => {
  const layout = layoutShelf(CORE, PLACE, look);

  test("stands every hero once, in release order", () => {
    const inOrder = SHELF_RELEASES.flatMap((release) => SHELF_HEROES.filter((hero) => hero.release === release.id));
    expect(layout.slots.map((slot) => slot.hero.code)).toEqual(inOrder.map((hero) => hero.code));
  });

  test("keeps every box inside the bookcase, none overlapping another on its shelf", () => {
    const left = CASE_SPAN.z + CASE_SPAN.width / 2;
    const right = CASE_SPAN.z - CASE_SPAN.width / 2;
    for (const slot of layout.slots) {
      expect(slot.at.z + slot.size.across / 2).toBeLessThanOrEqual(left);
      expect(slot.at.z - slot.size.across / 2).toBeGreaterThanOrEqual(right);
      expect(slot.at.x + slot.size.deep / 2).toBeLessThanOrEqual(CASE_SPAN.depth);
      expect(slot.at.y + slot.size.tall / 2).toBeLessThan(layout.top);
    }
    for (const [i, slot] of layout.slots.entries()) {
      const next = layout.slots[i + 1];
      if (!next || next.at.y - next.size.tall / 2 !== slot.at.y - slot.size.tall / 2) continue;
      // Read from the reader's left (+z) to right: the next box starts after this one ends.
      expect(next.at.z + next.size.across / 2).toBeLessThan(slot.at.z - slot.size.across / 2);
    }
  });

  test("names each release under its boxes", () => {
    expect(layout.labels[0]).toMatchObject({ text: "Core Set" });
    expect(layout.labels.at(-1)).toMatchObject({ text: "Fear No Evil" });
  });
});

test("spines: the lit heroes face out, the rest stand side-on, each release kept to one shelf", () => {
  const layout = layoutShelf(CORE, PLACE, "spines");
  for (const slot of layout.slots) expect(slot.faceOut).toBe(CORE.has(slot.hero.code));
  const names = layout.labels.map((label) => label.text);
  expect(new Set(names).size).toBe(names.length);
  expect(layout.shelves).toBe(5);
});

test("faces: every box faces out", () => {
  expect(layoutShelf(CORE, PLACE, "faces").slots.every((slot) => slot.faceOut)).toBe(true);
});
