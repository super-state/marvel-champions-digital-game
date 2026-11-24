import { describe, expect, test } from "vitest";
import { PLATE_GAP, spreadPlates, type Plate } from "./plate-spread.js";

/** A plate as `placeLabels` measures it: its middle, top, size and its card's edges. */
const plate = (id: string, x: number, top: number, cardLeft: number, cardRight: number, width = 33, height = 15) =>
  ({ id, x, top, width, height, cardLeft, cardRight }) satisfies Plate;

/** Every plate's box once moved, checked pairwise for overlaps and for each middle standing over its own card. */
function check(plates: readonly Plate[], shifts: ReturnType<typeof spreadPlates>) {
  const boxes = plates.map((p) => {
    const { dx, dy } = shifts.get(p.id) ?? { dx: 0, dy: 0 };
    return {
      p,
      left: p.x + dx - p.width / 2,
      right: p.x + dx + p.width / 2,
      top: p.top + dy,
      bottom: p.top + dy + p.height,
    };
  });
  const overlaps: string[] = [];
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b) => {
      if (
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0
      )
        overlaps.push(`${a.p.id}/${b.p.id}`);
    }),
  );
  const strays = boxes
    .filter(({ p, left, right }) => {
      const middle = (left + right) / 2;
      return p.pinned ? Math.abs(middle - p.x) >= 1 : middle < p.cardLeft - 0.5 || middle > p.cardRight + 0.5;
    })
    .map(({ p }) => p.id);
  return { overlaps, strays };
}

// Klaw's crowded table (`?scene=klawcrowd&seed=7`), measured in the page: Klaw, the near row of minions, the far row,
// and the encounter piles' counts at the end of the row.
const klawSe: Plate[] = [
  plate("klaw", 188, 144, 157, 218),
  plate("m1", 227, 145, 220, 234),
  plate("m2", 245, 145, 237, 252),
  plate("m3", 262, 145, 255, 270),
  plate("far1", 232, 106, 221, 243),
  plate("far2", 259, 106, 248, 270),
  { ...plate("discard", 287, 131, 273, 330, 43, 22), keepsLine: true },
  { ...plate("deck", 293, 175, 279, 330, 53, 22), keepsLine: true },
];

describe("spreadPlates", () => {
  test("plates already clear of each other stay where their cards put them (a tablet, a desktop)", () => {
    // Klaw's crowded table at 1024x768.
    const plates = [
      plate("klaw", 512, 291, 470, 555, 42, 19),
      plate("m1", 618, 306, 598, 640, 42, 19),
      plate("m2", 677, 306, 657, 699, 42, 19),
      plate("m3", 736, 306, 716, 758, 42, 19),
      plate("far1", 641, 187, 620, 663, 42, 19),
      plate("far2", 718, 187, 697, 740, 42, 19),
    ];
    expect(spreadPlates(plates).size).toBe(0);
  });

  test("plates that just touch are eased apart sideways, each still under its card", () => {
    // The near row on a portrait tablet: three minions whose badges overlap by a few pixels.
    const plates = [
      plate("m1", 467, 365, 452, 482, 42, 19),
      plate("m2", 504, 365, 489, 519, 42, 19),
      plate("m3", 541, 365, 526, 556, 42, 19),
    ];
    const shifts = spreadPlates(plates);
    expect(check(plates, shifts)).toEqual({ overlaps: [], strays: [] });
    expect([...shifts.values()].every(({ dy }) => dy === 0)).toBe(true);
    // The middle one is boxed in by both neighbours, so it stays; the outer two make way.
    expect(shifts.has("m2")).toBe(false);
    expect(shifts.get("m1")!.dx).toBeLessThan(0);
    expect(shifts.get("m3")!.dx).toBeGreaterThan(0);
  });

  test("where the cards are narrower than their badges, a badge steps down onto a second line", () => {
    // Klaw's crowded table on a 375x667 phone: three minions a few pixels wide each, the pile counts beside them.
    const shifts = spreadPlates(klawSe);
    expect(check(klawSe, shifts)).toEqual({ overlaps: [], strays: [] });
    const lines = new Set(klawSe.map((p) => shifts.get(p.id)?.dy ?? 0));
    expect([...lines].sort((a, b) => a - b)).toEqual([0, 15 + PLATE_GAP]);
    // The pile counts never leave their line.
    expect(shifts.get("discard")?.dy ?? 0).toBe(0);
    expect(shifts.get("deck")?.dy ?? 0).toBe(0);
  });

  test("a badge stepping down clears a taller plate on the row above it (a pile's count)", () => {
    const plates = [
      plate("m1", 100, 100, 92, 108),
      plate("m2", 117, 100, 109, 125),
      { ...plate("pile", 150, 103, 140, 160, 40, 22), keepsLine: true },
    ];
    const shifts = spreadPlates(plates);
    expect(check(plates, shifts)).toEqual({ overlaps: [], strays: [] });
    expect(shifts.get("m2")!.dy).toBe(103 + 22 + PLATE_GAP - 100);
  });

  test("a badge steps up instead when the space below it is taken", () => {
    const plates = [plate("m1", 100, 100, 92, 108), plate("m2", 116, 100, 108, 124)];
    const below = { left: 0, right: 300, top: 118, bottom: 200 };
    const shifts = spreadPlates(plates, [below]);
    expect(check(plates, shifts)).toEqual({ overlaps: [], strays: [] });
    expect(shifts.get("m2")!.dy).toBeLessThan(0);
  });

  test("a pinned plate stays put and its neighbour makes way", () => {
    // Rhino's crowded table on a phone: the hero's health beside the player's deck count.
    const plates = [
      { ...plate("deck", 77, 226, 77, 77, 54, 22), keepsLine: true, pinned: true },
      plate("hero", 112, 228, 92, 132, 32, 15),
    ];
    const shifts = spreadPlates(plates);
    expect(check(plates, shifts)).toEqual({ overlaps: [], strays: [] });
    expect(shifts.has("deck")).toBe(false);
    expect(shifts.get("hero")).toEqual({ dx: expect.closeTo(11, 0), dy: 0 });
  });

  test("the same plates give the same answer, whatever order they come in", () => {
    const forward = spreadPlates(klawSe);
    const backward = spreadPlates([...klawSe].reverse());
    expect(backward).toEqual(forward);
  });

  test("a badge slides sideways rather than stepping down when only it can make way", () => {
    // a's card is too narrow to move it; b's is wide enough to slide clear.
    const plates = [plate("a", 100, 100, 98, 102), plate("b", 125, 100, 115, 160)];
    const shifts = spreadPlates(plates);
    expect(check(plates, shifts)).toEqual({ overlaps: [], strays: [] });
    expect([...shifts.values()].every(({ dy }) => dy === 0)).toBe(true);
    expect(shifts.get("b")!.dx).toBeGreaterThan(0);
  });

  test("a badge exactly a gap clear on its line, in fractions of a pixel, stays on that line", () => {
    // Fractional positions from the page, where two badges on the second line end up exactly PLATE_GAP apart.
    const plates = [
      plate("m0", 152.29935371889704, 145, 128.799, 175.799, 29),
      plate("m1", 109.82108206945522, 145, 103.821, 115.821, 35),
      plate("m2", 116.94050142399058, 145, 105.441, 128.441, 31),
      plate("m3", 132.29493065378392, 145, 120.295, 144.295, 31),
    ];
    const shifts = spreadPlates(plates);
    expect(check(plates, shifts)).toEqual({ overlaps: [], strays: [] });
    expect(Math.max(...[...shifts.values()].map(({ dy }) => dy))).toBe(15 + PLATE_GAP);
  });

  test("a pile's count that starts outside its pile's edges doesn't push clear badges off the row", () => {
    const plates = [
      plate("m1", 100, 100, 90, 110),
      plate("m2", 200, 100, 190, 210),
      { ...plate("pile", 330, 100, 300, 320, 40, 22), keepsLine: true },
    ];
    expect(spreadPlates(plates).size).toBe(0);
  });

  test("two pinned counts that overlap each other stay put, and leave a badge clear of them alone", () => {
    const plates = [
      { ...plate("deck", 60, 100, 60, 60, 54, 22), keepsLine: true, pinned: true },
      { ...plate("discard", 100, 100, 100, 100, 54, 22), keepsLine: true, pinned: true },
      plate("hero", 250, 100, 230, 270),
    ];
    expect(spreadPlates(plates).size).toBe(0);
  });

  test("a badge stepping off its row keeps clear of the next row's badges", () => {
    // Four badges a far row can't hold, stepping down towards the near row's badges right below.
    const plates = [
      plate("f0", 229.65, 106, 222.6, 236.69),
      plate("f1", 253.87, 106, 249.21, 258.52),
      plate("f2", 208.9, 106, 203.18, 214.61),
      plate("f3", 256.72, 106, 249.61, 263.84),
      plate("n0", 213.74, 145, 205, 222),
      plate("n1", 200.84, 145, 192, 209),
      plate("n2", 210.11, 145, 203, 217),
      plate("n3", 226.77, 145, 219, 234),
    ];
    const shifts = spreadPlates(plates);
    expect(check(plates, shifts).overlaps).toEqual([]);
  });

  test("a badge clear of everything in a crowded row stays where it is", () => {
    const row = klawSe.filter((p) => p.top === 145 || p.keepsLine);
    const lone = plate("lone", 40, 145, 25, 55);
    const shifts = spreadPlates([...row, lone]);
    expect(shifts.has("lone")).toBe(false);
    expect(check([...row, lone], shifts)).toEqual({ overlaps: [], strays: [] });
  });
});
