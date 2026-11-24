/**
 * The room's one camera and the views it eases between: the campaign shelf (`CAM_SHELF`), a box opened on the table
 * (`CAM_OPEN`), and the game table's own angle (`CAM_GAME`), which Play swings round to as the room fades.
 */
import * as THREE from "three";
import { lerp } from "./motion.js";

export interface View {
  pos: THREE.Vector3;
  at: THREE.Vector3;
}

export const CAM_SHELF: View = { pos: new THREE.Vector3(0, 4.1, 10.2), at: new THREE.Vector3(0, 1.3, 0) };
export const CAM_OPEN: View = { pos: new THREE.Vector3(0.1, 8.0, 7.9), at: new THREE.Vector3(0.1, 0.55, 0.75) };
export const CAM_GAME: View = { pos: new THREE.Vector3(0, 10.8, 8.3), at: new THREE.Vector3(0, 0, 0.4) };

export const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
const aim = new THREE.Vector3();

/**
 * Places the camera for the shelf: `open` (0 to 1) of the way to an opened box, `toGame` of the way to the game
 * table's angle, swaying a little with the pointer (`pointerX`, -1 to 1, or below -2 when it is off the page). Returns
 * how much further than the wide-screen distance the camera stands, for the fog.
 */
export function aimShelfCamera(open: number, toGame: number, pointerX: number): number {
  // Pull the camera back on narrow screens so all three boxes fit.
  const pullBack = Math.max(1, 1.45 / camera.aspect);
  camera.position.lerpVectors(CAM_SHELF.pos, CAM_OPEN.pos, open);
  aim.lerpVectors(CAM_SHELF.at, CAM_OPEN.at, open);
  const pull = lerp(pullBack, Math.max(1, 1.1 / camera.aspect), open);
  const near = camera.position.distanceTo(aim);
  camera.position.sub(aim).multiplyScalar(pull).add(aim);
  camera.position.x += (1 - open) * (pointerX > -2 ? pointerX * 0.35 : 0);
  // The fog starts as far beyond the boxes as it does on a wide screen, however far a narrow one pulls the camera
  // back: otherwise a phone held upright sees the boxes through it, or not at all.
  const extra = near * (pull - 1) * (1 - toGame);
  camera.position.lerp(CAM_GAME.pos, toGame);
  aim.lerp(CAM_GAME.at, toGame);
  camera.lookAt(aim);
  return extra;
}
