/**
 * The hero shelf: a bookcase standing on the bench (`decks.ts`) with a deck box for every hero in the game
 * (`hero-catalogue.ts`). The heroes the table can deal are lit; the rest stand among them faded, to show the whole
 * game the room is growing towards. Where each box stands, and in what order, is `hero-shelf-layout.ts`.
 */
import * as THREE from "three";
import { CARD_ART_ROUTE } from "../../decks/card-art.js";
import { canvas, greyOut, loadImage, texture } from "../canvas.js";
import { ROOM } from "../room.js";
import { SHELF_HEROES, type ShelfHero } from "./hero-catalogue.js";
import { BOARD, CASE_SPAN, boxSize, type BoxSize, type ShelfFrame, type ShelfLook } from "./hero-shelf-layout.js";

export { SHELF_LOOK } from "./hero-shelf-layout.js";

/** Where the bookcase stands: its back to the left wall. */
export const CASE = { ...CASE_SPAN, back: -ROOM.HALF_WIDTH + 0.05 };

// ── The bookcase ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The bookcase: dark wood sides, top and shelves, a warmer back, and a strip of warm light under the front of each
 * shelf, the way a collector lights a cabinet, and a warm wash over the whole.
 */
export function buildCase(group: THREE.Group, layout: ShelfFrame) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.55 });
  const back = new THREE.MeshStandardMaterial({ color: 0x2a1b11, roughness: 0.85 });
  const strip = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc27a, emissiveIntensity: 2.2 });
  const { back: x0, z, width, depth } = CASE;
  const height = layout.top - layout.bottom;
  const midX = x0 + depth / 2;
  const add = (mesh: THREE.Mesh, shadows = true) => {
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  };
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, height, width + 0.5), back);
  panel.position.set(x0 + 0.04, layout.bottom + height / 2, z);
  add(panel);
  for (const side of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.1, height + 0.2, 0.28), wood);
    end.position.set(midX + 0.05, layout.bottom + (height + 0.2) / 2, z + side * (width / 2 + 0.14));
    add(end);
  }
  const lid = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.3, 0.26, width + 1.0), wood);
  lid.position.set(midX + 0.1, layout.top + 0.13, z);
  add(lid);
  // The top of each shelf's opening: the board above it, or the lid. A light strip runs under its front edge.
  const ceilings = layout.floors.map((_, i) => (i ? layout.floors[i - 1]! - BOARD : layout.top));
  layout.floors.forEach((floor, i) => {
    const board = new THREE.Mesh(new THREE.BoxGeometry(depth, BOARD, width), wood);
    board.position.set(midX, floor - BOARD / 2, z);
    add(board);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, width - 0.3), strip);
    light.position.set(x0 + depth - 0.22, ceilings[i]! - 0.02, z);
    add(light, false);
  });
  // A warm wash over the whole bookcase, and a softer light along its top.
  const glow = new THREE.PointLight(0xffd6a0, 14, 10, 1.6);
  glow.position.set(x0 + depth + 1.2, ceilings[0]! - 0.6, z);
  const wash = new THREE.SpotLight(0xffcf96, 240, 0, 0.62, 0.7, 1.6);
  wash.position.set(x0 + 11, layout.top + 6, z);
  wash.target.position.set(x0, (layout.top + layout.bottom) / 2, z);
  group.add(glow, wash, wash.target);
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

/** A box lying flat: its spine reads straight across, the aspect's colour at its left end. */
function flatPrint(hero: ShelfHero, lit: boolean): HTMLCanvasElement {
  const [cv, g] = canvas(288, 96);
  g.fillStyle = "#15110d";
  g.fillRect(0, 0, 288, 96);
  g.fillStyle = hex(aspectColour(hero));
  g.fillRect(0, 0, 18, 96);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f3eee3";
  const name = hero.name.toUpperCase();
  let size = 34;
  g.font = `900 ${size}px 'Public Sans', sans-serif`;
  while (size > 16 && g.measureText(name).width > 250) g.font = `900 ${--size}px 'Public Sans', sans-serif`;
  const twoLines = hero.alterEgo !== hero.name;
  g.fillText(name, 153, twoLines ? 38 : 48);
  if (twoLines) {
    g.fillStyle = "#b7ad9c";
    g.font = "700 18px 'Public Sans', sans-serif";
    g.fillText(hero.alterEgo, 153, 70, 250);
  }
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

/** The gold sticker on a favourite's box. */
function starPrint(): HTMLCanvasElement {
  const [cv, g] = canvas(96, 96);
  g.fillStyle = "#f2c230";
  g.beginPath();
  g.arc(48, 48, 46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3a2608";
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 14 : 34;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(48 + r * Math.cos(a), 50 + r * Math.sin(a));
  }
  g.fill();
  return cv;
}

export interface ShelfBox {
  readonly hero: ShelfHero;
  /** The table deals this hero. */
  readonly lit: boolean;
  readonly size: BoxSize;
  /** The box, standing at its middle; it moves when the shelf is sorted (`decks.ts`). */
  readonly mesh: THREE.Group;
  /** The favourite's sticker, shown on a favourite's box. */
  readonly star: THREE.Mesh;
}

/**
 * A deck box for every hero in the game, in the catalogue's order, not yet placed. Face-out boxes show the hero's
 * card, so their scans load first. Each box's body carries `userData.box`, its index, for the pointer to find it.
 */
export async function buildBoxes(group: THREE.Group, look: ShelfLook, lit: ReadonlySet<string>): Promise<ShelfBox[]> {
  const size = boxSize(look);
  const face = look === "faces";
  const scans = await Promise.all(SHELF_HEROES.map((hero) => (face ? loadImage(scanOf(hero)) : null)));
  const stockLit = new THREE.MeshStandardMaterial({ color: 0x15110d, roughness: 0.7 });
  const stockGrey = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.8 });
  const lidGrey = new THREE.MeshStandardMaterial({ color: 0x3b3936, roughness: 0.6 });
  const starMaterial = new THREE.MeshStandardMaterial({ map: texture(starPrint()), transparent: true, roughness: 0.4 });
  const starGeometry = new THREE.CircleGeometry(face ? 0.2 : 0.17, 28);
  return SHELF_HEROES.map((hero, i) => {
    const isLit = lit.has(hero.code);
    const stock = isLit ? stockLit : stockGrey;
    const lid = isLit ? new THREE.MeshStandardMaterial({ color: aspectColour(hero), roughness: 0.5 }) : lidGrey;
    const print = face ? frontPrint(hero, scans[i] ?? null, isLit) : flatPrint(hero, isLit);
    // The lit boxes glow softly from their own print; the faded ones are dimmed further than the print's own greying.
    const map = texture(print);
    const show = new THREE.MeshStandardMaterial({
      map,
      roughness: isLit ? 0.5 : 0.8,
      color: isLit ? 0xffffff : 0x7a7a7a,
      ...(isLit ? { emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.28 } : {}),
    });
    // Its showing side faces the room (+x): +x, -x, +y, -y, +z, -z. A flat box's top is its big back, plain stock.
    const top = face ? lid : stock;
    const body = new THREE.Mesh(new THREE.BoxGeometry(size.deep, size.tall, size.across), [
      show,
      stock,
      top,
      stock,
      stock,
      stock,
    ]);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.box = i;
    // The favourite's sticker, on the front's top right corner (the reader's right is -z).
    const star = new THREE.Mesh(starGeometry, starMaterial);
    star.rotation.y = Math.PI / 2;
    star.position.set(size.deep / 2 + 0.006, face ? size.tall / 2 - 0.26 : 0, -size.across / 2 + (face ? 0.26 : 0.24));
    star.visible = false;
    const mesh = new THREE.Group();
    mesh.add(body, star);
    mesh.visible = false;
    group.add(mesh);
    return { hero, lit: isLit, size, mesh, star };
  });
}
