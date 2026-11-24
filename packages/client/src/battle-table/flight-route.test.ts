import * as THREE from "three";
import { describe, expect, test } from "vitest";

import { type CardRect, type FlightPose, cardsCross, flightPose, routeFlight } from "./flight-route.js";

/** A card's half size before its scale: 1 wide, 1.407 tall. */
const HALF_WIDTH = 0.5;
const HALF_HEIGHT = 1.407 / 2;
const FACING = -0.916;
const FLAT = -Math.PI / 2;

/** Measured in the `shadow` scene (Spider-Man vs Rhino, 1600 by 1000): Shadow of the Past standing aside by Rhino. */
const shadow: CardRect = {
  position: new THREE.Vector3(1.834, 1.278, -2.092),
  pitch: FACING,
  roll: 0,
  scale: 1.35,
  halfWidth: HALF_WIDTH,
  halfHeight: HALF_HEIGHT,
};
/** Vulture held up to be read, and his place in the row behind Shadow of the Past. */
const from: FlightPose = { position: new THREE.Vector3(0, 1.75, -0.145), pitch: FACING, roll: 0, scale: 2.56 };
const to: FlightPose = { position: new THREE.Vector3(2.397, 0.053, -3.558), pitch: FLAT, roll: 0, scale: 1.546 };

/** The landing ("place") the table gives him: straight down to his place by just over half way. */
function place(start: FlightPose, end: FlightPose) {
  return (progress: number): FlightPose => {
    const t = Math.min(1, progress / 0.54) ** 2;
    return {
      position: new THREE.Vector3().lerpVectors(start.position, end.position, t),
      pitch: THREE.MathUtils.lerp(start.pitch, end.pitch, t),
      roll: THREE.MathUtils.lerp(start.roll, end.roll, t),
      scale: THREE.MathUtils.lerp(start.scale, end.scale, t),
    };
  };
}

function clashesAlong(route: ReturnType<typeof routeFlight>, path: (p: number) => FlightPose, end: FlightPose) {
  const hits: number[] = [];
  for (let i = 8; i <= 100; i++) {
    const pose = flightPose(route, path, end, i / 100);
    if (cardsCross({ ...pose, halfWidth: HALF_WIDTH, halfHeight: HALF_HEIGHT }, shadow)) hits.push(i);
  }
  return hits;
}

describe("a card flying to the table round the cards held up in the air", () => {
  test("Vulture's straight landing went through Shadow of the Past", () => {
    expect(clashesAlong({ kind: "straight" }, place(from, to), to).length).toBeGreaterThan(0);
  });

  test("so he goes another way, clear of it the whole way, and still ends in his place", () => {
    const path = place(from, to);
    const route = routeFlight(path, to, HALF_WIDTH, HALF_HEIGHT, [shadow]);
    expect(route.kind).not.toBe("straight");
    expect(clashesAlong(route, path, to)).toEqual([]);
    const end = flightPose(route, path, to, 1);
    expect(end.position.distanceTo(to.position)).toBeLessThan(1e-6);
    expect(end.pitch).toBeCloseTo(FLAT);
    expect(end.scale).toBeCloseTo(to.scale);
  });

  test("a clear path, or nothing held up, keeps the usual flight", () => {
    const path = place(from, to);
    expect(routeFlight(path, to, HALF_WIDTH, HALF_HEIGHT, []).kind).toBe("straight");
    const farAway = { ...shadow, position: new THREE.Vector3(-6, 1.3, -2) };
    expect(routeFlight(path, to, HALF_WIDTH, HALF_HEIGHT, [farAway]).kind).toBe("straight");
  });

  test("a place that itself cuts through a held card keeps the usual flight", () => {
    const inside = { ...to, position: shadow.position.clone(), pitch: 0 };
    expect(routeFlight(place(from, inside), inside, HALF_WIDTH, HALF_HEIGHT, [shadow]).kind).toBe("straight");
  });
});

describe("two cards cutting through each other", () => {
  const flat: CardRect = {
    position: new THREE.Vector3(),
    pitch: FLAT,
    roll: 0,
    scale: 1,
    halfWidth: HALF_WIDTH,
    halfHeight: HALF_HEIGHT,
  };

  test("a card standing up through the middle of one lying flat", () => {
    expect(cardsCross(flat, { ...flat, pitch: 0 })).toBe(true);
  });

  test("not one lying above it, or standing up beside it", () => {
    expect(cardsCross(flat, { ...flat, position: new THREE.Vector3(0, 0.2, 0) })).toBe(false);
    expect(cardsCross(flat, { ...flat, pitch: 0, position: new THREE.Vector3(2, 0, 0) })).toBe(false);
  });
});
