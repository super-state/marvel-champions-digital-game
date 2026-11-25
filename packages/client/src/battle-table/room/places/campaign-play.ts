/**
 * Play: from the box onto the game table. Play deals the game on the table underneath, out of sight. Here the box
 * clears away and the villain card lifts up out of view, the camera swings round to the table's own angle, and the
 * table's own mat rolls out across the wooden table to exactly where the table has it. Then the room fades into the
 * table's colour, and the table itself brings its pieces in, its own 3D cards landing one at a time
 * (`BattleTable.enter`), then deals the hand and asks about the mulligan. Nothing is drawn twice, so there is no
 * moment where a stand-in is swapped for the real card.
 */
import * as THREE from "three";
import { matPrint, type BattleTable } from "../../table.js";
import type { VillainId } from "../../model.js";
import { anisotropy } from "../canvas.js";
import type { RoomSetting } from "./settings.js";
import { CAM_GAME, camera } from "../camera.js";
import { span } from "../motion.js";
import { el, raycaster, root, scene } from "../room.js";

const MAT_Y = 0.01;
/** The outro, in seconds from Play. */
const TARGETS_AT = 0.3;
const MAT_AT = 0.5;
const MAT_LENGTH = 0.9;
const FADE_AT = 1.45;
const FADE_LENGTH = 0.45;
/** The table's first piece starts down as the room has all but faded. */
const ENTER_AT = FADE_AT + FADE_LENGTH * 0.7;

type Quad = [THREE.Vector2, THREE.Vector2, THREE.Vector2, THREE.Vector2];
type Corners = THREE.Vector3[];
/** What the shelf reads of the table page it lies over (`main.ts`). */
export interface ShelfHost {
  /** Deals a new game against this villain on the table under the shelf. */
  deal(villain: VillainId): void;
  /** The table, once a game has been dealt on it. */
  table(): Pick<BattleTable, "matOutline" | "enter"> | null;
  /** The shelf has faded away: the table is the page. */
  shown(): void;
  /** Why a villain is still sealed for this player ("Beat Rhino to unlock"), or null when it is open (the test site). */
  lock?(villain: VillainId): string | null;
  /** The settings the table's own menu offers, for the radio (Settings). */
  settings?(): readonly RoomSetting[];
  /** Who is playing, for the title (the test site knows; elsewhere null). */
  player?(): Promise<string | null>;
}

interface Outro {
  u: number;
  launched: boolean;
  done: boolean;
  /** `&hold=1.2`: stop the shelf's part there (for screenshots). */
  hold: number;
}

/** What Play is up to, shared with the boxes (they clear away as it runs) and the room's frame loop. */
export const play = {
  host: null as ShelfHost | null,
  /** `&play`: press Play as soon as the box is open (for checks). */
  pressPlay: false,
  outro: null as Outro | null,
  /** The room has handed the page to the table: the frame loop stops. */
  stopped: false,
};

export function beginPlay(villain: VillainId) {
  if (play.outro || !play.host) return;
  el(".shelf-opened").hidden = true;
  // The game is dealt now, under the shelf, and waits out of sight until the table brings it in.
  play.host.deal(villain);
  play.outro = {
    u: 0,
    launched: false,
    done: false,
    hold: Number(new URLSearchParams(location.search).get("hold") ?? Infinity),
  };
}

/** The four corners of an outline the table reported (a rounded rectangle, or four points, in canvas pixels). */
function cornersOf(outline: readonly string[], dx: number, dy: number): Quad | null {
  const points = outline.map((p) => {
    const [x, y] = p.split(" ").map(Number);
    return new THREE.Vector2(x! + dx, y! + dy);
  });
  if (points.length < 4) return null;
  const pick = (score: (p: THREE.Vector2) => number) => points.reduce((best, p) => (score(p) > score(best) ? p : best));
  return [pick((p) => -(p.x + p.y)), pick((p) => p.x - p.y), pick((p) => p.x + p.y), pick((p) => p.y - p.x)];
}

const gameCamera = new THREE.PerspectiveCamera();
const plane = new THREE.Plane();
/** Where on the level `y` the screen point lands, seen from the game camera: so the mat covers those pixels. */
function onLevel(point: THREE.Vector2, y: number): THREE.Vector3 {
  raycaster.setFromCamera(
    new THREE.Vector2((point.x / innerWidth) * 2 - 1, -(point.y / innerHeight) * 2 + 1),
    gameCamera,
  );
  plane.set(new THREE.Vector3(0, 1, 0), -y);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? new THREE.Vector3(0, y, 0);
}
const quadOnLevel = (quad: Quad, y: number): Corners => quad.map((p) => onLevel(p, y));

function setCorners(mesh: THREE.Mesh, corners: readonly THREE.Vector3[]) {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  corners.forEach((p, i) => position.setXYZ(i, p.x, p.y, p.z));
  position.needsUpdate = true;
}

// ---------- the mat, rolling out ----------

let mat: {
  flat: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  roll: THREE.Mesh;
  far: [THREE.Vector3, THREE.Vector3];
  near: [THREE.Vector3, THREE.Vector3];
} | null = null;

function buildMat(corners: Corners) {
  // The table's own mat print, lying in this room's light like the cloth it is, so it reads as a mat on the wood.
  const { texture: print, reshape } = matPrint(() => {});
  reshape(corners[0]!.distanceTo(corners[1]!) / corners[0]!.distanceTo(corners[3]!));
  print.anisotropy = anisotropy();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
  geometry.setIndex([0, 3, 1, 1, 3, 2]);
  const flat = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: print, roughness: 0.96 }));
  flat.frustumCulled = false;
  flat.visible = false;
  flat.receiveShadow = true;
  scene.add(flat);
  const roll = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 36, 1),
    new THREE.MeshStandardMaterial({ color: 0x152032, roughness: 0.8 }),
  );
  roll.castShadow = true;
  roll.frustumCulled = false;
  roll.visible = false;
  scene.add(roll);
  mat = { flat, roll, far: [corners[0]!, corners[1]!], near: [corners[3]!, corners[2]!] };
}

const UP = new THREE.Vector3(0, 1, 0);
/** Unrolls from the far (villain) edge towards the player: the flat part grows, the roll thins as it travels. */
function placeMat(u: number) {
  if (!mat) return;
  const r = span(u, MAT_AT, MAT_LENGTH);
  const left = mat.far[0].clone().lerp(mat.near[0], r);
  const right = mat.far[1].clone().lerp(mat.near[1], r);
  setCorners(mat.flat, [mat.far[0], mat.far[1], right, left]);
  const uv = mat.flat.geometry.getAttribute("uv") as THREE.BufferAttribute;
  uv.setXY(2, 1, 1 - r);
  uv.setXY(3, 0, 1 - r);
  uv.needsUpdate = true;
  mat.flat.visible = u >= MAT_AT && r > 0.002;
  const radius = 0.05 + 0.3 * Math.sqrt(1 - r);
  const axis = right.clone().sub(left);
  const length = axis.length();
  mat.roll.position.copy(left).add(right).multiplyScalar(0.5);
  mat.roll.position.y = MAT_Y + radius;
  mat.roll.quaternion.setFromUnitVectors(UP, axis.normalize());
  mat.roll.scale.set(radius, length * 1.01, radius);
  mat.roll.visible = u >= MAT_AT && r < 0.995;
}

/** The table canvas's offset on the page: the table reports its mat in canvas pixels. */
const canvasRect = () => document.querySelector("#space canvas")?.getBoundingClientRect();

/** Once the table underneath has its game: lay the mat where the table has it, and book the table's entrance. */
function launch(table: NonNullable<ReturnType<ShelfHost["table"]>>, u: number) {
  const rect = canvasRect();
  gameCamera.copy(camera);
  gameCamera.position.copy(CAM_GAME.pos);
  gameCamera.lookAt(CAM_GAME.at);
  gameCamera.updateMatrixWorld();
  const matQuad = cornersOf(table.matOutline(), rect?.left ?? 0, rect?.top ?? 0);
  if (matQuad) buildMat(quadOnLevel(matQuad, MAT_Y));
  table.enter(performance.now() + (ENTER_AT - u) * 1000);
}

export function stepOutro(dt: number) {
  if (!play.outro || !play.host || play.outro.done) return;
  if (play.outro.u >= TARGETS_AT && !play.outro.launched) {
    const table = play.host.table();
    if (!table) return;
    play.outro.launched = true;
    launch(table, play.outro.u);
  }
  play.outro.u = Math.min(play.outro.u + dt, play.outro.hold, FADE_AT + FADE_LENGTH);
  placeMat(play.outro.u);
  el(".shelf-head").style.opacity = String(1 - span(play.outro.u, 0, 0.4));
  // The room fades into the table's own colour, leaving the mat where the table's mat already lies.
  root.style.opacity = String(1 - span(play.outro.u, FADE_AT, FADE_LENGTH));
  if (play.outro.u >= FADE_AT + FADE_LENGTH) finishOutro();
}

/** The table is in front: hand it the page. The shelf keeps its room, ready for the next New game. */
function finishOutro() {
  if (!play.outro || !play.host) return;
  play.outro.done = true;
  play.stopped = true;
  root.hidden = true;
  // The shelf's own address settings (an opened box, a pressed Play) have had their turn: a reload opens the table.
  const params = new URLSearchParams(location.search);
  for (const key of ["open", "play", "at", "hold", "room"]) params.delete(key);
  const query = params.toString();
  history.replaceState(history.state, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  play.host.shown();
}

/** Clears away what the last Play left in the room (the rolled-out mat). */
export function resetPlay() {
  if (mat) {
    scene.remove(mat.flat, mat.roll);
    mat.flat.geometry.dispose();
    mat.flat.material.map?.dispose();
    mat.flat.material.dispose();
    mat.roll.geometry.dispose();
    (mat.roll.material as THREE.Material).dispose();
    mat = null;
  }
  play.outro = null;
}
