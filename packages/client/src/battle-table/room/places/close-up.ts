/**
 * A box taken off a shelf and brought up close, the same on every shelf in the room (the hero shelf, `decks.ts`; the
 * scenario shelf, `scenario-shelf.ts`), so they all feel alike (Adam, 2026-11-26: "more juice, a slightly different
 * path"; turn "slower"). First it slides straight out of its slot, leaning back as if pulled by its top; then it swoops
 * up and over towards the camera on a curve, spinning once round, and lands up close a touch past its place and
 * settles back, with a small pop. Once there it turns slowly from side to side. Let go, it goes straight back.
 */
import * as THREE from "three";
import { camera } from "../camera.js";

/** How long a box takes to come up close, in seconds, and how fast it then turns side to side (radians a second). */
export const FLY = 0.62;
export const SWAY = 0.35;
/** How far it turns either way up close. */
export const SWAY_ANGLE = 0.42;

/** Which way a shelf faces: `out` from its slots into the room, `left` the reader's left as they face it. */
export interface Facing {
  readonly out: THREE.Vector3;
  readonly left: THREE.Vector3;
}

export interface Measure {
  readonly across: number;
  readonly tall: number;
  readonly deep: number;
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;
/** Past the end and back: the landing's overshoot. */
const easeOutBack = (x: number) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2;
const UP = new THREE.Vector3(0, 1, 0);
const pulled = new THREE.Vector3();
const over = new THREE.Vector3();
const spin = new THREE.Quaternion();
const lean = new THREE.Quaternion();

/** Stands a box `t` (0 to 1) of the way through coming up close from `home` to `to`. */
export function flyUp(
  mesh: THREE.Object3D,
  home: THREE.Vector3,
  to: THREE.Vector3,
  t: number,
  facing: Facing,
  turn = 0,
) {
  const slide = 0.24;
  pulled.copy(home).addScaledVector(facing.out, 1.3);
  if (t < slide) {
    const a = easeOut(t / slide);
    mesh.position.lerpVectors(home, pulled, a);
    // `turn`: how it stands on its shelf (a box spine-out is turned a quarter round).
    mesh.quaternion.setFromAxisAngle(UP, turn).multiply(lean.setFromAxisAngle(facing.left, 0.22 * a));
    mesh.scale.setScalar(1);
    return;
  }
  const b = (t - slide) / (1 - slide);
  const k = easeOutBack(b);
  // A curve over the top: from the slot's mouth, up past the shelf above, to up close.
  over.copy(pulled).lerp(to, 0.35);
  over.y = Math.max(pulled.y, to.y) + 2.6;
  const u = 1 - k;
  mesh.position.set(
    u * u * pulled.x + 2 * u * k * over.x + k * k * to.x,
    u * u * pulled.y + 2 * u * k * over.y + k * k * to.y,
    u * u * pulled.z + 2 * u * k * over.z + k * k * to.z,
  );
  spin.setFromAxisAngle(UP, turn + (Math.PI * 2 - turn) * easeOut(b));
  lean.setFromAxisAngle(facing.left, 0.22 * (1 - b) - Math.sin(Math.PI * b) * 0.18);
  mesh.quaternion.copy(spin).multiply(lean);
  mesh.scale.setScalar(1 + Math.sin(Math.PI * Math.min(1, b * 1.25)) * 0.08);
}

/** Up close, `seconds` after landing: turning slowly from side to side. */
export function sway(mesh: THREE.Object3D, seconds: number) {
  mesh.quaternion.setFromAxisAngle(UP, Math.sin(seconds * SWAY) * SWAY_ANGLE);
}

const looking = new THREE.Vector3();
const screenLeft = new THREE.Vector3();

/**
 * Where a box up close stands: big in front of the camera, a little above the middle and left of it (its card goes
 * to its right). Its front fills a little over half the screen's height (or half its width, for a wide box), measured
 * to the front, which stands half the box's depth nearer than its middle.
 */
export function closeSpot(size: Measure, out: THREE.Vector3, left = 0.42): THREE.Vector3 {
  const tan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  const front = Math.max(size.tall / (1.1 * tan), size.across / (1.0 * tan * camera.aspect));
  const distance = front + size.deep / 2;
  camera.getWorldDirection(looking);
  out.copy(camera.position).addScaledVector(looking, distance);
  out.y += front * tan * 0.06;
  screenLeft.setFromMatrixColumn(camera.matrixWorld, 0).negate();
  return out.addScaledVector(screenLeft, distance * tan * camera.aspect * left);
}
