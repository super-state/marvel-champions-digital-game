import { describe, expect, test } from "vitest";
import { SHELF_HEROES, SHELF_RELEASES } from "./hero-catalogue.js";
import {
  CASE_SPAN,
  matches,
  orderHeroes,
  shelfFrame,
  spotOf,
  type ShelfLook,
  type ShelfOrder,
} from "./hero-shelf-layout.js";

/** The Core Set's five, lit as the table deals them today. */
const CORE = new Set(["01001a", "01010a", "01019a", "01029a", "01040a"]);
const inRelease = SHELF_RELEASES.flatMap((release) => SHELF_HEROES.filter((hero) => hero.release === release.id));
const ORDER: ShelfOrder = {
  sort: "release",
  search: "",
  playableOnly: false,
  lit: CORE,
  favourites: new Set(),
  lastPlayed: new Map(),
};
const codes = (order: Partial<ShelfOrder>) => orderHeroes({ ...ORDER, ...order }).map((hero) => hero.code);

describe("the order the heroes stand in", () => {
  test("release order: every hero once, the Core Set first, the playable ones among the rest", () => {
    expect(codes({})).toEqual(inRelease.map((hero) => hero.code));
    expect(codes({}).slice(0, 5)).toEqual([...CORE]);
  });

  test("A–Z by name, every hero once", () => {
    const names = orderHeroes({ ...ORDER, sort: "name" }).map((hero) => hero.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toHaveLength(SHELF_HEROES.length);
  });

  test("favourites first, then the rest in release order", () => {
    const favourites = new Set(["01029a", inRelease[40]!.code]);
    const order = codes({ sort: "favourites", favourites });
    expect(order.slice(0, 2)).toEqual(["01029a", inRelease[40]!.code]);
    expect(order.slice(2)).toEqual(inRelease.map((h) => h.code).filter((code) => !favourites.has(code)));
  });

  test("last played first, newest first, then the never-played in release order", () => {
    const lastPlayed = new Map([
      ["01019a", 100],
      ["01040a", 300],
    ]);
    const order = codes({ sort: "played", lastPlayed });
    expect(order.slice(0, 3)).toEqual(["01040a", "01019a", "01001a"]);
    expect(order).toHaveLength(SHELF_HEROES.length);
  });

  test("the playable cut and the search", () => {
    expect(codes({ playableOnly: true })).toEqual([...CORE]);
    expect(orderHeroes({ ...ORDER, search: "spiderman" }).every((hero) => matches(hero, "spider-man"))).toBe(true);
    expect(codes({ search: "carol" })).toEqual(["01010a"]);
    expect(codes({ search: "peter" })).toContain("01001a");
    expect(codes({ search: "zzzz" })).toEqual([]);
  });
});

describe.each<ShelfLook>(["faces", "spines"])("the bookcase, %s", (look) => {
  const frame = shelfFrame(0, look);
  const spots = SHELF_HEROES.map((_, i) => spotOf(frame, i, SHELF_HEROES.length, 0));
  const { size } = frame;

  test("has room for every hero, each place inside it, none overlapping another", () => {
    const left = CASE_SPAN.z + CASE_SPAN.width / 2;
    const right = CASE_SPAN.z - CASE_SPAN.width / 2;
    const bounds = spots.map((at) => ({
      z: [at.z - size.across / 2, at.z + size.across / 2] as const,
      y: [at.y - size.tall / 2, at.y + size.tall / 2] as const,
    }));
    for (const [i, at] of spots.entries()) {
      const b = bounds[i]!;
      expect(b.z[1]).toBeLessThanOrEqual(left);
      expect(b.z[0]).toBeGreaterThanOrEqual(right);
      expect(at.x + size.deep / 2).toBeLessThanOrEqual(CASE_SPAN.depth);
      expect(b.y[0]).toBeGreaterThanOrEqual(frame.bottom);
      expect(b.y[1]).toBeLessThan(frame.top);
      for (const other of bounds.slice(i + 1)) {
        const apart =
          other.z[0] >= b.z[1] - 1e-6 ||
          other.z[1] <= b.z[0] + 1e-6 ||
          other.y[0] >= b.y[1] - 1e-6 ||
          other.y[1] <= b.y[0] + 1e-6;
        expect(apart, String(i)).toBe(true);
      }
    }
  });

  test("stands eight boxes (or stacks) to a shelf", () => {
    expect(frame.across).toBe(8);
  });

  test("reads left to right, then top to bottom, a stack from its top down", () => {
    expect(spots[frame.stack]!.z).toBeLessThan(spots[0]!.z);
    if (frame.stack > 1) expect(spots[1]!.y).toBeLessThan(spots[0]!.y);
    expect(spots[spots.length - 1]!.y).toBeLessThan(spots[0]!.y);
  });
});
