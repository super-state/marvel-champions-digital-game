/**
 * The room's one camera, the poses it stands in, and how it gets from one to the next: a glide, or with "reduce
 * motion" a fade through dark. The campaign shelf's own views are here too: the boxes on the table (`CAM_SHELF`), a
 * box opened (`CAM_OPEN`), and the game table's own angle (`CAM_GAME`), which Play swings round to as the room fades.
 */
import * as THREE from "three";
import { ease, lerp } from "./motion.js";

export interface View {
  pos: THREE.Vector3;
  at: THREE.Vector3;
}

export const CAM_SHELF: View = { pos: new THREE.Vector3(0, 4.1, 10.2), at: new THREE.Vector3(0, 1.3, 0) };
export const CAM_OPEN: View = { pos: new THREE.Vector3(0.1, 8.0, 7.9), at: new THREE.Vector3(0.1, 0.55, 0.75) };
export const CAM_GAME: View = { pos: new THREE.Vector3(0, 10.8, 8.3), at: new THREE.Vector3(0, 0, 0.4) };

/** The shelf's fog, on a wide screen: the boxes clear, the shelf behind them fading into the dark. */
export const FOG_NEAR = 13;
export const FOG_FAR = 26;

export const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

/**
 * Where the camera stands, what it looks at, its field of view, the fog, and `blur`: how soft the back wall and the
 * shelf are (1 the shelf's own depth of field, 0 sharp).
 */
export interface Pose {
  pos: THREE.Vector3;
  at: THREE.Vector3;
  fov: number;
  fogNear: number;
  fogFar: number;
  blur: number;
}

export const newPose = (): Pose => ({
  pos: new THREE.Vector3(),
  at: new THREE.Vector3(),
  fov: 38,
  fogNear: FOG_NEAR,
  fogFar: FOG_FAR,
  blur: 1,
});

export function copyPose(to: Pose, from: Pose): Pose {
  to.pos.copy(from.pos);
  to.at.copy(from.at);
  to.fov = from.fov;
  to.fogNear = from.fogNear;
  to.fogFar = from.fogFar;
  to.blur = from.blur;
  return to;
}

export function lerpPose(to: Pose, a: Pose, b: Pose, k: number): Pose {
  to.pos.lerpVectors(a.pos, b.pos, k);
  to.at.lerpVectors(a.at, b.at, k);
  to.fov = lerp(a.fov, b.fov, k);
  to.fogNear = lerp(a.fogNear, b.fogNear, k);
  to.fogFar = lerp(a.fogFar, b.fogFar, k);
  to.blur = lerp(a.blur, b.blur, k);
  return to;
}

/** A pose from its numbers: stand at `pos`, look at `at`. */
export function setPose(
  out: Pose,
  pos: readonly [number, number, number],
  at: readonly [number, number, number],
  fov: number,
  fog: readonly [number, number],
  blur: number,
): Pose {
  out.pos.set(...pos);
  out.at.set(...at);
  out.fov = fov;
  out.fogNear = fog[0];
  out.fogFar = fog[1];
  out.blur = blur;
  return out;
}

/**
 * The shelf's pose: `open` (0 to 1) of the way to an opened box, `toGame` of the way to the game table's angle,
 * swaying a little with the pointer (`pointerX`, -1 to 1, or below -2 when it is off the page).
 */
export function shelfPose(out: Pose, open: number, toGame: number, pointerX: number, aspect: number): Pose {
  // Pull the camera back on narrow screens so all three boxes fit.
  const pullBack = Math.max(1, 1.45 / aspect);
  out.pos.lerpVectors(CAM_SHELF.pos, CAM_OPEN.pos, open);
  out.at.lerpVectors(CAM_SHELF.at, CAM_OPEN.at, open);
  const pull = lerp(pullBack, Math.max(1, 1.1 / aspect), open);
  const near = out.pos.distanceTo(out.at);
  out.pos.sub(out.at).multiplyScalar(pull).add(out.at);
  out.pos.x += (1 - open) * (pointerX > -2 ? pointerX * 0.35 : 0);
  // The fog starts as far beyond the boxes as it does on a wide screen, however far a narrow one pulls the camera
  // back: otherwise a phone held upright sees the boxes through it, or not at all.
  const extra = near * (pull - 1) * (1 - toGame);
  out.fogNear = FOG_NEAR + extra;
  out.fogFar = FOG_FAR + extra;
  out.pos.lerp(CAM_GAME.pos, toGame);
  out.at.lerp(CAM_GAME.at, toGame);
  out.fov = 38;
  out.blur = 1;
  return out;
}

// ---------- getting from one pose to the next ----------

/** How long a glide between two places takes, and a fade (with "reduce motion"). */
const GLIDE_S = 1.25;
const FADE_S = 0.5;

const current = newPose();
const from = newPose();
const target = newPose();
let toward: ((out: Pose) => void) | null = null;
let k = 1;
let fading = false;

/** Whether the camera is on its way somewhere. */
export const moving = () => k < 1;

/** How dark the fade is now (0 clear, 1 black): only with "reduce motion". */
export const fadeAmount = () => (fading && k < 1 ? 1 - Math.abs(2 * k - 1) : 0);

/**
 * Heads for the pose `view` keeps (it can move while the camera travels: the shelf sways, a box opens), gliding there
 * from wherever the camera is now, or fading through dark with `fade`. With `now`, it is there at once.
 */
export function headTo(view: (out: Pose) => void, options: { fade?: boolean; now?: boolean } = {}) {
  toward = view;
  if (options.now) {
    k = 1;
    view(current);
    return;
  }
  copyPose(from, current);
  fading = !!options.fade;
  k = 0;
}

/**
 * Moves the camera on by `dt` seconds and puts it in place; says whether it has just arrived. Returns the blur to
 * draw the frame with.
 */
const stepped = { blur: 1, arrived: false };
export function stepCamera(dt: number, fog: THREE.Fog): { readonly blur: number; readonly arrived: boolean } {
  let arrived = false;
  if (toward) toward(target);
  if (k < 1) {
    k = Math.min(1, k + dt / (fading ? FADE_S : GLIDE_S));
    if (fading) copyPose(current, k < 0.5 ? from : target);
    else lerpPose(current, from, target, ease(k));
    arrived = k >= 1;
  } else copyPose(current, target);
  camera.position.copy(current.pos);
  camera.lookAt(current.at);
  if (camera.fov !== current.fov) {
    camera.fov = current.fov;
    camera.updateProjectionMatrix();
  }
  fog.near = current.fogNear;
  fog.far = current.fogFar;
  stepped.blur = current.blur;
  stepped.arrived = arrived;
  return stepped;
}
