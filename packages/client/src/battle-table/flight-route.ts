import * as THREE from "three";

/**
 * A card flying to the table must never pass through a card held up in the air: a revealed card standing aside beside
 * the villain while it resolves, or one held up to be read. Vulture, brought in by Shadow of the Past, flew straight
 * from the middle of the table to his place and through Shadow of the Past hanging beside Rhino (Adam, 2026-11-24:
 * "it doesn't pass through any cards like that. So we just should have it go round, over or under").
 *
 * The flight's usual path is tried first; if it crosses a held card, then over it, then round either side, and last
 * down flat onto the table early and in underneath (the only way when its place lies under the held card).
 */

/** A card as a flat rectangle in the world: its centre, turn and size (`halfWidth`, `halfHeight` before `scale`). */
export interface CardRect {
  position: THREE.Vector3;
  pitch: number;
  roll: number;
  yaw?: number;
  scale: number;
  halfWidth: number;
  halfHeight: number;
}

/** Where a flying card is at a moment of its flight. */
export interface FlightPose {
  position: THREE.Vector3;
  pitch: number;
  roll: number;
  scale: number;
}

export type FlightRoute =
  | { kind: "straight" }
  /** The usual path, raised by `lift` and pushed sideways by `side`, most in the middle of the flight. */
  | { kind: "detour"; lift: number; side: THREE.Vector3 }
  /** Down flat onto the table first, then in low along it at `cruise`, under the held cards, to its place. */
  | { kind: "under"; cruise: number };

/** How far round a held card a detour goes, in card widths of the flying card at its place. */
const DETOURS = [0.9, 1.8, 2.7];
/** The share of the flight spent coming down flat, for a card going under. */
const UNDER_DOWN = 0.32;
/** The moments of the flight checked for a clash; the very start is left out (the card may begin overlapping one). */
const SAMPLES = 40;
const FROM = 0.08;

/**
 * The route for a flight whose usual path is `path` (its pose at each moment, 0 to 1), from `from` to `to`, for a card
 * of half-size `halfWidth` by `halfHeight`, clear of every card in `held`.
 */
export function routeFlight(
  path: (progress: number) => FlightPose,
  to: FlightPose,
  halfWidth: number,
  halfHeight: number,
  held: readonly CardRect[],
): FlightRoute {
  if (!held.length) return { kind: "straight" };
  // Its place itself cuts through a held card (a card played beside the hero while a revealed card is held up over
  // it): no way round reaches it, and the held card is drawn over it anyway.
  if (held.some((other) => cardsCross({ ...path(1), halfWidth, halfHeight }, other))) return { kind: "straight" };
  const clashes = (route: FlightRoute) => {
    let count = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const progress = FROM + ((1 - FROM) * i) / SAMPLES;
      const pose = flightPose(route, path, to, progress);
      const rect = { ...pose, halfWidth, halfHeight };
      if (held.some((other) => cardsCross(rect, other))) count++;
    }
    return count;
  };
  const candidates: FlightRoute[] = [{ kind: "straight" }];
  const start = path(0).position;
  const across = new THREE.Vector3(-(to.position.z - start.z), 0, to.position.x - start.x);
  if (across.lengthSq() < 1e-9) across.set(1, 0, 0);
  across.normalize();
  const width = Math.max(0.2, to.scale);
  for (const reach of DETOURS) {
    const top = Math.max(...held.map((rect) => highest(rect))) + 0.1;
    candidates.push({
      kind: "detour",
      lift: Math.max(0, top - path(0.5).position.y) + 0.25 * reach,
      side: new THREE.Vector3(),
    });
    candidates.push({ kind: "detour", lift: 0, side: across.clone().multiplyScalar(width * reach) });
    candidates.push({ kind: "detour", lift: 0, side: across.clone().multiplyScalar(-width * reach) });
  }
  const floor = Math.min(...held.map((rect) => lowest(rect)));
  candidates.push({ kind: "under", cruise: Math.max(to.position.y, Math.min(to.position.y + 0.14, floor - 0.12)) });
  let best = candidates[0]!;
  let least = Infinity;
  for (const route of candidates) {
    const count = clashes(route);
    if (count === 0) return route;
    if (count < least) {
      least = count;
      best = route;
    }
  }
  return best;
}

/** The card's pose at `progress` along `route`. */
export function flightPose(
  route: FlightRoute,
  path: (progress: number) => FlightPose,
  to: FlightPose,
  progress: number,
): FlightPose {
  const base = path(progress);
  if (route.kind === "straight") return base;
  if (route.kind === "detour") {
    const bulge = Math.sin(Math.PI * progress);
    const position = base.position.clone().addScaledVector(route.side, bulge);
    position.y += route.lift * bulge;
    return { ...base, position };
  }
  // Under: flat and to its own size first while hardly moving across, then along low, then down onto its place.
  const from = path(0);
  const down = smoothstep(progress, 0, UNDER_DOWN);
  const along = smoothstep(progress, UNDER_DOWN * 0.45, 1);
  const position = new THREE.Vector3().lerpVectors(from.position, to.position, along);
  position.y = THREE.MathUtils.lerp(from.position.y, route.cruise, down);
  position.y = THREE.MathUtils.lerp(position.y, to.position.y, smoothstep(progress, 0.86, 1));
  return {
    position,
    pitch: THREE.MathUtils.lerp(from.pitch, to.pitch, down),
    roll: THREE.MathUtils.lerp(from.roll, to.roll, down),
    scale: THREE.MathUtils.lerp(from.scale, to.scale, down),
  };
}

/** True when two cards cut through each other: an edge of one passes through the face of the other. */
export function cardsCross(a: CardRect, b: CardRect): boolean {
  const ca = corners(a);
  const cb = corners(b);
  return edgesThrough(ca, b) || edgesThrough(cb, a);
}

const EULER = new THREE.Euler();
const MATRIX = new THREE.Matrix4();
const QUATERNION = new THREE.Quaternion();
const SCALE = new THREE.Vector3();

function matrixOf(rect: CardRect): THREE.Matrix4 {
  EULER.set(rect.pitch, rect.yaw ?? 0, rect.roll);
  QUATERNION.setFromEuler(EULER);
  SCALE.setScalar(rect.scale);
  return MATRIX.compose(rect.position, QUATERNION, SCALE);
}

function corners(rect: CardRect): THREE.Vector3[] {
  const matrix = matrixOf(rect);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => new THREE.Vector3(x! * rect.halfWidth, y! * rect.halfHeight, 0).applyMatrix4(matrix));
}

function highest(rect: CardRect): number {
  return Math.max(...corners(rect).map((corner) => corner.y));
}

function lowest(rect: CardRect): number {
  return Math.min(...corners(rect).map((corner) => corner.y));
}

const INVERSE = new THREE.Matrix4();
const LOCAL_A = new THREE.Vector3();
const LOCAL_B = new THREE.Vector3();

/** Whether any edge of the loop `points` passes through the face of `rect` (a little larger, for room). */
function edgesThrough(points: THREE.Vector3[], rect: CardRect): boolean {
  INVERSE.copy(matrixOf(rect)).invert();
  const halfWidth = rect.halfWidth * 1.04;
  const halfHeight = rect.halfHeight * 1.04;
  for (let i = 0; i < points.length; i++) {
    LOCAL_A.copy(points[i]!).applyMatrix4(INVERSE);
    LOCAL_B.copy(points[(i + 1) % points.length]!).applyMatrix4(INVERSE);
    // In the card's own space its face is z = 0: an edge crossing that plane inside the face goes through it.
    if (LOCAL_A.z * LOCAL_B.z > 0) continue;
    const span = LOCAL_A.z - LOCAL_B.z;
    const t = Math.abs(span) < 1e-9 ? 0 : LOCAL_A.z / span;
    const x = LOCAL_A.x + (LOCAL_B.x - LOCAL_A.x) * t;
    const y = LOCAL_A.y + (LOCAL_B.y - LOCAL_A.y) * t;
    if (Math.abs(x) <= halfWidth && Math.abs(y) <= halfHeight) return true;
  }
  return false;
}

function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
