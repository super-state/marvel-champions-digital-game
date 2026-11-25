/**
 * The chosen mat, lying on the room's table in front of the boxes, so the room shows what the next game will be dealt
 * on. It is the table's own print (`matPrint`), drawn again whenever the mat chosen at the cabinet changes. When Play
 * rolls the game's mat out across the table (`places/campaign-play.ts`), this one gives way to it.
 */
import * as THREE from "three";
import { currentMat, matLook, MAT_CHANGED } from "../mats.js";
import { matPrint } from "../table.js";
import { anisotropy } from "./canvas.js";
import { root, scene } from "./room.js";

/** Where it lies: in front of the boxes, clear of the Free Play tray on the right. */
export const TABLE_MAT = { x: 0, z: 5.1, width: 12.4, depth: 7.4 };

let mat: THREE.Group | null = null;

export function layTableMat(): void {
  if (mat) return;
  const { x, z, width, depth } = TABLE_MAT;
  const { texture, reshape } = matPrint(() => {});
  reshape(width / depth);
  texture.anisotropy = anisotropy();
  const back = new THREE.MeshStandardMaterial({ color: new THREE.Color(matLook(currentMat()).back), roughness: 0.85 });
  // `#shelf[data-table-mat]` says which mat lies there, for checks.
  root.dataset.tableMat = currentMat();
  addEventListener(MAT_CHANGED, () => {
    back.color.set(matLook(currentMat()).back);
    root.dataset.tableMat = currentMat();
  });
  // The cloth's thickness, then the print on top.
  const binding = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, depth), back);
  binding.position.y = 0.02;
  binding.receiveShadow = true;
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.04, depth - 0.04),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }),
  );
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.y = 0.041;
  cloth.receiveShadow = true;
  mat = new THREE.Group();
  mat.add(binding, cloth);
  mat.position.set(x, 0, z);
  scene.add(mat);
}

/** Shown, or put away while Play's own mat rolls out over the table. */
export function showTableMat(shown: boolean): void {
  if (mat) mat.visible = shown;
}
