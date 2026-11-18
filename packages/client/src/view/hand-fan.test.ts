import { describe, expect, test } from "vitest";
import { handFan } from "./hand-fan.js";
import { handRow } from "./hand-row.js";
import type { Rect } from "./layout.js";

const table = { x: 10, y: 575, width: 1260, height: 168 };
const contains = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x - 0.001 && y >= rect.y - 0.001 && x <= rect.x + rect.width + 0.001 && y <= rect.y + rect.height + 0.001;

describe("long-table hand", () => {
  test("cards splay outward, with the middle higher and every card center individually reachable", () => {
    const row = handRow(table, { handCount: 5, tableTiles: 0, fan: false, piles: "flank" });
    const cards = handFan(row.slots, row.cardArea)!;
    expect(cards.map(({ angle }) => angle)).toEqual([-10, -5, 0, 5, 10]);
    expect(cards[0]!.face.y).toBeGreaterThan(cards[2]!.face.y);
    expect(cards[0]!.face.y).toBeCloseTo(cards[4]!.face.y);
    for (const card of cards) {
      const x = card.face.x + card.face.width / 2;
      const y = card.face.y + card.face.height / 2;
      expect(cards.filter(({ target }) => contains(target, x, y))).toEqual([card]);
    }
  });

  test("the stationary touch area includes every tilted corner and the whole raised face, including sideways cards", () => {
    const row = handRow(table, {
      handCount: 3,
      tableTiles: 0,
      fan: false,
      piles: "flank",
      landscape: [true, false, true],
    });
    const cards = handFan(row.slots, row.cardArea)!;
    for (const [index, { face, angle, target, lifted }] of cards.entries()) {
      expect(face.width / face.height).toBeCloseTo(row.slots[index]!.width / row.slots[index]!.height);
      const a = (angle * Math.PI) / 180;
      const cx = face.x + face.width / 2;
      const cy = face.y + face.height / 2;
      for (const dx of [-face.width / 2, face.width / 2]) {
        for (const dy of [-face.height / 2, face.height / 2]) {
          const x = cx + dx * Math.cos(a) - dy * Math.sin(a);
          const y = cy + dx * Math.sin(a) + dy * Math.cos(a);
          expect(contains(target, x, y)).toBe(true);
          expect(contains(row.cardArea, x, y)).toBe(true);
        }
      }
      expect(contains(target, lifted.x, lifted.y)).toBe(true);
      expect(contains(target, lifted.x + lifted.width, lifted.y + lifted.height)).toBe(true);
    }
  });

  test("tiny and densely overlapped slots use their ordinary fitted row", () => {
    expect(handFan([], table)).toBeNull();
    expect(handFan([{ ...table, width: 38 }], table)).toBeNull();
    expect(
      handFan(
        [
          { ...table, x: 20, width: 75 },
          { ...table, x: 52, width: 75 },
        ],
        table,
      ),
    ).toBeNull();
  });
});
