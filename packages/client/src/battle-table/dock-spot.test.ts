import { describe, expect, it } from "vitest";
import { besideSpot, dockSpot, revealAside, type DockSpotInput } from "./dock-spot";

const base: DockSpotInput = {
  field: { width: 1086, height: 900 },
  stage: { left: 0, top: 0, width: 1086 },
  bar: { width: 440, height: 64 },
  handTop: 700,
};

describe("dockSpot", () => {
  it("centres the bar across the table, just above the hand", () => {
    expect(dockSpot(base)).toEqual({ left: 323, top: 700 - 64 - 12 });
  });

  it("follows a scrolled stage and keeps the bar on the playfield", () => {
    expect(dockSpot({ ...base, stage: { left: 0, top: -40, width: 1086 }, handTop: 60 }).top).toBe(8);
    expect(dockSpot({ ...base, bar: { width: 1200, height: 64 } }).left).toBe(8);
  });

  it("drops below a card standing over it, never into the hand", () => {
    expect(dockSpot({ ...base, below: 612 }).top).toBe(630);
    expect(dockSpot({ ...base, below: 680 }).top).toBe(700 - 64);
    expect(dockSpot({ ...base, below: 400 }).top).toBe(700 - 64 - 12);
  });
});

describe("besideSpot", () => {
  const field = { width: 1000, height: 800 };
  const size = { width: 300, height: 420 };
  it("shows the card on the right of the one hovered, level with its middle", () => {
    expect(besideSpot({ left: 100, right: 200, top: 300, bottom: 440 }, size, field)).toEqual({ left: 264, top: 160 });
  });
  it("goes to the left when the right has no room", () => {
    expect(besideSpot({ left: 750, right: 850, top: 300, bottom: 440 }, size, field).left).toBe(386);
  });
  it("keeps clear of a card pinned at the side", () => {
    const right = besideSpot({ left: 750, right: 850, top: 300, bottom: 440 }, size, { ...field, width: 700 });
    expect(right.left).toBe(386);
    const left = besideSpot({ left: 20, right: 120, top: 300, bottom: 440 }, size, { ...field, left: 340, width: 660 });
    expect(left.left).toBe(348);
  });
  it("can be asked for the left (an attachment, beside its tab), and still takes the right when the left has no room", () => {
    expect(besideSpot({ left: 450, right: 550, top: 300, bottom: 440 }, size, field, "left").left).toBe(86);
    expect(besideSpot({ left: 100, right: 200, top: 300, bottom: 440 }, size, field, "left").left).toBe(264);
  });
  it("keeps clear of the turn bar: up on the same side, else the other side", () => {
    const hero = { left: 300, right: 400, top: 400, bottom: 540 };
    const bar = { left: 150, right: 900, top: 560, bottom: 620 };
    // Level with the hero it would reach down to 680, over the bar: it slides up just clear of it.
    expect(besideSpot(hero, size, field, "right", [bar])).toEqual({ left: 464, top: 560 - 12 - 420 });
    // No room above or below on the right (a short bar spanning the whole height there): it goes to the left.
    const tall = { left: 450, right: 900, top: 0, bottom: 800 };
    expect(besideSpot(hero, size, field, "right", [tall])).toEqual({ left: 8, top: 260 });
    // Nothing in the way: unchanged.
    expect(besideSpot(hero, size, field, "right", [{ left: 0, right: 50, top: 0, bottom: 50 }])).toEqual({
      left: 464,
      top: 260,
    });
  });
  it("stays on the playfield near its edges", () => {
    expect(besideSpot({ left: 100, right: 200, top: 0, bottom: 100 }, size, field).top).toBe(8);
    expect(besideSpot({ left: 100, right: 200, top: 700, bottom: 790 }, size, field).top).toBe(800 - 420 - 8);
  });
});

describe("revealAside", () => {
  // A revealed card 420 wide held up in the middle of a 1900-wide table.
  const card = { left: 740, right: 1160, top: 180, bottom: 770 };
  const box = (left: number, right: number, top = 560, bottom = 780) => ({ left, right, top, bottom });

  test("stays put when it covers none of the cards to pick", () => {
    expect(revealAside(card, [box(1300, 1450)], 1900)).toEqual({ x: 950, y: 475, scale: 1 });
    // Picks above or below it can't be covered where it is.
    expect(revealAside(card, [box(900, 1000, 900, 1100)], 1900)).toEqual({ x: 950, y: 475, scale: 1 });
  });

  test("slides up, halfway between just clear of the picks and half off the top (Adam, 2026-11-26)", () => {
    // Web-Shooter under it (Android Efficiency's spend): just clear would be 249, half off 0.
    expect(revealAside(card, [box(960, 1060), box(1190, 1350)], 1900)).toEqual({ x: 950, y: 124, scale: 1 });
    // A pick lower down: just clear would be 389.
    expect(revealAside(card, [box(700, 800, 700, 900)], 1900)).toEqual({ x: 950, y: 194, scale: 1 });
  });

  test("where a lift would still cover a pick high on the table, it slides sideways instead", () => {
    // Web-Shooter and Helicarrier right of the middle, high up: it slides left until its right edge clears Web-Shooter.
    expect(revealAside(card, [box(960, 1060, 200, 400), box(1190, 1350, 200, 400)], 1900)).toEqual({
      x: 734,
      y: 475,
      scale: 1,
    });
    // Picks left of the middle: it slides right.
    expect(revealAside(card, [box(700, 800, 200, 400)], 1900)).toEqual({ x: 1026, y: 475, scale: 1 });
  });

  test("with no gap wide enough it takes the widest and shrinks to fit, never below half size", () => {
    const aside = revealAside(card, [box(200, 900, 100, 400), box(1200, 1800, 100, 400)], 1900);
    expect(aside.x).toBe(1050);
    expect(aside.scale).toBeCloseTo((1184 - 916) / 420);
    expect(revealAside(card, [box(16, 1884, 100, 400)], 1900).scale).toBe(0.5);
  });
});
