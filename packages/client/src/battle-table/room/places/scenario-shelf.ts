/**
 * The scenario shelf: Campaign's first step (Adam, 2026-11-27: "you pick your scenario from a shelf ... boxes of
 * different size, scenario packs, and the bigger packs; inside will be the scenarios in that set"). A bookcase on the
 * back wall, right of the sideboard, with every box that has scenarios in it (`scenario-catalogue.ts`), face-out in
 * the order they came out (`scenario-shelf-layout.ts`): the Core Set and the campaign boxes big and square, the
 * scenario packs smaller. The boxes the table can deal from are lit; the rest stand among them, faded.
 *
 * Pointing at a box eases it out; let go, it snaps back. Picking one brings it up close as the hero shelf's boxes come
 * (`close-up.ts`), the shelf dimmed behind: its lid lifts away and the scenarios inside rise, a villain card each, with
 * a card beside listing them. Picking a scenario the table deals hands it to Campaign (`campaign.ts`), which takes it to
 * the table; a sealed one says what opens it. A click off the box, Back (above the card), Escape or B puts it back.
 *
 * Every choice is a real button (mouse, touch, the arrows, a pad): a see-through button over each box, and the card's
 * buttons while one is up close.
 */
import * as THREE from "three";
import { camera, setPose, type Pose } from "../camera.js";
import { CAMPAIGN_ART } from "../../../art/campaign-art.js";
import { canvas, loadImage, texture } from "../canvas.js";
import { ROOM, pointer, raycaster, renderer, say, scene } from "../room.js";
import { spatialPick, type FocusDirection } from "../../pad/spatial.js";
import { FLY, closeSpot, flyUp, sway, type Facing } from "./close-up.js";
import { SHELF_PRODUCTS, type ShelfProduct, type ShelfScenario } from "./scenario-catalogue.js";
import { BOARD, SCENARIO_CASE, layoutScenarios, measureOf, type ProductMeasure } from "./scenario-shelf-layout.js";
import "./scenario-shelf.css";

const CARDS = "/card-art/bundles/cards/";
/** The bookcase's back against the back wall; its foot on a low cupboard, clear of the games table's far edge. */
const BACK = ROOM.BACK + 0.02;
const FOOT = 0.6;
const layout = layoutScenarios(SHELF_PRODUCTS, { back: BACK, bottom: FOOT });
/** The shelf faces the room (+z); the reader's left is -x. */
const FACING: Facing = { out: new THREE.Vector3(0, 0, 1), left: new THREE.Vector3(-1, 0, 0) };
/** On the shelf a box is turned a quarter round, its right-hand side (the spine, printed) to the room. */
const SPINE_TURN = -Math.PI / 2;

/** How a scenario stands for this player: one the table deals, sealed with a reason, or not on the table yet. */
export interface ScenarioState {
  readonly playable: boolean;
  readonly lock: string | null;
}

export interface ScenarioShelfHooks {
  state(scenario: ShelfScenario): ScenarioState;
  /** A scenario the table deals, picked. */
  pick(scenario: ShelfScenario): void;
}

// ── Prints ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Each release's colours: the box's ground, and its accent. */
const CYCLE_COLOURS: Record<string, readonly [string, string]> = {
  core: ["#1d2a4a", "#e8c33a"],
  wave1: ["#203b26", "#9fdc5a"],
  cycle1: ["#3a1214", "#e6463a"],
  cycle3: ["#1c1840", "#53c6e8"],
  cycle4: ["#2a1640", "#c48af0"],
  cycle5: ["#121a2a", "#e84a6a"],
  cycle6: ["#202020", "#f2c230"],
  cycle7: ["#14262e", "#5ae0c8"],
  cycle8: ["#2e1408", "#f07a2a"],
  cycle9: ["#0e1a2c", "#7aa8ff"],
  cycle10: ["#2a1010", "#f0e6d0"],
  cycle11: ["#180c1e", "#d23a3a"],
};
const coloursOf = (product: ShelfProduct) => CYCLE_COLOURS[product.cycle] ?? ["#222", "#ccc"];

/** A front print's size in pixels: `long` along the box's longer side, the other in proportion. */
function printSize(product: ShelfProduct, long: number): [number, number] {
  const { across, tall } = measureOf(product);
  return across >= tall ? [long, Math.round((long * tall) / across)] : [Math.round((long * across) / tall), long];
}

function fit(g: CanvasRenderingContext2D, text: string, font: (size: number) => string, size: number, width: number) {
  g.font = font(size);
  while (size > 12 && g.measureText(text).width > width) g.font = font(--size);
}

/** A box's own art, kept with its campaign's pictures (`art/campaigns/<folder>/`), where the folder isn't its code. */
const ART_FOLDER: Record<string, string> = { cw: "civil_war" };

/**
 * The box's real front, where there is one (Adam, 2026-11-27: "they should be the actual products"): its rulebook's
 * cover, which is the box's front with its title (`rulebook/page_001`); else its key art (`cover.*`), with the title
 * printed on; else nothing, and the box prints its first villain's art.
 */
function boxArtUrl(product: ShelfProduct): { url: string; titled: boolean; cut: number } | null {
  const folder = ART_FOLDER[product.code] ?? product.code;
  // The box's own front as sold, where there is one (`box.*`, the Core Set's and the scenario packs').
  const box = CAMPAIGN_ART.boxes.get(folder);
  if (box) return { url: box.url, titled: true, cut: 0 };
  const rulebook = CAMPAIGN_ART.rulebookPages.get(`${folder}/page_001`);
  // A rulebook's cover is the box's front with a small "Rulebook" tab at its foot: cut just above it.
  if (rulebook) return { url: rulebook.url, titled: true, cut: 0.075 };
  const cover = CAMPAIGN_ART.covers.get(folder);
  return cover ? { url: cover.url, titled: false, cut: 0 } : null;
}

/** Cover-fits a picture into a rectangle, cropping what overflows (around its middle, or `focusY` down). */
function coverFit(
  g: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  focusY = 0.5,
  bottomCut = 0,
) {
  const iw = image.naturalWidth || image.width;
  const ih = (image.naturalHeight || image.height) * (1 - bottomCut);
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  g.drawImage(image, (iw - sw) / 2, (ih - sh) * focusY, sw, sh, x, y, w, h);
}

/** A box's front from its own art: the rulebook's cover as it is, or the key art with the title across the foot. */
function artPrint(
  product: ShelfProduct,
  art: HTMLImageElement,
  titled: boolean,
  cut: number,
  lit: boolean,
): HTMLCanvasElement {
  const big = product.size === "big";
  const [w, h] = printSize(product, 512);
  const [cv, g] = canvas(w, h);
  coverFit(g, art, 0, 0, w, h, 0.5, cut);
  if (!titled) {
    const [ground, accent] = coloursOf(product);
    const fade = g.createLinearGradient(0, h * 0.62, 0, h);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, ground);
    g.fillStyle = fade;
    g.fillRect(0, h * 0.62, w, h * 0.38);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#f6f0e2";
    g.shadowColor = "rgba(0,0,0,0.8)";
    g.shadowBlur = 8;
    g.font = "900 24px 'Public Sans', sans-serif";
    g.fillText("MARVEL CHAMPIONS", w / 2, 34);
    const name = product.name.toUpperCase();
    fit(g, name, (size) => `${size}px Bangers, 'Public Sans', sans-serif`, big ? 70 : 56, w - 40);
    g.fillStyle = accent;
    g.fillText(name, w / 2, h - 64);
    g.shadowBlur = 0;
  }
  return lit ? cv : faded(cv);
}

/** A box's side from its own art: a strip of it, darkened, the box's name running up it. */
function artSidePrint(product: ShelfProduct, art: HTMLImageElement, lit: boolean): HTMLCanvasElement {
  const [cv, g] = canvas(96, 384);
  coverFit(g, art, 0, 0, 96, 384, 0.4);
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fillRect(0, 0, 96, 384);
  g.save();
  g.translate(48, 192);
  g.rotate(-Math.PI / 2);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f6f0e2";
  const name = product.name.toUpperCase();
  fit(g, name, (size) => `${size}px Bangers, 'Public Sans', sans-serif`, 44, 350);
  g.fillText(name, 0, 2);
  g.restore();
  return lit ? cv : faded(cv);
}

/** A box's front: its release's colours, the first villain's art filling it, and the box's name across the foot. */
function frontPrint(product: ShelfProduct, art: HTMLImageElement | null, lit: boolean): HTMLCanvasElement {
  const big = product.size === "big";
  const [w, h] = printSize(product, 384);
  const [cv, g] = canvas(w, h);
  const [ground, accent] = coloursOf(product);
  g.fillStyle = ground;
  g.fillRect(0, 0, w, h);
  if (art) {
    // The villain card's art, clear of its title bar and its text box.
    const aw = art.naturalWidth || art.width;
    const ah = art.naturalHeight || art.height;
    const sw = aw * 0.8;
    const sh = Math.min(ah * 0.5, (sw * (h - 112)) / w);
    g.drawImage(art, aw * 0.1, ah * 0.1, sw, sh, 0, 0, w, h - 112);
  }
  const fade = g.createLinearGradient(0, h - 195, 0, h - 112);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, ground);
  g.fillStyle = fade;
  g.fillRect(0, h - 195, w, 83);
  g.fillStyle = ground;
  g.fillRect(0, h - 112, w, 112);
  g.fillStyle = accent;
  g.fillRect(0, h - 112, w, 6);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f6f0e2";
  const name = product.name.toUpperCase();
  fit(g, name, (s) => `${s}px Bangers, 'Public Sans', sans-serif`, big ? 48 : 40, w - 30);
  g.fillText(name, w / 2, h - 69);
  g.fillStyle = accent;
  const count = product.scenarios.length;
  g.font = "800 17px 'Public Sans', sans-serif";
  g.fillText(
    `${big ? (product.code === "core" ? "CORE SET" : "CAMPAIGN") : "SCENARIO PACK"} · ${count} ${count === 1 ? "SCENARIO" : "SCENARIOS"}`,
    w / 2,
    h - 40,
    w - 40,
  );
  // A frame.
  g.strokeStyle = accent;
  g.lineWidth = 8;
  g.strokeRect(4, 4, w - 8, h - 8);
  return lit ? cv : faded(cv);
}

/** A box's side: its colours, its name running up it. */
function sidePrint(product: ShelfProduct, lit: boolean): HTMLCanvasElement {
  const [cv, g] = canvas(96, 384);
  const [ground, accent] = coloursOf(product);
  g.fillStyle = ground;
  g.fillRect(0, 0, 96, 384);
  g.fillStyle = accent;
  g.fillRect(0, 0, 96, 8);
  g.fillRect(0, 376, 96, 8);
  g.save();
  g.translate(48, 192);
  g.rotate(-Math.PI / 2);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f6f0e2";
  const name = product.name.toUpperCase();
  fit(g, name, (s) => `${s}px Bangers, 'Public Sans', sans-serif`, 44, 350);
  g.fillText(name, 0, 2);
  g.restore();
  return lit ? cv : faded(cv);
}

/** A scenario's card in the box: its villain's card, greyed when the table doesn't deal it. */
function scenarioPrint(scan: HTMLImageElement | null, scenario: ShelfScenario, lit: boolean): HTMLCanvasElement {
  const [cv, g] = canvas(300, 420);
  if (scan) g.drawImage(scan, 0, 0, 300, 420);
  else {
    g.fillStyle = "#1b1612";
    g.fillRect(0, 0, 300, 420);
    g.fillStyle = "#f3eee3";
    g.textAlign = "center";
    g.font = "900 30px 'Public Sans', sans-serif";
    g.fillText(scenario.name.toUpperCase(), 150, 210, 270);
  }
  return lit ? cv : faded(cv);
}

/**
 * A print greyed and dimmed, for a box the table doesn't deal from yet: by the canvas's own filter, which costs next to
 * nothing (greying pixel by pixel, for every box as the room opened, stalled the title's frames).
 */
function faded(print: HTMLCanvasElement): HTMLCanvasElement {
  const [out, g] = canvas(print.width, print.height);
  g.filter = "grayscale(0.88) brightness(0.72)";
  g.drawImage(print, 0, 0);
  return out;
}

/**
 * Loads a picture and has the browser decode it off the page's thread: the box fronts are big (up to 2000 pixels), and
 * decoding one as it was first drawn stalled the title's frames (a pad's press then read as held, and repeated).
 */
async function loadDecoded(url: string): Promise<HTMLImageElement | null> {
  const image = await loadImage(url);
  await image?.decode().catch(() => undefined);
  return image;
}

// ── The bookcase ──────────────────────────────────────────────────────────────────────────────────────────────────

function buildCase(group: THREE.Group) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.55 });
  const backing = new THREE.MeshStandardMaterial({ color: 0x2a1b11, roughness: 0.85 });
  const strip = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc27a, emissiveIntensity: 2.2 });
  const { x, width, depth } = SCENARIO_CASE;
  const { top, bottom, floors } = layout;
  const height = top - bottom;
  const midZ = BACK + depth / 2;
  const add = (mesh: THREE.Mesh, shadows = true) => {
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  };
  // The low cupboard it stands on, down to the floor.
  const cupboard = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, bottom - ROOM.FLOOR, depth + 0.3), wood);
  cupboard.position.set(x, (bottom + ROOM.FLOOR) / 2, midZ + 0.1);
  add(cupboard);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, height, 0.08), backing);
  panel.position.set(x, bottom + height / 2, BACK + 0.04);
  add(panel);
  for (const side of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.BoxGeometry(0.28, height + 0.2, depth + 0.1), wood);
    end.position.set(x + side * (width / 2 + 0.14), bottom + (height + 0.2) / 2, midZ + 0.05);
    add(end);
  }
  const lid = new THREE.Mesh(new THREE.BoxGeometry(width + 1.0, 0.26, depth + 0.3), wood);
  lid.position.set(x, top + 0.13, midZ + 0.1);
  add(lid);
  const ceilings = floors.map((_, i) => (i ? floors[i - 1]! - BOARD : top));
  floors.forEach((floor, i) => {
    const board = new THREE.Mesh(new THREE.BoxGeometry(width, BOARD, depth), wood);
    board.position.set(x, floor - BOARD / 2, midZ);
    add(board);
    const light = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.035, 0.06), strip);
    light.position.set(x, ceilings[i]! - 0.02, BACK + depth - 0.22);
    add(light, false);
  });
  const glow = new THREE.PointLight(0xffd6a0, 16, 12, 1.6);
  glow.position.set(x, top - 1.2, BACK + depth + 1.4);
  const wash = new THREE.SpotLight(0xffcf96, 260, 0, 0.6, 0.7, 1.6);
  wash.position.set(x, top + 5, BACK + 11);
  wash.target.position.set(x, (top + bottom) / 2, BACK);
  group.add(glow, wash, wash.target);
}

// ── The boxes ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Box {
  readonly product: ShelfProduct;
  readonly size: ProductMeasure;
  /** The table deals something in it. */
  readonly lit: boolean;
  readonly mesh: THREE.Group;
  readonly lid: THREE.Group;
  readonly home: THREE.Vector3;
  readonly button: HTMLButtonElement;
  /** Its scenarios' cards, made the first time it opens. */
  cards: THREE.Mesh[] | null;
  out: number;
  fly: number;
  swayed: number;
  /** How far its lid is off and its scenarios up (0 to 1). */
  open: number;
  wasUp: boolean;
}

/** The lid runs nearly the box's whole depth, so a box spine-out shows its printed side, not its tray. */
const LID_SHARE = 0.94;

function buildBox(
  product: ShelfProduct,
  size: ProductMeasure,
  lit: boolean,
  art: HTMLImageElement | null,
  own: { image: HTMLImageElement; titled: boolean; cut: number } | null,
  i: number,
) {
  const [ground] = coloursOf(product);
  const shade = lit ? 0xffffff : 0x7a7a7a;
  const stock = new THREE.MeshStandardMaterial({
    color: new THREE.Color(ground).multiplyScalar(lit ? 0.8 : 0.35),
    roughness: 0.7,
  });
  const front = texture(own ? artPrint(product, own.image, own.titled, own.cut, lit) : frontPrint(product, art, lit));
  const side = texture(own ? artSidePrint(product, own.image, lit) : sidePrint(product, lit));
  const printed = (map: THREE.Texture) =>
    new THREE.MeshStandardMaterial({
      map,
      roughness: lit ? 0.45 : 0.8,
      color: shade,
      ...(lit ? { emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.2 } : {}),
    });
  const sides = printed(side);
  const mesh = new THREE.Group();
  const { across, tall, deep } = size;
  // The tray: four walls and a floor at the back, a touch smaller than the lid so the lid's edge shows round it; the
  // scenarios lie on its floor.
  const tray = new THREE.Group();
  const tw = across - 0.04;
  const th = tall - 0.04;
  const td = deep - 0.02;
  const trayWall = (w: number, h: number, px: number, py: number) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, td), stock);
    part.position.set(px, py, -0.01);
    part.castShadow = part.receiveShadow = true;
    tray.add(part);
  };
  trayWall(0.03, th, tw / 2 - 0.015, 0);
  trayWall(0.03, th, -tw / 2 + 0.015, 0);
  trayWall(tw, 0.03, 0, th / 2 - 0.015);
  trayWall(tw, 0.03, 0, -th / 2 + 0.015);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(tw, th, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x15110c, roughness: 0.9 }),
  );
  floor.position.z = -deep / 2 + 0.015;
  tray.add(floor);
  // The lid: a printed front and four walls running back over the tray.
  const lid = new THREE.Group();
  const lidDeep = deep * LID_SHARE;
  const wall = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material | THREE.Material[],
    px: number,
    py: number,
    pz: number,
  ) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    part.position.set(px, py, pz);
    part.castShadow = part.receiveShadow = true;
    lid.add(part);
  };
  wall(across, tall, 0.03, [stock, stock, stock, stock, printed(front), stock], 0, 0, deep / 2 - 0.015);
  wall(0.03, tall, lidDeep, [sides, stock, stock, stock, stock, stock], across / 2 - 0.015, 0, deep / 2 - lidDeep / 2);
  wall(0.03, tall, lidDeep, [stock, sides, stock, stock, stock, stock], -across / 2 + 0.015, 0, deep / 2 - lidDeep / 2);
  wall(across, 0.03, lidDeep, stock, 0, tall / 2 - 0.015, deep / 2 - lidDeep / 2);
  wall(across, 0.03, lidDeep, stock, 0, -tall / 2 + 0.015, deep / 2 - lidDeep / 2);
  mesh.add(tray, lid);
  mesh.traverse((o) => (o.userData.box = i));
  return { mesh, lid, maps: [front, side] };
}

/** The scenarios in a box, laid on its tray's floor in rows, a villain card each. */
/**
 * Where a scenario's card floats once it has come out of its box up close: to the box's right, in columns of three, a
 * little in front of it, big enough to read (Adam, 2026-11-27: "the villain decks come out to the side ... click them
 * as they float").
 */
function floatSpot(box: Box, i: number): THREE.Vector3 {
  const { across, deep } = box.size;
  const n = box.product.scenarios.length;
  const perColumn = n <= 3 ? n : Math.ceil(n / 2);
  const column = Math.floor(i / perColumn);
  const inColumn = Math.min(perColumn, n - column * perColumn);
  const row = i % perColumn;
  const w = FLOAT_W;
  const h = w / 0.715;
  return new THREE.Vector3(
    across / 2 + 0.4 + column * (w + 0.14) + w / 2,
    ((inColumn - 1) / 2 - row) * (h + 0.12),
    deep / 2 + 0.25,
  );
}
/** A floating scenario card's width (a card is 0.715 as wide as it is tall). */
const FLOAT_W = 0.88;

async function buildCards(box: Box, state: (s: ShelfScenario) => ScenarioState): Promise<THREE.Mesh[]> {
  const { across, tall, deep } = box.size;
  const n = box.product.scenarios.length;
  const perRow = n <= 3 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / perRow);
  const gap = 0.07;
  const cardW = Math.min(
    (across - 0.2 - gap * (perRow - 1)) / perRow,
    ((tall - 0.2 - gap * (rows - 1)) / rows) * 0.715,
  );
  const cardH = cardW / 0.715;
  const scans = await Promise.all(box.product.scenarios.map((s) => (s.scan ? loadImage(`${CARDS}${s.scan}`) : null)));
  return box.product.scenarios.map((scenario, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i % perRow;
    const lit = state(scenario).playable;
    const map = texture(scenarioPrint(scans[i] ?? null, scenario, lit));
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(cardW, cardH),
      new THREE.MeshStandardMaterial({
        map,
        roughness: 0.4,
        ...(lit ? { emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.18 } : { color: 0x9a9a9a }),
      }),
    );
    card.position.set(
      (col - (inRow - 1) / 2) * (cardW + gap),
      ((rows - 1) / 2 - row) * (cardH + gap),
      -deep / 2 + 0.036,
    );
    card.userData.box = box.mesh.userData.box;
    card.userData.scenario = i;
    card.userData.rest = card.position.clone();
    card.userData.float = floatSpot(box, i);
    card.userData.grow = FLOAT_W / cardW;
    box.mesh.add(card);
    return card;
  });
}

// ── The shelf's state ─────────────────────────────────────────────────────────────────────────────────────────────

const boxes: Box[] = [];
let hooks: ScenarioShelfHooks | null = null;
let group: THREE.Group | null = null;
let veil: THREE.Mesh | null = null;
let active = false;
let hovered = -1;
/** The scenario card pointed at (or focused) in the box up close; -1 for none. */
let hoveredCard = -1;
/** The box up close, while its card is open. */
let opened: Box | null = null;
const closeAt = new THREE.Vector3();

let picks: HTMLElement | null = null;
let card: HTMLElement | null = null;
let backBar: HTMLElement | null = null;
let tag: HTMLElement | null = null;
let hint: HTMLElement | null = null;

const upClose = () => !!opened && !!card && !card.hidden;

function el<K extends keyof HTMLElementTagNameMap>(name: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function lineFor(scenario: ShelfScenario, state: ScenarioState): string {
  if (state.playable) return "";
  return state.lock ?? "Not on the table yet";
}

/** The card beside a box up close: its name, and a button for each scenario inside. */
function paint(focusKey?: string) {
  if (!card || !opened || !hooks) return;
  const box = opened;
  const head = el("div", "scn-card-head");
  head.append(el("h3", "scn-title", box.product.name));
  const count = box.product.scenarios.length;
  head.append(
    el(
      "p",
      "scn-who",
      box.lit ? `Pick a scenario · ${count} inside` : `${count} ${count === 1 ? "scenario" : "scenarios"} inside`,
    ),
  );
  const list = el("div", "scn-list");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", `${box.product.name}'s scenarios`);
  box.product.scenarios.forEach((scenario, i) => {
    const state = hooks!.state(scenario);
    const button = el("button", `btn ${state.playable ? "btn-primary" : "btn-secondary"} scn-pick`);
    button.type = "button";
    button.dataset.scn = `scenario:${scenario.id}`;
    if (!state.playable) button.setAttribute("aria-disabled", "true");
    button.append(el("strong", "", scenario.name));
    const why = lineFor(scenario, state);
    if (why) button.append(el("small", "", why));
    button.onclick = () => choose(i);
    button.onfocus = () => (hoveredCard = i);
    button.onblur = () => {
      if (hoveredCard === i) hoveredCard = -1;
    };
    list.append(button);
  });
  const parts: HTMLElement[] = [head, list];
  if (!box.lit) parts.push(el("p", "scn-line", "Not on the table yet: these come later."));
  card.replaceChildren(...parts);
  card.hidden = false;
  // The boxes behind are out of reach while one is up close: a pad's D-pad stays on the card.
  if (picks) picks.inert = true;
  if (backBar) backBar.hidden = false;
  if (hint) hint.hidden = true;
  const first = box.product.scenarios.findIndex((s) => hooks!.state(s).playable);
  const key = focusKey ?? `scenario:${box.product.scenarios[Math.max(0, first)]!.id}`;
  card.querySelector<HTMLElement>(`[data-scn="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

/** A scenario picked in the box up close. */
function choose(i: number) {
  if (!opened || !hooks) return;
  const scenario = opened.product.scenarios[i]!;
  const state = hooks.state(scenario);
  if (!state.playable) {
    say(state.lock ? `${scenario.name} is locked. ${state.lock}.` : `${scenario.name} isn't on the table yet.`);
    return;
  }
  hooks.pick(scenario);
}

function pickBox(box: Box) {
  opened = box;
  hovered = -1;
  hoveredCard = -1;
  if (!box.cards && hooks) {
    const forBox = box;
    void buildCards(forBox, hooks.state).then((cards) => (forBox.cards = cards));
  }
  paint();
}

/** Puts the box back on its shelf; the focus goes back to it. */
export function closeBox(refocus = true) {
  if (!card) return;
  card.hidden = true;
  if (picks) picks.inert = false;
  if (backBar) backBar.hidden = true;
  if (hint) hint.hidden = false;
  hoveredCard = -1;
  if (refocus && opened) opened.button.focus({ preventScroll: true });
}

/** Opens a box up close at once (Campaign's Back from the table returns here). */
export function reopen(code: string) {
  const box = boxes.find((each) => each.product.code === code);
  if (box) pickBox(box);
}

// ── The pointer ───────────────────────────────────────────────────────────────────────────────────────────────────

function hitAt(x: number, y: number): THREE.Intersection | undefined {
  pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(
    boxes.map((box) => box.mesh),
    true,
  )[0];
}

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!active) return;
  const hit = hitAt(event.clientX, event.clientY);
  if (upClose()) {
    hovered = -1;
    const onCard =
      hit &&
      opened &&
      hit.object.userData.box === opened.mesh.userData.box &&
      hit.object.userData.scenario !== undefined;
    hoveredCard = onCard ? (hit.object.userData.scenario as number) : -1;
    renderer.domElement.style.cursor = hoveredCard >= 0 ? "pointer" : "default";
    return;
  }
  hovered = hit ? (hit.object.userData.box as number) : -1;
  renderer.domElement.style.cursor = hovered >= 0 ? "pointer" : "default";
});
renderer.domElement.addEventListener("pointerleave", () => {
  if (!active) return;
  hovered = -1;
  if (upClose()) hoveredCard = -1;
});
renderer.domElement.addEventListener("click", (event) => {
  if (!active) return;
  const hit = hitAt(event.clientX, event.clientY);
  if (upClose()) {
    // A scenario's card in the box up close picks it; a click anywhere off the box is a step back, never another box.
    const inBox = hit && opened && hit.object.userData.box === opened.mesh.userData.box;
    if (inBox && hit.object.userData.scenario !== undefined) choose(hit.object.userData.scenario as number);
    else if (!inBox) closeBox();
    return;
  }
  const box = hit ? boxes[hit.object.userData.box as number] : undefined;
  if (box) pickBox(box);
});

// ── Each frame ────────────────────────────────────────────────────────────────────────────────────────────────────

const corner = new THREE.Vector3();
function screenRect(box: Box) {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const { across, tall, deep } = box.size;
  box.mesh.updateMatrixWorld();
  for (const x of [-across / 2, across / 2])
    for (const y of [-tall / 2, tall / 2])
      for (const z of [-deep / 2, deep / 2]) {
        corner.set(x, y, z).applyMatrix4(box.mesh.matrixWorld).project(camera);
        const px = ((corner.x + 1) / 2) * innerWidth;
        const py = ((1 - corner.y) / 2) * innerHeight;
        left = Math.min(left, px);
        right = Math.max(right, px);
        top = Math.min(top, py);
        bottom = Math.max(bottom, py);
      }
  return { left, right, top, bottom };
}

function placePicks() {
  for (const box of boxes) {
    const r = screenRect(box);
    const style = box.button.style;
    style.left = `${r.left}px`;
    style.top = `${r.top}px`;
    style.width = `${Math.max(1, r.right - r.left)}px`;
    style.height = `${Math.max(1, r.bottom - r.top)}px`;
  }
}

let tagText = "";
function placeTag() {
  if (!tag) return;
  const box = boxes[hovered];
  if (!active || !box || upClose()) {
    tag.hidden = true;
    return;
  }
  const count = box.product.scenarios.length;
  const text = `${box.product.name} · ${count} ${count === 1 ? "scenario" : "scenarios"}${box.lit ? "" : " · not on the table yet"}`;
  if (text !== tagText || tag.hidden) {
    tag.textContent = tagText = text;
    tag.hidden = false;
  }
  const r = screenRect(box);
  const half = tag.offsetWidth / 2 + 8;
  tag.style.left = `${Math.min(innerWidth - half, Math.max(half, (r.left + r.right) / 2))}px`;
  tag.style.top = `${Math.max(tag.offsetHeight + 8, r.top - 8)}px`;
}

/** The box up close and its floating scenarios together, on the screen. */
const cardCorner = new THREE.Vector3();
function openedRect(box: Box) {
  const r = screenRect(box);
  for (const each of box.cards ?? []) {
    if (!each.visible) continue;
    const size = (each.geometry as THREE.PlaneGeometry).parameters;
    for (const x of [-size.width / 2, size.width / 2])
      for (const y of [-size.height / 2, size.height / 2]) {
        cardCorner.set(x, y, 0).applyMatrix4(each.matrixWorld).project(camera);
        const px = ((cardCorner.x + 1) / 2) * innerWidth;
        const py = ((1 - cardCorner.y) / 2) * innerHeight;
        r.left = Math.min(r.left, px);
        r.right = Math.max(r.right, px);
        r.top = Math.min(r.top, py);
        r.bottom = Math.max(r.bottom, py);
      }
  }
  return r;
}

function placeCard() {
  if (!card || !upClose() || !opened || innerWidth <= 600) return;
  const r = openedRect(opened);
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const right = r.right + 32 + width <= innerWidth - 16;
  const left = right
    ? r.right + 32
    : Math.min(innerWidth - width - 16, Math.max(16, (r.left + r.right) / 2 - width / 2));
  const top = Math.min(
    innerHeight - height - 16,
    Math.max(72, right ? (r.top + r.bottom) / 2 - height / 2 : r.bottom + 14),
  );
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  if (backBar) {
    backBar.style.left = `${left}px`;
    backBar.style.top = `${top - 58}px`;
  }
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;

function step(dt: number) {
  for (const [i, box] of boxes.entries()) {
    const up = box === opened && upClose();
    const target = up ? 0 : i === hovered ? 0.4 : 0;
    // Eases out while pointed at; snaps straight back when let go.
    box.out = target > box.out ? box.out + (target - box.out) * Math.min(1, dt * 12) : target;
    if (up) {
      // Further back than the hero shelf's boxes come, and nearer the middle: its scenarios float beside it.
      closeSpot({ across: box.size.across * 1.45, tall: box.size.tall * 1.45, deep: box.size.deep }, closeAt, 0.48);
      box.fly = Math.min(1, box.fly + dt / FLY);
      flyUp(box.mesh, box.home, closeAt, box.fly, FACING, SPINE_TURN);
      if (box.fly >= 1) {
        box.swayed += dt;
        sway(box.mesh, box.swayed);
        box.open = Math.min(1, box.open + dt / 0.7);
      }
      box.wasUp = true;
    } else if (box.wasUp) {
      box.mesh.position.copy(box.home);
      box.mesh.rotation.set(0, SPINE_TURN, 0);
      box.mesh.scale.setScalar(1);
      box.fly = box.swayed = box.open = 0;
      box.wasUp = false;
    } else {
      // Pointed at: slid partway out and turned a little, so part of its front shows.
      box.mesh.position.set(box.home.x, box.home.y, box.home.z + box.out * box.size.across * 1.1);
      box.mesh.rotation.set(0, SPINE_TURN + box.out * 1.1, 0);
    }
    // The lid opens a little: lifted off the tray and tipped back, still over the box.
    const lift = easeOut(Math.min(1, box.open / 0.5));
    box.lid.position.set(0, box.size.tall * 0.22 * lift, box.size.deep * 0.35 * lift);
    box.lid.rotation.x = -0.42 * lift;
    box.lid.visible = true;
    // The scenarios' cards come out from under the lid and float to the box's side, bobbing gently.
    const out = easeOut(Math.max(0, (box.open - 0.3) / 0.7));
    box.cards?.forEach((each, k) => {
      const rest = each.userData.rest as THREE.Vector3;
      const float = each.userData.float as THREE.Vector3;
      const pointed = box === opened && k === hoveredCard ? 1 : 0;
      each.position.lerpVectors(rest, float, out);
      each.position.z += Math.sin(Math.PI * out) * 0.6 + pointed * 0.15;
      each.position.y += out * Math.sin(box.swayed * 1.4 + k * 1.3) * 0.04;
      const grow = 1 + ((each.userData.grow as number) - 1) * out;
      each.scale.setScalar(grow * (1 + pointed * 0.08));
      each.visible = box.open > 0;
    });
  }
  if (veil) {
    const goal = upClose() ? 0.62 : 0;
    const material = veil.material as THREE.MeshBasicMaterial;
    material.opacity = goal > material.opacity ? material.opacity + (goal - material.opacity) * Math.min(1, dt * 8) : 0;
    veil.visible = material.opacity > 0.01;
  }
  if (!active) return;
  placePicks();
  placeTag();
  placeCard();
}

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const ARROWS: Record<string, FocusDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function key(event: KeyboardEvent): boolean {
  const direction = ARROWS[event.key];
  const areas = upClose() ? [backBar, card] : [picks];
  if (!direction || !areas.every(Boolean)) return false;
  placePicks();
  const buttons = areas
    .flatMap((area) => [...area!.querySelectorAll<HTMLElement>("button")])
    .filter((button) => !button.hidden && button.getClientRects().length > 0);
  const now = document.activeElement as HTMLElement | null;
  event.preventDefault();
  if (!now || !buttons.includes(now)) {
    (upClose() ? card!.querySelector<HTMLElement>("button") : buttons[0])?.focus({ preventScroll: true });
    return true;
  }
  const rect = (node: HTMLElement) => {
    const r = node.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  const others = buttons.filter((button) => button !== now).map((button) => ({ key: button, rect: rect(button) }));
  (spatialPick(others, rect(now), direction) ?? spatialPick(others, rect(now), direction, true))?.focus({
    preventScroll: true,
  });
  return true;
}

// ── The camera, and mounting ──────────────────────────────────────────────────────────────────────────────────────

/** Square on to the bookcase, the whole of it in view, standing over the games table. */
export function scenarioView(out: Pose, aspect: number): Pose {
  const at = BACK + SCENARIO_CASE.depth;
  const tan = Math.tan((38 / 2) * (Math.PI / 180));
  const halfW = (SCENARIO_CASE.width + 1.4) / 2;
  const halfH = (layout.top - layout.bottom + 1.6) / 2;
  const distance = Math.max(halfW / (tan * aspect), halfH / tan);
  const middle = (layout.top + layout.bottom) / 2;
  return setPose(
    out,
    [SCENARIO_CASE.x, middle + 0.8, at + distance],
    [SCENARIO_CASE.x, middle, at],
    38,
    [distance + 4, distance + 40],
    0,
  );
}

/** Fills the panel with the shelf's buttons and builds the bookcase and its boxes (once). */
export async function buildScenarioShelf(panel: HTMLElement, given: ScenarioShelfHooks): Promise<void> {
  hooks = given;
  if (group) return;
  group = new THREE.Group();
  scene.add(group);
  picks = el("div", "scn-picks");
  picks.setAttribute("role", "group");
  picks.setAttribute("aria-label", "Boxes");
  card = el("section", "scn-card");
  card.setAttribute("aria-label", "Scenarios");
  card.hidden = true;
  backBar = el("div", "scn-back-bar");
  backBar.hidden = true;
  const back = el("button", "btn btn-secondary scn-back", "‹ Back to the shelf");
  back.type = "button";
  back.onclick = () => closeBox();
  backBar.append(back);
  tag = el("p", "scn-tag");
  tag.hidden = true;
  hint = el("p", "scn-hint", "Pick a box");
  const holder = el("div", "scn-shelf");
  holder.append(picks, card, backBar, tag, hint);
  panel.append(holder);

  buildCase(group);
  await Promise.all([document.fonts.load("60px Bangers"), document.fonts.load("800 22px 'Public Sans'")]);
  const arts = await Promise.all(
    layout.slots.map((slot) => {
      const scan = slot.product.scenarios[0]?.scan;
      return scan ? loadDecoded(`${CARDS}${scan}`) : null;
    }),
  );
  const owns = await Promise.all(
    layout.slots.map(async (slot) => {
      const own = boxArtUrl(slot.product);
      const image = own ? await loadDecoded(own.url) : null;
      return own && image ? { image, titled: own.titled, cut: own.cut } : null;
    }),
  );
  // One box at a time, while the page is idle between frames: greying a print and sending it to the graphics card all at once stalled the title's frames
  // (a pad's press then read as held, and repeated).
  for (const [i, slot] of layout.slots.entries()) {
    await new Promise<void>((done) =>
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(() => done(), { timeout: 1500 })
        : setTimeout(done, 16),
    );
    const lit = slot.product.scenarios.some((s) => given.state(s).playable || given.state(s).lock !== null);
    const { mesh, lid, maps } = buildBox(slot.product, slot.size, lit, arts[i] ?? null, owns[i] ?? null, i);
    for (const map of maps) renderer.initTexture(map);
    mesh.position.copy(slot.at);
    mesh.rotation.y = SPINE_TURN;
    group!.add(mesh);
    const button = el("button", "scn-box", slot.product.name);
    button.type = "button";
    button.dataset.scn = `box:${slot.product.code}`;
    if (!lit) button.setAttribute("aria-label", `${slot.product.name}, not on the table yet`);
    button.onclick = () => pickBox(boxes[i]!);
    button.onfocus = () => {
      if (!upClose()) hovered = i;
    };
    button.onblur = () => {
      if (hovered === i) hovered = -1;
    };
    picks!.append(button);
    boxes.push({
      product: slot.product,
      size: slot.size,
      lit,
      mesh,
      lid,
      home: slot.at.clone(),
      button,
      cards: null,
      out: 0,
      fly: 0,
      swayed: 0,
      open: 0,
      wasUp: false,
    });
  }
  veil = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 40),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
  );
  veil.position.set(SCENARIO_CASE.x, (layout.top + layout.bottom) / 2, BACK + SCENARIO_CASE.depth + 1.6);
  veil.visible = false;
  group.add(veil);
}

export const scenarioShelf = {
  /** The camera is here: the boxes answer the pointer. */
  enter() {
    active = true;
    placePicks();
    if (upClose()) paint();
    else (boxes[0]?.button ?? null)?.focus({ preventScroll: true });
  },
  leave() {
    active = false;
    hovered = -1;
    renderer.domElement.style.cursor = "default";
    if (tag) tag.hidden = true;
  },
  /** Escape or B: a box up close goes back on the shelf. */
  back(): boolean {
    if (!upClose()) return false;
    closeBox();
    return true;
  },
  key,
  step,
  /** Shows or hides its buttons (Campaign's table step hides them). */
  show(on: boolean) {
    const holder = picks?.parentElement;
    if (holder) holder.hidden = !on;
  },
  /** The box up close, if any. */
  opened: () => (upClose() ? opened!.product.code : null),
};
