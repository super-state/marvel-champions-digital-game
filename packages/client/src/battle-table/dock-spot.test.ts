import { describe, expect, it } from "vitest";
import { besideSpot, dockSpot, type DockSpotInput } from "./dock-spot";

const base: DockSpotInput = {
  field: { width: 1086, height: 900 },
  stage: { left: 0, top: 0, width: 1086 },
  bar: { width: 440, height: 64 },
  hand: { resting: 700, hovered: null },
  asking: true,
  aboutHand: true,
  handOverCorner: false,
  corners: { left: 80, right: 200 },
};

describe("dockSpot", () => {
  it("centres a question answered from the hand just above the hand", () => {
    expect(dockSpot(base)).toEqual({ left: 323, top: 700 - 64 - 12, ducked: false });
  });

  it("runs any other question or news along the bottom, over the hand, level with the corners", () => {
    expect(dockSpot({ ...base, aboutHand: false }).top).toBe(900 - 64 - 16);
    expect(dockSpot({ ...base, asking: false, aboutHand: false }).top).toBe(900 - 64 - 16);
  });

  it("sits over the top of the hand where the bottom strip would run into a corner", () => {
    const narrow = {
      ...base,
      aboutHand: false,
      field: { width: 734, height: 900 },
      stage: { ...base.stage, width: 734 },
    };
    expect(dockSpot(narrow).top).toBe(710);
    expect(dockSpot({ ...base, aboutHand: false, handOverCorner: true }).top).toBe(710);
  });

  it("follows a scrolled stage and keeps the bar on the playfield", () => {
    const spot = dockSpot({ ...base, stage: { left: 0, top: -40, width: 1086 }, hand: { resting: 60, hovered: null } });
    expect(spot.top).toBe(8);
    expect(dockSpot({ ...base, bar: { width: 1200, height: 64 } }).left).toBe(8);
  });

  it("ducks behind a hand card lifted over it", () => {
    expect(dockSpot({ ...base, aboutHand: false, hand: { resting: 700, hovered: 690 } }).ducked).toBe(true);
    expect(dockSpot({ ...base, hand: { resting: 700, hovered: 690 } }).ducked).toBe(false);
  });
});

describe("besideSpot", () => {
  const field = { width: 1000, height: 800 };
  const size = { width: 300, height: 420 };
  it("shows the card on the right of the one hovered, level with its middle", () => {
    expect(besideSpot({ left: 100, right: 200, top: 300, bottom: 440 }, size, field)).toEqual({ left: 228, top: 160 });
  });
  it("goes to the left when the right has no room", () => {
    expect(besideSpot({ left: 750, right: 850, top: 300, bottom: 440 }, size, field).left).toBe(422);
  });
  it("stays on the playfield near its edges", () => {
    expect(besideSpot({ left: 100, right: 200, top: 0, bottom: 100 }, size, field).top).toBe(8);
    expect(besideSpot({ left: 100, right: 200, top: 700, bottom: 790 }, size, field).top).toBe(800 - 420 - 8);
  });
});
