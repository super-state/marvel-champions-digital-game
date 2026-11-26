/**
 * The hero shelf: a bookcase standing on the bench (`decks.ts`) with a deck box for every hero in the game
 * (`hero-catalogue.ts`), in release order and grouped by release, each group named on the shelf's edge. The heroes the
 * table can deal stand lit; the rest are greyed out, to show the whole game the room is growing towards.
 * Where each box stands is `hero-shelf-layout.ts`.
 */
import * as THREE from "three";
import { CARD_ART_ROUTE } from "../../decks/card-art.js";
import { canvas, greyOut, loadImage, texture } from "../canvas.js";
import { ROOM } from "../room.js";
import type { ShelfHero } from "./hero-catalogue.js";
import { BOARD, CASE_SPAN, type ShelfLayout } from "./hero-shelf-layout.js";

export { SHELF_LOOK, type ShelfLayout } from "./hero-shelf-layout.js";

/** Where the bookcase stands: its back to the left wall. */
export const CASE = { ...CASE_SPAN, back: -ROOM.HALF_WIDTH + 0.05 };

// ── The bookcase ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The bookcase's wood: its sides, top, shelves and back, and a brass plate on the shelf's edge under each release. */
export function buildCase(group: THREE.Group, layout: ShelfLayout) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.6 });
  const back = new THREE.MeshStandardMaterial({ color: 0x1d130c, roughness: 0.85 });
  const { back: x0, z, width, depth } = CASE;
  const height = layout.top - layout.bottom;
  const midX = x0 + depth / 2;
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, height, width + 0.5), back);
  panel.position.set(x0 + 0.04, layout.bottom + height / 2, z);
  add(panel);
  for (const side of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(depth, height + 0.2, 0.24), wood);
    end.position.set(midX, layout.bottom + (height + 0.2) / 2, z + side * (width / 2 + 0.12));
    add(end);
  }
  const lid = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.2, 0.22, width + 0.9), wood);
  lid.position.set(midX + 0.05, layout.top + 0.11, z);
  add(lid);
  for (const floor of layout.floors) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(depth, BOARD, width), wood);
    board.position.set(midX, floor - BOARD / 2, z);
    add(board);
  }
  for (const label of layout.labels) {
    const length = Math.abs(label.from - label.to);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(length, 4.2), 0.26),
      new THREE.MeshStandardMaterial({ map: texture(platePrint(label.text)), roughness: 0.45, metalness: 0.35 }),
    );
    plate.rotation.y = Math.PI / 2;
    plate.position.set(x0 + depth + 0.005, label.y - BOARD / 2, (label.from + label.to) / 2);
    group.add(plate);
  }
}

/** A release's name on a small brass plate. */
function platePrint(text: string): HTMLCanvasElement {
  const [cv, g] = canvas(640, 40);
  g.fillStyle = "#8a6a32";
  g.fillRect(0, 0, 640, 40);
  g.fillStyle = "#2a1c0c";
  g.font = "800 26px 'Public Sans', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text.toUpperCase(), 320, 21, 620);
  return cv;
}

// ── The boxes ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const ASPECT_COLOURS: Record<string, number> = {
  justice: 0xf2c230,
  leadership: 0x3d8fe0,
  aggression: 0xd8342b,
  protection: 0x3fae4a,
  pool: 0xe0569e,
};

const hex = (colour: number) => `#${colour.toString(16).padStart(6, "0")}`;
const aspectColour = (hero: ShelfHero) => ASPECT_COLOURS[hero.aspect ?? ""] ?? 0x8d877d;

/** A box's spine: dark card stock, the aspect's colour at the top, the hero's name up it and who they are under it. */
function spinePrint(hero: ShelfHero, lit: boolean): HTMLCanvasElement {
  const [cv, g] = canvas(96, 288);
  g.fillStyle = "#15110d";
  g.fillRect(0, 0, 96, 288);
  g.fillStyle = hex(aspectColour(hero));
  g.fillRect(0, 0, 96, 22);
  g.save();
  g.translate(48, 160);
  g.rotate(-Math.PI / 2);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f3eee3";
  const name = hero.name.toUpperCase();
  let size = 38;
  g.font = `900 ${size}px 'Public Sans', sans-serif`;
  while (size > 18 && g.measureText(name).width > 240) g.font = `900 ${--size}px 'Public Sans', sans-serif`;
  const twoLines = hero.alterEgo !== hero.name;
  g.fillText(name, 0, twoLines ? -11 : 0);
  if (twoLines) {
    g.fillStyle = "#b7ad9c";
    g.font = "700 17px 'Public Sans', sans-serif";
    g.fillText(hero.alterEgo, 0, 22, 240);
  }
  g.restore();
  if (!lit) greyOut(cv);
  return cv;
}

/** A box's front: the hero's card (or, where its scan isn't here, their name on the box's stock). */
function frontPrint(hero: ShelfHero, scan: HTMLImageElement | null, lit: boolean): HTMLCanvasElement {
  const [cv, g] = canvas(200, 280);
  if (scan) g.drawImage(scan, 0, 0, 200, 280);
  else {
    g.fillStyle = "#15110d";
    g.fillRect(0, 0, 200, 280);
    g.fillStyle = hex(aspectColour(hero));
    g.fillRect(0, 0, 200, 26);
    g.fillStyle = "#f3eee3";
    g.font = "900 26px 'Public Sans', sans-serif";
    g.textAlign = "center";
    g.fillText(hero.name.toUpperCase(), 100, 150, 184);
    g.fillStyle = "#b7ad9c";
    g.font = "700 16px 'Public Sans', sans-serif";
    g.fillText(hero.alterEgo, 100, 180, 184);
  }
  if (!lit) greyOut(cv);
  return cv;
}

/** The hero's card, as `cardArtUrl` finds an identity's scan (the catalogue holds the code, not the card). */
const scanOf = (hero: ShelfHero) => `${CARD_ART_ROUTE}bundles/cards/${hero.code}.png`;

export interface ShelfBox {
  readonly hero: ShelfHero;
  readonly lit: boolean;
  readonly mesh: THREE.Group;
  readonly home: THREE.Vector3;
}

/** Every hero's deck box, on its shelf. Face-out boxes show the hero's card, so their scans load first. */
export async function buildBoxes(
  group: THREE.Group,
  layout: ShelfLayout,
  lit: ReadonlySet<string>,
): Promise<ShelfBox[]> {
  const scans = await Promise.all(layout.slots.map((slot) => (slot.faceOut ? loadImage(scanOf(slot.hero)) : null)));
  const stockLit = new THREE.MeshStandardMaterial({ color: 0x15110d, roughness: 0.7 });
  const stockGrey = new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 0.8 });
  const lidGrey = new THREE.MeshStandardMaterial({ color: 0x3b3936, roughness: 0.6 });
  return layout.slots.map((slot, i) => {
    const { hero, size } = slot;
    const on = lit.has(hero.code);
    const stock = on ? stockLit : stockGrey;
    const lid = on ? new THREE.MeshStandardMaterial({ color: aspectColour(hero), roughness: 0.5 }) : lidGrey;
    const show = new THREE.MeshStandardMaterial({
      map: texture(slot.faceOut ? frontPrint(hero, scans[i] ?? null, on) : spinePrint(hero, on)),
      roughness: on ? 0.55 : 0.8,
    });
    // Its showing side faces the room (+x): +x, -x, +y, -y, +z, -z.
    const body = new THREE.Mesh(new THREE.BoxGeometry(size.deep, size.tall, size.across), [
      show,
      stock,
      lid,
      stock,
      stock,
      stock,
    ]);
    body.castShadow = true;
    body.receiveShadow = true;
    const mesh = new THREE.Group();
    mesh.add(body);
    mesh.position.copy(slot.at);
    group.add(mesh);
    return { hero, lit: on, mesh, home: slot.at.clone() };
  });
}
