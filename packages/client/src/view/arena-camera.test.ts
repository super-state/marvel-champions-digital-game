import { describe, expect, it } from "vitest";
import { arenaView } from "./arena-camera.js";

describe("the tabletop camera", () => {
  it.each([
    { x: 0, y: 50, width: 1440, height: 740 },
    { x: 0, y: 105, width: 390, height: 570 },
  ])("fits both ends of the physical table to its allocated band at $width px", (rect) => {
    const view = arenaView(rect);
    const back = view.project({ x: view.halfWidth, y: 0, z: -1 });
    const front = view.project({ x: view.halfWidth, y: 0, z: 1 });
    expect(back.y).toBeCloseTo(rect.y);
    expect(front.y).toBeCloseTo(rect.y + rect.height);
    expect(front.x).toBeCloseTo(rect.width - 6);
    expect(back.x).toBeLessThan(front.x);
    expect(view.project({ x: 0, y: -0.06, z: 1 }).y).toBeGreaterThan(front.y);
  });

  it("keeps both edges symmetric around the centerline", () => {
    const view = arenaView({ x: 15, y: 45, width: 1280, height: 630 });
    for (const z of [-1, 0, 1]) {
      const left = view.project({ x: -view.halfWidth, y: 0, z });
      const right = view.project({ x: view.halfWidth, y: 0, z });
      expect((left.x + right.x) / 2).toBeCloseTo(655);
      expect(left.y).toBeCloseTo(right.y);
    }
  });
});
