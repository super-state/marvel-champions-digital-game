/**
 * Heroes & Decks: the bench on the left wall, where a deck box stands for each hero and the card binder lies. For now
 * the bench stands bare; the deck builder's task mounts the deck boxes, the binder and its buttons here (`place.ts`).
 */
import * as THREE from "three";
import { setPose } from "../camera.js";
import { ROOM } from "../room.js";
import { fitNarrow, furniturePlace } from "./place.js";

/** The bench top: its middle, how long it runs along the wall (z) and how deep it is (x). */
export const BENCH = { x: -ROOM.HALF_WIDTH + 1.7, z: -1, top: -1.4, length: 9.5, depth: 3.1 };

export const decks = furniturePlace({
  id: "decks",
  label: "Heroes & Decks",
  promise: "a deck box for each hero, and the card binder to build decks with.",
  view(out, aspect) {
    setPose(out, [-5.5, 6.8, 11.5], [BENCH.x + 0.6, BENCH.top + 1.2, BENCH.z - 1.2], 40, [12, 44], 0);
    fitNarrow(out, aspect, 1.2);
  },
  furniture(group) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24160c, roughness: 0.7 });
    const baize = new THREE.MeshStandardMaterial({ color: 0x1f3b2a, roughness: 0.95 });
    const { x, z, top, length, depth } = BENCH;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.35, length), wood);
    slab.position.set(x, top - 0.175, z);
    slab.castShadow = slab.receiveShadow = true;
    // A green baize mat to work on, like a card player's desk.
    const mat = new THREE.Mesh(new THREE.BoxGeometry(depth - 0.6, 0.04, length - 0.8), baize);
    mat.position.set(x + 0.1, top + 0.02, z);
    mat.receiveShadow = true;
    group.add(slab, mat);
    const legHeight = top - 0.35 - ROOM.FLOOR;
    for (const dz of [-1, 1])
      for (const dx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, legHeight, 0.45), dark);
        leg.position.set(x + dx * (depth / 2 - 0.35), ROOM.FLOOR + legHeight / 2, z + dz * (length / 2 - 0.4));
        group.add(leg);
      }
    // A low drawer front under the top.
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, length - 1.4), dark);
    drawer.position.set(x + depth / 2 - 0.05, top - 0.75, z);
    group.add(drawer);
    // An empty shelf on the wall above, for the deck boxes to come.
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, length - 1.5), wood);
    shelf.position.set(-ROOM.HALF_WIDTH + 0.95, top + 4.3, z);
    shelf.castShadow = true;
    group.add(shelf);
    for (const dz of [-1, 1]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.16), dark);
      bracket.position.set(-ROOM.HALF_WIDTH + 0.75, top + 3.85, z + dz * (length / 2 - 1.6));
      group.add(bracket);
    }
  },
});
