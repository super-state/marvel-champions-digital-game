import * as THREE from "three";
import { describe, expect, test } from "vitest";
import { fitBoard, fitToBox, type Project, type ScreenRect, type TableBox } from "./board-fit.js";

/** The battle table's camera: fixed above the near edge, looking down at the middle of the table. */
function tableCamera(width: number, height: number): Project {
  const camera = new THREE.PerspectiveCamera(36, width / height, 0.05, 120);
  camera.position.set(0, 10.8, 8.3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const point = new THREE.Vector3();
  return (x, y, z) => {
    point.set(x, y, z).project(camera);
    return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
  };
}

const W = 1084;
const H = 900;
const rect: ScreenRect = { left: 12, right: W - 12, top: 50, bottom: 554 };
const project = tableCamera(W, H);

function corners(box: TableBox, fit: ReturnType<typeof fitBoard>, height = 0.06) {
  return [box.x0, box.x1].flatMap((x) =>
    [box.z0, box.z1].map((z) => {
      const p = fitToBox(fit, { x, y: height, z });
      return project(p.x, p.y, p.z);
    }),
  );
}

function inside(points: { x: number; y: number }[], r: ScreenRect) {
  return points.every((p) => p.x >= r.left - 1 && p.x <= r.right + 1 && p.y >= r.top - 1 && p.y <= r.bottom + 1);
}

describe("fitBoard", () => {
  test("a quiet board grows to fill the room above the hand, and no further", () => {
    const box = { x0: -2, x1: 2, z0: -2, z1: 1 };
    const fit = fitBoard(box, project, rect);
    expect(fit.scale).toBeGreaterThan(1);
    expect(inside(corners(box, fit), rect)).toBe(true);
    // Any bigger and some corner leaves the room.
    expect(inside(corners(box, { ...fit, scale: fit.scale * 1.03 }), rect)).toBe(false);
  });

  test("a board too tall for the screen (side schemes stacking up) shrinks to fit instead of scrolling", () => {
    const tall = { x0: -4, x1: 4, z0: -14, z1: 2 };
    const fit = fitBoard(tall, project, rect);
    expect(fit.scale).toBeLessThan(1);
    expect(inside(corners(tall, fit), rect)).toBe(true);
  });

  test("the board sits under the camera with as much room above it as below", () => {
    const box = { x0: -1, x1: 5, z0: -3, z1: 1 };
    const fit = fitBoard(box, project, rect);
    const [farLeft, nearLeft] = corners(box, fit);
    expect(farLeft!.y - rect.top).toBeCloseTo(rect.bottom - nearLeft!.y, 0);
    // Centred across: the box's middle is under the camera.
    expect(fitToBox(fit, { x: 2, y: 0, z: 0 }).x).toBeCloseTo(0, 6);
  });

  test("never grows past the cap, and past the floor it stops shrinking", () => {
    const tiny = { x0: -0.2, x1: 0.2, z0: -0.2, z1: 0.2 };
    expect(fitBoard(tiny, project, rect, { maxScale: 1.4 }).scale).toBe(1.4);
    const huge = { x0: -60, x1: 60, z0: -60, z1: 4 };
    expect(fitBoard(huge, project, rect, { minScale: 0.5 }).scale).toBe(0.5);
  });

  test("fitted card by card, a wide far row and a narrow near one grow past where the box's corners would stop them", () => {
    // Piles out at the sides of the far row, the hero's cards in the middle of the near one: the box round them has
    // near corners where no card stands (Adam, 2026-11-26: room unused above the hand).
    const parts = [
      { x0: -5, x1: -4, z0: -3, z1: -2 },
      { x0: 4, x1: 5, z0: -3, z1: -2 },
      { x0: -1, x1: 1, z0: 0, z1: 1.5 },
    ];
    const box = { x0: -5, x1: 5, z0: -3, z1: 1.5 };
    const byBox = fitBoard(box, project, rect);
    const byCards = fitBoard(box, project, rect, {}, parts);
    expect(byCards.scale).toBeGreaterThan(byBox.scale * 1.05);
    expect(parts.every((part) => inside(corners(part, byCards), rect))).toBe(true);
    // Any bigger and some card leaves the room.
    const bigger = { ...byCards, scale: byCards.scale * 1.03 };
    expect(parts.every((part) => inside(corners(part, bigger), rect))).toBe(false);
  });

  test("a phone's narrow table is fitted across", () => {
    const phone = tableCamera(375, 440);
    const narrow: ScreenRect = { left: 12, right: 363, top: 44, bottom: 250 };
    const box = { x0: -5, x1: 5, z0: -3, z1: 2 };
    const fit = fitBoard(box, phone, narrow);
    const points = [box.x0, box.x1].flatMap((x) =>
      [box.z0, box.z1].map((z) => {
        const p = fitToBox(fit, { x, y: 0.06, z });
        return phone(p.x, p.y, p.z);
      }),
    );
    expect(inside(points, narrow)).toBe(true);
    expect(Math.min(...points.map((p) => p.x))).toBeLessThan(narrow.left + 4);
  });
});
