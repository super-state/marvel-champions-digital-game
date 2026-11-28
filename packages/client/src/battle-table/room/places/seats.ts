/**
 * Where the two picking places stand in the room, so the picking reads left to right (Adam, 2026-11-28: "campaign box
 * on the left, then heroes ... in the middle"; "behind the desk will be one shelf with the heroes on, villains will be
 * over to the left"): the scenario cabinet on the left wall, the hero shelf and its bench on the back wall behind the
 * games table.
 *
 * Each place is still built where it was first drawn (the cabinet against the back wall, the hero shelf against the
 * left wall), in that place's own coordinates, and its whole group is turned and moved onto its wall here. What is
 * worked out in the room's coordinates (where the camera stands, a box coming up close in front of it, a point
 * projected onto the screen) goes through `seatPoint` / `unseatPoint` on its way between the two.
 */
import * as THREE from "three";
import type { Pose } from "../camera.js";

/** A quarter turn about the upright, then a move along the floor. */
export interface Seat {
  readonly turn: number;
  readonly x: number;
  readonly z: number;
}

/** The hero shelf, drawn backed onto the left wall, turned to back onto the back wall, its middle behind the table. */
export const HERO_SEAT: Seat = { turn: -Math.PI / 2, x: 0, z: 9.1 };
/** The scenario cabinet, drawn on the back wall right of the middle, turned onto the left wall, its middle level with
 * the table's far half. */
export const VILLAIN_SEAT: Seat = { turn: Math.PI / 2, x: -9.07, z: 11.6 };

/** Stands a place's group on its wall. */
export function seatGroup(group: THREE.Object3D, seat: Seat) {
  group.rotation.set(0, seat.turn, 0);
  group.position.set(seat.x, 0, seat.z);
  group.updateMatrixWorld(true);
}

/** A point in the place's own coordinates, into the room's (in place). */
export function seatPoint(v: THREE.Vector3, seat: Seat): THREE.Vector3 {
  const [c, s] = [Math.cos(seat.turn), Math.sin(seat.turn)];
  const { x, z } = v;
  return v.set(x * c + z * s + seat.x, v.y, -x * s + z * c + seat.z);
}

/** A point in the room's coordinates, into the place's own (in place). */
export function unseatPoint(v: THREE.Vector3, seat: Seat): THREE.Vector3 {
  const [c, s] = [Math.cos(seat.turn), Math.sin(seat.turn)];
  const x = v.x - seat.x;
  const z = v.z - seat.z;
  return v.set(x * c - z * s, v.y, x * s + z * c);
}

/** A camera pose worked out in the place's own coordinates, into the room's. */
export function seatPose(pose: Pose, seat: Seat): Pose {
  seatPoint(pose.pos, seat);
  seatPoint(pose.at, seat);
  return pose;
}
