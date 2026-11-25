/**
 * Free Play: the setup tray on the table, to the right of where the mat lies, with a slot each for the villain, the
 * module, the difficulty, the hero and the deck. For now the tray stands empty; the Free Play task mounts the pieces
 * and the buttons here (`place.ts`). It stands outside the game camera's view, so Play never has to clear it away.
 */
import * as THREE from "three";
import { setPose } from "../camera.js";
import { ROOM } from "../room.js";
import { fitNarrow, furniturePlace } from "./place.js";

/** The tray: its middle on the table, and its size (x across, z deep). */
export const TRAY = { x: ROOM.TABLE_WIDTH / 2 - 2.1, z: 4.8, width: 2.6, length: 5.4, height: 0.32, slots: 5 };

export const freePlay = furniturePlace({
  id: "free-play",
  label: "Free Play",
  promise: "a setup tray to build any game you have opened: villain, module, difficulty, hero and deck.",
  view(out, aspect) {
    setPose(out, [TRAY.x - 4.6, 6.2, TRAY.z + 7.4], [TRAY.x - 0.2, 0, TRAY.z - 0.6], 38, [8, 30], 1);
    fitNarrow(out, aspect, 1.2);
  },
  furniture(group) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4527, roughness: 0.5 });
    const felt = new THREE.MeshStandardMaterial({ color: 0x14202e, roughness: 0.95 });
    const { x, z, width, length, height, slots } = TRAY;
    const tray = new THREE.Group();
    const part = (w: number, h: number, d: number, px: number, py: number, pz: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(px, py, pz);
      mesh.castShadow = mesh.receiveShadow = true;
      tray.add(mesh);
    };
    part(width, 0.08, length, 0, 0.04, 0, wood);
    part(width - 0.2, 0.02, length - 0.2, 0, 0.09, 0, felt);
    for (const side of [-1, 1]) {
      part(0.1, height, length, side * (width / 2 - 0.05), height / 2, 0, wood);
      part(width, height, 0.1, 0, height / 2, side * (length / 2 - 0.05), wood);
    }
    for (let i = 1; i < slots; i++)
      part(width - 0.2, height * 0.7, 0.06, 0, height * 0.35, -length / 2 + (i * length) / slots, wood);
    tray.position.set(x, 0, z);
    tray.rotation.y = -0.06;
    group.add(tray);
  },
});
