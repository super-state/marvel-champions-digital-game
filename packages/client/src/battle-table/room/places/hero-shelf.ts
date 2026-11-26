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

/** Fits a line of text to a width by stepping its size down. */
function fit(g: CanvasRenderingContext2D, text: string, weight: number, size: number, width: number) {
  g.font = `${weight} ${size}px 'Public Sans', sans-serif`;
  while (size > 12 && g.measureText(text).width > width) g.font = `${weight} ${--size}px 'Public Sans', sans-serif`;
}

const ASPECT_LABEL: Record<string, string> = {
  justice: "Justice",
  leadership: "Leadership",
  aggression: "Aggression",
  protection: "Protection",
  pool: "'Pool",
};

/**
 * A deck box's front, printed as a box is: a frame in the aspect's colour, "Hero deck" across the lid, the hero's art in
 * a window (cut from their card), their name on a banner, and the deck along the foot.
 */
function frontPrint(hero: ShelfHero, scan: HTMLImageElement | null, lit: boolean): HTMLCanvasElement {
  const [cv, g] = canvas(400, 560);
  const colour = hex(aspectColour(hero));
  g.fillStyle = colour;
  g.fillRect(0, 0, 400, 560);
  const inner = g.createLinearGradient(0, 0, 0, 560);
  inner.addColorStop(0, "#1d1712");
  inner.addColorStop(1, "#0c0906");
  g.fillStyle = inner;
  g.fillRect(12, 12, 376, 536);
  // The lid's band.
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = colour;
  g.font = "800 22px 'Public Sans', sans-serif";
  g.fillText("H E R O   D E C K", 200, 48);
  g.fillRect(40, 74, 320, 3);
  // The art window: the top of the hero's card, under its title.
  g.fillStyle = colour;
  g.fillRect(22, 92, 356, 252);
  if (scan) {
    const w = scan.naturalWidth || scan.width;
    const h = scan.naturalHeight || scan.height;
    // Clear of the stat badges down its left side and the title above.
    g.drawImage(scan, w * 0.2, h * 0.1, w * 0.78, h * 0.39, 26, 96, 348, 244);
  } else {
    g.fillStyle = "#2a221a";
    g.fillRect(26, 96, 348, 244);
  }
  // The name banner.
  g.fillStyle = "#f3eee3";
  const name = hero.name.toUpperCase();
  fit(g, name, 900, 46, 350);
  g.fillText(name, 200, 392);
  if (hero.alterEgo !== hero.name) {
    g.fillStyle = "#b7ad9c";
    fit(g, hero.alterEgo, 700, 24, 340);
    g.fillText(hero.alterEgo, 200, 436);
  }
  // The deck, along the foot.
  g.fillStyle = colour;
  g.fillRect(12, 488, 376, 60);
  g.fillStyle = "#120d08";
  const aspect = ASPECT_LABEL[hero.aspect ?? ""];
  fit(g, `STARTER DECK${aspect ? ` · ${aspect.toUpperCase()}` : ""}`, 800, 22, 340);
  g.fillText(`STARTER DECK${aspect ? ` · ${aspect.toUpperCase()}` : ""}`, 200, 519);
  if (!lit) greyOut(cv);
  return cv;
}

/** A deck box's side: the aspect's colour, the hero's name running up it. */
function sidePrint(hero: ShelfHero, lit: boolean): HTMLCanvasElement {
  const [cv, g] = canvas(140, 416);
  g.fillStyle = hex(aspectColour(hero));
  g.fillRect(0, 0, 140, 416);
  g.fillStyle = "#120d08";
  g.fillRect(0, 0, 140, 8);
  g.fillRect(0, 408, 140, 8);
  g.save();
  g.translate(70, 208);
  g.rotate(-Math.PI / 2);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#120d08";
  const name = hero.name.toUpperCase();
  fit(g, name, 900, 44, 370);
  g.fillText(name, 0, 2);
  g.restore();
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
 * How tall a face-out deck box's lid is: it sits over the top of the box, a touch bigger, so its seam shows. The seam
 * runs just above the art window (`frontPrint`: the window starts 92 of the print's 560 down), never through it.
 */
const LID = 0.44;

/** A face-out deck box: the box, and its lid over the top, both printed. Every part answers the pointer as box `i`. */
function deckBox(size: BoxSize, front: THREE.Texture, side: THREE.Texture, lit: boolean, colour: number, i: number) {
  const shade = lit ? 0xffffff : 0x7a7a7a;
  const glow = (map: THREE.Texture) =>
    lit ? { emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.22 } : ({} as Record<string, never>);
  const print = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({ map, roughness: lit ? 0.45 : 0.8, color: shade, ...glow(map) });
  const stock = new THREE.MeshStandardMaterial({ color: lit ? 0x15110d : 0x1a1816, roughness: 0.7 });
  const top = new THREE.MeshStandardMaterial({ color: lit ? colour : 0x3b3936, roughness: 0.5 });
  const sides = print(side);
  // The box: +x (the front), -x, +y, -y, +z, -z.
  const body = new THREE.Mesh(new THREE.BoxGeometry(size.deep, size.tall, size.across), [
    print(front),
    stock,
    stock,
    stock,
    sides,
    sides,
  ]);
  // The lid shows the top of the same front and sides.
  const crop = (map: THREE.Texture) => {
    const part = map.clone();
    part.repeat.set(1, LID / size.tall);
    part.offset.set(0, 1 - LID / size.tall);
    part.needsUpdate = true;
    return part;
  };
  const lidSides = print(crop(side));
  const lid = new THREE.Mesh(new THREE.BoxGeometry(size.deep + 0.05, LID, size.across + 0.05), [
    print(crop(front)),
    stock,
    top,
    stock,
    lidSides,
    lidSides,
  ]);
  lid.position.y = size.tall / 2 - LID / 2 + 0.025;
  for (const part of [body, lid]) {
    part.castShadow = part.receiveShadow = true;
    part.userData.box = i;
  }
  return [body, lid];
}

/**
 * A deck box for every hero in the game, in the catalogue's order, not yet placed. Face-out, each is a printed deck
 * box with its lid (their art loads first); in the spines look, a box lying flat with its spine out. Each part carries
 * `userData.box`, its index, for the pointer to find it.
 */
export async function buildBoxes(group: THREE.Group, look: ShelfLook, lit: ReadonlySet<string>): Promise<ShelfBox[]> {
  const size = boxSize(look);
  const face = look === "faces";
  const scans = await Promise.all(SHELF_HEROES.map((hero) => (face ? loadImage(scanOf(hero)) : null)));
  const stockLit = new THREE.MeshStandardMaterial({ color: 0x15110d, roughness: 0.7 });
  const stockGrey = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.8 });
  const starMaterial = new THREE.MeshStandardMaterial({ map: texture(starPrint()), transparent: true, roughness: 0.4 });
  const starGeometry = new THREE.CircleGeometry(face ? 0.22 : 0.17, 28);
  return SHELF_HEROES.map((hero, i) => {
    const isLit = lit.has(hero.code);
    let parts: THREE.Mesh[];
    if (face) {
      parts = deckBox(
        size,
        texture(frontPrint(hero, scans[i] ?? null, isLit)),
        texture(sidePrint(hero, isLit)),
        isLit,
        aspectColour(hero),
        i,
      );
    } else {
      const stock = isLit ? stockLit : stockGrey;
      const map = texture(flatPrint(hero, isLit));
      const show = new THREE.MeshStandardMaterial({
        map,
        roughness: isLit ? 0.5 : 0.8,
        color: isLit ? 0xffffff : 0x7a7a7a,
        ...(isLit ? { emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.28 } : {}),
      });
      const body = new THREE.Mesh(new THREE.BoxGeometry(size.deep, size.tall, size.across), [
        show,
        stock,
        stock,
        stock,
        stock,
        stock,
      ]);
      body.castShadow = body.receiveShadow = true;
      body.userData.box = i;
      parts = [body];
    }
    // The favourite's sticker, on the front's top right corner (the reader's right is -z): face-out, on the art window, under the lid.
    const star = new THREE.Mesh(starGeometry, starMaterial);
    star.rotation.y = Math.PI / 2;
    star.position.set(
      size.deep / 2 + (face ? 0.008 : 0.006),
      face ? size.tall / 2 - 0.78 : 0,
      -size.across / 2 + (face ? 0.32 : 0.24),
    );
    star.visible = false;
    const mesh = new THREE.Group();
    mesh.add(...parts, star);
    mesh.visible = false;
    group.add(mesh);
    return { hero, lit: isLit, size, mesh, star };
  });
}
