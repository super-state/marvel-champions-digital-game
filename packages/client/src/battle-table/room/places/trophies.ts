/**
 * Trophies & Stats: the glass cabinet and the record board on the right wall, standing as furniture from the start.
 * What fills them (the trophies, the record, the mats and their buttons) is `trophy-cabinet.ts`, mounted by `main.ts`
 * once the room has loaded.
 */
import * as THREE from "three";
import { canvas, texture } from "../canvas.js";
import { setPose } from "../camera.js";
import { ROOM } from "../room.js";
import { fitNarrow, furniturePlace } from "./place.js";

const WALL = ROOM.HALF_WIDTH;
/** The cabinet: its middle along the wall (z), its depth out from the wall, its width and height. */
export const CABINET = { x: WALL - 1.15, z: -3.8, depth: 2.1, width: 5, height: 9.2 };
/** The record board, hung on the wall: its middle (z, y) and size. */
export const BOARD = { x: WALL - 0.12, z: 3.9, y: 1.4, width: 5.4, height: 4 };

/** Cork for the record board: warm brown with darker flecks (the cabinet's code pins the record to it). */
export function corkPrint(width = 512, height = 384): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const [cv, g] = canvas(width, height);
  g.fillStyle = "#8a6440";
  g.fillRect(0, 0, width, height);
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const flecks = (2600 * width * height) / (512 * 384);
  for (let i = 0; i < flecks; i++) {
    g.fillStyle = rand() < 0.6 ? `rgba(60,38,18,${0.2 + rand() * 0.3})` : `rgba(200,160,110,${0.15 + rand() * 0.2})`;
    g.fillRect(rand() * width, rand() * height, 1 + rand() * 3, 1 + rand() * 3);
  }
  return [cv, g];
}

let cork: THREE.MeshStandardMaterial | null = null;
/** The board's cork, to draw the record on (null until the furniture stands). */
export const paintBoard = () => cork;

export const trophies = furniturePlace({
  id: "trophies",
  label: "Trophies & Stats",
  promise: "a trophy for each thing you have done, and your record against every villain.",
  view(out, aspect) {
    if (aspect < 0.9) {
      // A phone held upright: the panel takes the lower part of the screen, so the cabinet stands in the top part.
      setPose(out, [CABINET.x - 9.5, 7.5, CABINET.z + 0.4], [CABINET.x, -5.6, CABINET.z], 62, [8, 40], 0);
      return;
    }
    setPose(out, [4.2, 7.6, 6.2], [WALL - 1, 0.2, -1.9], 46, [10, 40], 0);
    fitNarrow(out, aspect, 1.2);
  },
  furniture(group) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x2c1d12, roughness: 0.55 });
    const back = new THREE.MeshStandardMaterial({ color: 0x1a2328, roughness: 0.9 });
    const { x, z, depth, width, height } = CABINET;
    const bottom = ROOM.FLOOR;
    const cabinet = new THREE.Group();
    const piece = (w: number, h: number, d: number, px: number, py: number, pz: number, m = wood) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(px, py, pz);
      mesh.castShadow = mesh.receiveShadow = true;
      cabinet.add(mesh);
    };
    // Plinth, top, sides, back, and three glass shelves.
    piece(depth, 0.9, width, 0, 0.45, 0);
    piece(depth + 0.2, 0.3, width + 0.2, 0, height - 0.15, 0);
    for (const side of [-1, 1])
      piece(depth, height - 1.2, 0.18, 0, (height - 0.3 + 0.9) / 2, side * (width / 2 - 0.09));
    piece(0.1, height - 1.2, width - 0.36, depth / 2 - 0.05, (height - 0.3 + 0.9) / 2, 0, back);
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xcfe6ef,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.14,
      clearcoat: 1,
    });
    for (let i = 1; i <= 3; i++) piece(depth - 0.2, 0.06, width - 0.4, 0.05, 0.9 + (i * (height - 1.2)) / 4, 0, glass);
    // The glass doors at the front, with thin frames.
    const front = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.36, height - 1.2), glass);
    front.rotation.y = -Math.PI / 2;
    front.position.set(-depth / 2, (height - 0.3 + 0.9) / 2, 0);
    cabinet.add(front);
    for (const dz of [-(width / 2 - 0.18), 0, width / 2 - 0.18])
      piece(0.12, height - 1.2, 0.1, -depth / 2, (height - 0.3 + 0.9) / 2, dz);
    // A small light inside, so the glass catches it.
    const inside = new THREE.PointLight(0xffe0b0, 6, 7, 2);
    inside.position.set(0, height - 1.2, 0);
    cabinet.add(inside);
    cabinet.position.set(x, bottom, z);
    group.add(cabinet);

    // The record board: cork in a wooden frame, hung on the wall.
    const board = new THREE.Group();
    cork = new THREE.MeshStandardMaterial({ map: texture(corkPrint()[0]), roughness: 0.95 });
    const corkMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.width, BOARD.height), cork);
    corkMesh.rotation.y = -Math.PI / 2;
    board.add(corkMesh);
    for (const [w, h, dz, dy] of [
      [BOARD.width + 0.4, 0.25, 0, BOARD.height / 2],
      [BOARD.width + 0.4, 0.25, 0, -BOARD.height / 2],
      [0.25, BOARD.height, BOARD.width / 2, 0],
      [0.25, BOARD.height, -BOARD.width / 2, 0],
    ] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, h, w), wood);
      bar.position.set(-0.05, dy, dz);
      board.add(bar);
    }
    board.position.set(BOARD.x, BOARD.y, BOARD.z);
    group.add(board);
  },
});
