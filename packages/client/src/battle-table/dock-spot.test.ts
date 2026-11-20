import { describe, expect, it } from "vitest";
import { besideSpot, dockSpot, type DockSpotInput } from "./dock-spot";

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
});

describe("besideSpot", () => {
  const field = { width: 1000, height: 800 };
  const size = { width: 300, height: 420 };
  it("shows the card on the right of the one hovered, level with its middle", () => {
    expect(besideSpot({ left: 100, right: 200, top: 300, bottom: 440 }, size, field)).toEqual({ left: 244, top: 160 });
  });
  it("goes to the left when the right has no room", () => {
    expect(besideSpot({ left: 750, right: 850, top: 300, bottom: 440 }, size, field).left).toBe(406);
  });
  it("keeps clear of a card pinned at the side", () => {
    const right = besideSpot({ left: 750, right: 850, top: 300, bottom: 440 }, size, { ...field, width: 700 });
    expect(right.left).toBe(392);
    const left = besideSpot({ left: 20, right: 120, top: 300, bottom: 440 }, size, { ...field, left: 340, width: 660 });
    expect(left.left).toBe(348);
  });
  it("stays on the playfield near its edges", () => {
    expect(besideSpot({ left: 100, right: 200, top: 0, bottom: 100 }, size, field).top).toBe(8);
    expect(besideSpot({ left: 100, right: 200, top: 700, bottom: 790 }, size, field).top).toBe(800 - 420 - 8);
  });
});
