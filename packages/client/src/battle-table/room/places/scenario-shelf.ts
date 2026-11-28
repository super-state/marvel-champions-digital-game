/**
 * The scenario shelf: Campaign's first step (Adam, 2026-11-27: "you pick your scenario from a shelf ... boxes of
 * different size, scenario packs, and the bigger packs; inside will be the scenarios in that set"). A bookcase on the
 * back wall, right of the sideboard, with every box that has scenarios in it (`scenario-catalogue.ts`), face-out in
 * the order they came out (`scenario-shelf-layout.ts`): the Core Set and the campaign boxes big and square, the
 * scenario packs smaller. The boxes the table can deal from are lit; the rest stand among them, faded, and a box the
 * road hasn't reached yet (`road.ts`) wears a padlock and says what reaches it.
 *
 * The boxes stand face-out in a lit display cabinet (Adam, 2026-11-27: "fronts of the boxes are better"; "a really
 * nerdy display cabinet with the boxes under lighting"). Pointing at a box eases it out; let go, it snaps back. The
 * keyboard and a pad start on the box the road is at and move by the arrows across and between shelves, so no box is
 * more than a few presses away. Picking one brings it up close as the hero shelf's boxes come (`close-up.ts`), the
 * cabinet dimmed behind: its lid lifts away and its scenarios come out and stand in a row beside it, big, each a picture
 * to click rather than a line in a menu (Adam, 2026-11-27: "more visual and clickable, like the boxes on the table"):
 * the Core Set's are its villains' campaign boxes, as the table showed them; any other box's, its villain cards. Each
 * says under it how it stands on the road: beaten ones ticked, the next one lit and framed in gold, later ones
 * padlocked. Picking the next hands it to Campaign (`campaign.ts`), which takes it to the table; any other says why
 * not. A click off the box and its scenarios, Back, Escape or B puts it back.
 *
 * Every choice is a real button (mouse, touch, the arrows, a pad): a see-through button over each box, and one over
 * each scenario while a box is up close.
 */
import * as THREE from "three";
import { camera, setPose, type Pose } from "../camera.js";
import { CAMPAIGN_ART } from "../../../art/campaign-art.js";
import { canvas, loadImage, texture } from "../canvas.js";
import { BACKDROP, ROOM, pointer, raycaster, renderer, say, scene } from "../room.js";
import { spatialPick, type FocusDirection } from "../../pad/spatial.js";
import { closeSpot, type Facing } from "./close-up.js";
import { CAMPAIGNS, bandPrint, frontPrint as campaignFront, spinePrint } from "./campaign-prints.js";
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
/** On the shelf a box stands face-out, its front to the room: not turned. */
const SHELF_TURN = 0;

/**
 * A line on a box's card: one of its scenarios as the road has it (the Core Set's are each there twice, on Standard and
 * on Expert). `absent` is a scenario the table doesn't deal yet.
 */
export interface ShelfRow {
  /** Unique in the box: the scenario's id. */
  readonly key: string;
  readonly scenario: ShelfScenario;
  readonly name: string;
  readonly status: "beaten" | "next" | "open" | "locked" | "absent";
  /** Campaign deals it now. */
  readonly playable: boolean;
  /** The line under its name ("Next on the road", "Beat Rhino first"). */
  readonly line: string;
}

export interface ScenarioShelfHooks {
  /** A box's scenarios, in the road's order. Read each time a box opens, so a game won since shows. */
  rows(product: ShelfProduct): readonly ShelfRow[];
  /** Why the road hasn't reached a box yet, or null when it has. */
  boxLock(product: ShelfProduct): string | null;
  /** The table deals something in the box (its print is lit). */
  onTable(product: ShelfProduct): boolean;
  /** A row Campaign deals, picked. */
  pick(row: ShelfRow): void;
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

/** A padlock, its body's middle at (x, y), `size` tall: a box or a scenario the road hasn't reached. */
function padlock(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const w = size * 0.78;
  const h = size * 0.58;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.7)";
  g.shadowBlur = size * 0.12;
  g.strokeStyle = "#e9dcc4";
  g.lineWidth = size * 0.13;
  g.beginPath();
  g.moveTo(x - w * 0.3, y - h / 2 + size * 0.04);
  g.arc(x, y - h / 2, w * 0.3, Math.PI, 0);
  g.lineTo(x + w * 0.3, y - h / 2 + size * 0.04);
  g.stroke();
  g.fillStyle = "#e9dcc4";
  g.fillRect(x - w / 2, y - h / 2, w, h);
  g.shadowBlur = 0;
  g.fillStyle = "#2a1f16";
  g.beginPath();
  g.arc(x, y - h * 0.08, size * 0.08, 0, Math.PI * 2);
  g.fill();
  g.fillRect(x - size * 0.035, y - h * 0.08, size * 0.07, h * 0.3);
  g.restore();
}

/** A dark disc with a padlock on it, its middle at (x, y), `r` its radius: reads over any art. */
function lockBadge(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.fillStyle = "rgba(14,10,8,0.85)";
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  padlock(g, x, y + r * 0.12, r * 1.25);
}

/** A tick in a green ring, its middle at (x, y): a scenario beaten on the road. */
function tick(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  g.save();
  g.shadowColor = "rgba(0,0,0,0.6)";
  g.shadowBlur = size * 0.15;
  g.fillStyle = "#3f9b4a";
  g.beginPath();
  g.arc(x, y, size / 2, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = "#f6f0e2";
  g.lineWidth = size * 0.07;
  g.stroke();
  g.lineWidth = size * 0.13;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(x - size * 0.22, y + size * 0.01);
  g.lineTo(x - size * 0.05, y + size * 0.18);
  g.lineTo(x + size * 0.24, y - size * 0.16);
  g.stroke();
  g.restore();
}

/** A print as it stands: faded unless lit, a padlock in its top right corner when the road hasn't reached it. */
function finish(print: HTMLCanvasElement, lit: boolean, locked: boolean): HTMLCanvasElement {
  const out = lit ? print : faded(print, locked ? "locked" : "shown");
  if (locked) {
    const r = out.width * 0.09;
    lockBadge(out.getContext("2d")!, out.width - r * 1.5, r * 1.5, r);
  }
  return out;
}

/**
 * The game's logo at the top of a front drawn from key art: the red MARVEL block with CHAMPIONS under it, as on the real
 * boxes (Adam, 2026-11-27: "why doesn't NeXt Evolution have the Marvel symbol?"; its art, MojoMania's and Shadowland's
 * are the key art alone).
 */
function logo(g: CanvasRenderingContext2D, w: number) {
  const blockW = Math.round(w * 0.36);
  const blockH = Math.round(blockW * 0.36);
  const x = (w - blockW) / 2;
  const y = Math.round(w * 0.05);
  g.save();
  g.shadowColor = "rgba(0,0,0,0.55)";
  g.shadowBlur = 10;
  g.fillStyle = "#e23636";
  g.fillRect(x, y, blockW, blockH);
  g.shadowBlur = 0;
  g.strokeStyle = "#ffffff";
  g.lineWidth = Math.max(2, blockH * 0.06);
  g.strokeRect(x + g.lineWidth, y + g.lineWidth, blockW - g.lineWidth * 2, blockH - g.lineWidth * 2);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  fit(g, "MARVEL", (size) => `900 ${size}px 'Public Sans', sans-serif`, Math.round(blockH * 0.72), blockW * 0.84);
  g.fillText("MARVEL", w / 2, y + blockH / 2 + blockH * 0.03);
  g.shadowColor = "rgba(0,0,0,0.85)";
  g.shadowBlur = 8;
  fit(g, "CHAMPIONS", (size) => `${size}px Bangers, 'Public Sans', sans-serif`, Math.round(blockH * 0.85), w * 0.7);
  g.fillText("CHAMPIONS", w / 2, y + blockH * 1.62);
  g.restore();
}

/** A box's front from its own art: the rulebook's cover as it is, or the key art with the title across the foot. */
function artPrint(
  product: ShelfProduct,
  art: HTMLImageElement,
  titled: boolean,
  cut: number,
  lit: boolean,
  locked: boolean,
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
    g.shadowBlur = 0;
    logo(g, w);
    g.shadowColor = "rgba(0,0,0,0.8)";
    g.shadowBlur = 8;
    const name = product.name.toUpperCase();
    fit(g, name, (size) => `${size}px Bangers, 'Public Sans', sans-serif`, big ? 70 : 56, w - 40);
    g.fillStyle = accent;
    g.fillText(name, w / 2, h - 64);
    g.shadowBlur = 0;
  }
  return finish(cv, lit, locked);
}

/** A box's front: its release's colours, the first villain's art filling it, and the box's name across the foot. */
function frontPrint(
  product: ShelfProduct,
  art: HTMLImageElement | null,
  lit: boolean,
  locked: boolean,
): HTMLCanvasElement {
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
  return finish(cv, lit, locked);
}

/**
 * A box's side, which is its spine on the shelf: a spine of its own, as a real box has, never a strip of its front
 * (Adam, 2026-11-27): its release's colour, the red MARVEL tab at the top with CHAMPIONS under it, its title running up
 * the middle, and the kind of box (core set, campaign, scenario pack) at the foot.
 */
function sidePrint(product: ShelfProduct, lit: boolean, locked: boolean): HTMLCanvasElement {
  const [w, h] = [128, 512];
  const [cv, g] = canvas(w, h);
  const [ground, accent] = coloursOf(product);
  const shade = g.createLinearGradient(0, 0, w, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.35)");
  shade.addColorStop(0.5, "rgba(255,255,255,0.06)");
  shade.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = ground;
  g.fillRect(0, 0, w, h);
  g.fillStyle = shade;
  g.fillRect(0, 0, w, h);
  // Edges in the accent colour.
  g.fillStyle = accent;
  g.fillRect(0, 0, w, 6);
  g.fillRect(0, h - 6, w, 6);
  g.fillRect(0, 0, 4, h);
  g.fillRect(w - 4, 0, 4, h);
  // The MARVEL tab and CHAMPIONS under it.
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#e23636";
  g.fillRect(14, 18, w - 28, 34);
  g.fillStyle = "#ffffff";
  fit(g, "MARVEL", (size) => `900 ${size}px 'Public Sans', sans-serif`, 26, w - 36);
  g.fillText("MARVEL", w / 2, 36);
  g.fillStyle = "#f6f0e2";
  fit(g, "CHAMPIONS", (size) => `900 ${size}px 'Public Sans', sans-serif`, 15, w - 24);
  g.fillText("CHAMPIONS", w / 2, 66);
  // The title, running up the spine.
  g.save();
  g.translate(w / 2, 300);
  g.rotate(-Math.PI / 2);
  g.fillStyle = "#f6f0e2";
  g.shadowColor = "rgba(0,0,0,0.6)";
  g.shadowBlur = 6;
  const name = product.name.toUpperCase();
  fit(g, name, (size) => `${size}px Bangers, 'Public Sans', sans-serif`, 64, 330);
  g.fillText(name, 0, 4);
  g.restore();
  // The kind of box, at the foot.
  g.fillStyle = accent;
  g.fillRect(10, h - 44, w - 20, 26);
  g.fillStyle = "#120d08";
  const kind = product.code === "core" ? "CORE SET" : product.size === "big" ? "CAMPAIGN" : "SCENARIO";
  fit(g, kind, (size) => `900 ${size}px 'Public Sans', sans-serif`, 15, w - 28);
  g.fillText(kind, w / 2, h - 30);
  const out = lit ? cv : faded(cv, locked ? "locked" : "shown");
  // Not reached on the road yet: a padlock under CHAMPIONS, where it shows on the shelf.
  if (locked) lockBadge(out.getContext("2d")!, w / 2, 124, 40);
  return out;
}

/** How a scenario's card in the box shows: lit (Campaign deals it), ticked (beaten), padlocked (not reached). */
interface CardLook {
  readonly lit: boolean;
  readonly ticked: boolean;
  readonly locked: boolean;
  /** What opens it, while locked ("Complete Rhino"). */
  readonly lockLine: string;
}

/** A scenario's card's look from its rows: lit if one plays, ticked if one is beaten, locked if none plays yet. */
function cardLook(rows: readonly ShelfRow[], scenario: ShelfScenario): CardLook {
  const own = rows.filter((row) => row.scenario.id === scenario.id);
  const lit = own.some((row) => row.playable);
  return {
    lit,
    ticked: own.some((row) => row.status === "beaten"),
    locked: !lit && own.some((row) => row.status === "locked"),
    lockLine: own.find((row) => row.status === "locked")?.line ?? "",
  };
}
/** A card's look, and whether it is the road's next. */
type Look = CardLook & { readonly next: boolean };
const lookOf = (rows: readonly ShelfRow[], scenario: ShelfScenario): Look => ({
  ...cardLook(rows, scenario),
  next: rows.some((row) => row.scenario.id === scenario.id && row.status === "next"),
});
const lookKey = (look: Look) => `${look.lit}/${look.ticked}/${look.locked}/${look.next}/${look.lockLine}`;

/**
 * A scenario as it comes out of its box: the Core Set's villain's campaign box front (`campaign-prints.ts`, the box the
 * table showed before the shelf), else its villain card; greyed when Campaign doesn't deal it, ticked once beaten,
 * padlocked while locked, and the road's next one framed in gold.
 */
function scenarioPrint(scan: HTMLImageElement | null, scenario: ShelfScenario, look: Look): HTMLCanvasElement {
  const campaign = CAMPAIGNS.find((c) => c.id === scenario.id);
  if (campaign) {
    const front = campaignFront({ ...campaign, open: true }, scan);
    return badge(look.lit ? front : faded(front), look);
  }
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
  return badge(look.lit ? cv : faded(cv), look);
}

/** A scenario's print's marks: a tick, or a padlock, in its top right corner. */
function badge(print: HTMLCanvasElement, look: Look): HTMLCanvasElement {
  const g = print.getContext("2d")!;
  const w = print.width;
  const h = print.height;
  if (look.ticked) tick(g, w * 0.83, w * 0.17, w * 0.23);
  else if (look.locked && look.lockLine) {
    // A band across it, a padlock and what opens it (Adam, 2026-11-28: "grey with a padlock ... say Complete Rhino").
    const band = h * 0.15;
    const y = h * 0.42;
    g.fillStyle = "rgba(10, 8, 6, 0.86)";
    g.fillRect(0, y, w, band);
    g.fillStyle = "#e9dcc4";
    g.fillRect(0, y, w, Math.max(2, band * 0.04));
    g.fillRect(0, y + band - Math.max(2, band * 0.04), w, Math.max(2, band * 0.04));
    padlock(g, w * 0.13, y + band * 0.55, band * 0.62);
    g.save();
    g.fillStyle = "#f6f0e2";
    g.textAlign = "left";
    g.textBaseline = "middle";
    const text = look.lockLine.toUpperCase();
    fit(g, text, (size) => `900 ${size}px 'Public Sans', sans-serif`, Math.round(band * 0.42), w * 0.72);
    g.fillText(text, w * 0.24, y + band / 2);
    g.restore();
  } else if (look.locked) lockBadge(g, w * 0.83, w * 0.17, w * 0.115);
  return print;
}

/**
 * A print dimmed, by the canvas's own filter, which costs next to nothing (greying pixel by pixel, for every box as the
 * room opened, stalled the title's frames). `shown`: a box on display the table doesn't deal from yet keeps its colours,
 * a little dimmed (Adam, 2026-11-27: the cabinet showed the box art too grey); `locked`: one the road hasn't reached,
 * or a scenario that can't be picked, greyed.
 */
function faded(print: HTMLCanvasElement, how: "shown" | "locked" = "locked"): HTMLCanvasElement {
  const [out, g] = canvas(print.width, print.height);
  g.filter = how === "shown" ? "saturate(0.8) brightness(0.86)" : "grayscale(0.7) brightness(0.74)";
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

/**
 * The cabinet's back: a deep blue glowing from within, brightest behind each shelf's middle, with a faint grid, like a
 * collector's lit display case (Adam, 2026-11-27: "a really nerdy display cabinet with the boxes under lighting").
 */
function backdropPrint(): HTMLCanvasElement {
  const [cv, g] = canvas(512, 512);
  const wash = g.createRadialGradient(256, 230, 30, 256, 256, 380);
  wash.addColorStop(0, "#28407a");
  wash.addColorStop(0.55, "#141d3c");
  wash.addColorStop(1, "#080a16");
  g.fillStyle = wash;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(120, 170, 255, 0.10)";
  g.lineWidth = 1;
  for (let i = 0; i <= 512; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 512);
    g.moveTo(0, i);
    g.lineTo(512, i);
    g.stroke();
  }
  return cv;
}

/** A soft round glow, white at its middle, for the light pooled behind each box. */
let haloMap: THREE.Texture | null = null;
function halo(): THREE.Texture {
  if (haloMap) return haloMap;
  const [cv, g] = canvas(256, 256);
  const glow = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  glow.addColorStop(0, "rgba(255,255,255,0.9)");
  glow.addColorStop(0.35, "rgba(255,255,255,0.35)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  return (haloMap = texture(cv));
}

/** How high each box stands on its lit stand. */
const STAND = 0.07;
const standGlass = new THREE.MeshStandardMaterial({
  color: 0xbfe3ff,
  emissive: 0x4fa8ff,
  emissiveIntensity: 0.9,
  transparent: true,
  opacity: 0.55,
  roughness: 0.15,
});

/**
 * A box's place in the cabinet: a glowing acrylic stand under it and a pool of light on the back behind it, gold for
 * the box the table deals from, cool for one the road has reached, faint for one it hasn't.
 */
function buildPlinth(at: THREE.Vector3, size: ProductMeasure, lit: boolean, locked: boolean): THREE.Group {
  const plinth = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.BoxGeometry(size.across + 0.12, STAND, size.deep + 0.14), standGlass);
  stand.position.set(at.x, at.y - size.tall / 2 + STAND / 2 + 0.002, at.z);
  stand.receiveShadow = true;
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.across * 2.1, size.tall * 1.7),
    new THREE.MeshBasicMaterial({
      map: halo(),
      color: lit ? 0xffc46a : locked ? 0x2a3c66 : 0x5f8fe0,
      transparent: true,
      opacity: lit ? 0.75 : locked ? 0.35 : 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.position.set(at.x, at.y + STAND, BACK + 0.09);
  plinth.add(stand, glow);
  return plinth;
}

function buildCase(group: THREE.Group) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.45, metalness: 0.1 });
  const backdrop = texture(backdropPrint());
  backdrop.wrapS = backdrop.wrapT = THREE.RepeatWrapping;
  backdrop.repeat.set(3, 2);
  const backing = new THREE.MeshStandardMaterial({
    map: backdrop,
    emissive: 0xffffff,
    emissiveMap: backdrop,
    emissiveIntensity: 0.9,
    roughness: 0.9,
  });
  const strip = new THREE.MeshStandardMaterial({ color: 0xffe2b8, emissive: 0xffd39a, emissiveIntensity: 2.4 });
  // The neon edge along each shelf's front: the cabinet's accent.
  const edge = new THREE.MeshStandardMaterial({ color: 0x8fe6ff, emissive: 0x53c6e8, emissiveIntensity: 2.6 });
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
    const neon = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, 0.035), edge);
    neon.position.set(x, floor - BOARD / 2, BACK + depth + 0.02);
    add(neon, false);
  });
  // The neon round the cabinet's mouth, up both sides and along the top.
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, height, 0.035), edge);
    post.position.set(x + side * (width / 2 + 0.02), bottom + height / 2, BACK + depth + 0.07);
    add(post, false);
  }
  const crown = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.035, 0.035), edge);
  crown.position.set(x, top - 0.02, BACK + depth + 0.07);
  add(crown, false);
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
  /** Why the road hasn't reached it yet, as its prints show it (a padlock); null when it has. */
  lock: string | null;
  /** What its prints are drawn from, to draw them again when the road reaches it. */
  readonly art: HTMLImageElement | null;
  readonly own: { image: HTMLImageElement; titled: boolean; cut: number } | null;
  readonly faces: { front: THREE.MeshStandardMaterial; sides: THREE.MeshStandardMaterial };
  /** Its scenarios' cards' looks as drawn: they are drawn again when a game won since changes one. */
  looks: string;
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

/** A box's two prints, its front and its side (the spine on the shelf). */
function boxPrints(
  product: ShelfProduct,
  lit: boolean,
  locked: boolean,
  art: HTMLImageElement | null,
  own: { image: HTMLImageElement; titled: boolean; cut: number } | null,
) {
  return {
    front: texture(
      own ? artPrint(product, own.image, own.titled, own.cut, lit, locked) : frontPrint(product, art, lit, locked),
    ),
    side: texture(sidePrint(product, lit, locked)),
  };
}

function buildBox(
  product: ShelfProduct,
  size: ProductMeasure,
  lit: boolean,
  locked: boolean,
  art: HTMLImageElement | null,
  own: { image: HTMLImageElement; titled: boolean; cut: number } | null,
  i: number,
) {
  const [ground] = coloursOf(product);
  const shade = boxShade(lit, locked);
  const stock = new THREE.MeshStandardMaterial({
    color: new THREE.Color(ground).multiplyScalar(lit ? 0.8 : 0.35),
    roughness: 0.7,
  });
  const { front, side } = boxPrints(product, lit, locked, art, own);
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
  // Its walls stand on the floor and meet edge to edge, never sharing a face (see the lid's).
  const trayWall = (w: number, h: number, px: number, py: number) => {
    const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, td - 0.03), stock);
    part.position.set(px, py, -0.01 + 0.015);
    part.castShadow = part.receiveShadow = true;
    tray.add(part);
  };
  trayWall(0.03, th, tw / 2 - 0.015, 0);
  trayWall(0.03, th, -tw / 2 + 0.015, 0);
  trayWall(tw - 0.06, 0.03, 0, th / 2 - 0.015);
  trayWall(tw - 0.06, 0.03, 0, -th / 2 + 0.015);
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
  const face = printed(front);
  // The walls meet edge to edge and never overlap: where two shared an outside face, the screen couldn't tell which to
  // draw and every box's edges shimmered as the view moved (Adam, 2026-11-27: "they all still flicker"). The front
  // covers the whole face; the sides run back from behind it; the top and bottom sit between the sides.
  const wallDeep = lidDeep - 0.03;
  const wallZ = deep / 2 - 0.03 - wallDeep / 2;
  wall(across, tall, 0.03, [stock, stock, stock, stock, face, stock], 0, 0, deep / 2 - 0.015);
  wall(0.03, tall, wallDeep, [sides, stock, stock, stock, stock, stock], across / 2 - 0.015, 0, wallZ);
  wall(0.03, tall, wallDeep, [stock, sides, stock, stock, stock, stock], -across / 2 + 0.015, 0, wallZ);
  wall(across - 0.06, 0.03, wallDeep, stock, 0, tall / 2 - 0.015, wallZ);
  wall(across - 0.06, 0.03, wallDeep, stock, 0, -tall / 2 + 0.015, wallZ);
  mesh.add(tray, lid);
  mesh.traverse((o) => (o.userData.box = i));
  return { mesh, lid, maps: [front, side], faces: { front: face, sides } };
}

/** How much light a box's prints take: full when the table deals from it, nearly so on display, less when locked. */
const boxShade = (lit: boolean, locked: boolean) => (lit ? 0xffffff : locked ? 0x9a9a9a : 0xdedede);

/** Puts a new print on a box's printed face (its lit glow follows it). */
function reprint(material: THREE.MeshStandardMaterial, map: THREE.Texture) {
  const old = material.map;
  material.map = map;
  if (material.emissiveMap) material.emissiveMap = map;
  material.needsUpdate = true;
  old?.dispose();
}

/** Draws a box's prints again when the road has reached it since they were drawn (or locked it, as a friend). */
function repaintBox(box: Box, lock: string | null) {
  if ((lock === null) === (box.lock === null)) {
    box.lock = lock;
    return;
  }
  box.lock = lock;
  const { front, side } = boxPrints(box.product, box.lit, lock !== null, box.art, box.own);
  reprint(box.faces.front, front);
  reprint(box.faces.sides, side);
  for (const face of [box.faces.front, box.faces.sides]) face.color.set(boxShade(box.lit, lock !== null));
  const label = boxLabel(box);
  if (label !== box.product.name) box.button.setAttribute("aria-label", label);
  else box.button.removeAttribute("aria-label");
}

/** A box's button's name for a screen reader: its name, and why it's locked or not on the table. */
function boxLabel(box: Pick<Box, "product" | "lit" | "lock">): string {
  if (box.lock) return `${box.product.name}, locked: ${box.lock}`;
  return box.lit ? box.product.name : `${box.product.name}, not on the table yet`;
}

/**
 * How a box up close stands to its scenarios: a size `CLOSE_FIT` times its own fits the screen, so it stands small and
 * to the left (`CLOSE_LEFT` of the way from the middle), and its scenarios have the rest.
 */
const CLOSE_FIT = 2.4;
const CLOSE_LEFT = 0.62;
/**
 * How far towards the camera the box up close is brought, shrunk to match so it looks the same size: at its full size
 * that far back it stood in the cabinet's mouth, and as it swayed it cut through the cabinet's lit edges and the veil
 * in front of it, and flickered (Adam, 2026-11-27: "the box flickers when rotating").
 */
const CLOSE_NEAR = 0.45;

/** A Core Set scenario's villain box: as deep as the table's campaign boxes, for its front's width. */
const BOX_DEEP = 1.0 / 2.4;

/** The shape of a scenario's print: a Core Set villain's campaign box front (4:5), else a card (0.715). */
const printAspect = (scenario: ShelfScenario) => (CAMPAIGNS.some((c) => c.id === scenario.id) ? 0.8 : 0.715);

/**
 * Where each scenario stands once it has come out of its box up close, from the box's middle (as it stands up close,
 * not turned): in a row to its right (two rows past three), big enough to read and click (Adam, 2026-11-27). In units
 * of the box's height, which `CLOSE_FIT` makes a set share of the screen.
 */
function floatLayout(box: Box): { spots: THREE.Vector3[]; width: number } {
  const { across, tall, deep } = box.size;
  const n = box.product.scenarios.length;
  const perRow = n <= 3 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / perRow);
  const aspect = printAspect(box.product.scenarios[0]!);
  const gap = tall * 0.16;
  // The room right of the box on this screen (Adam, 2026-11-27: the scenarios ran off its edge): how wide the view is
  // where the box stands up close (`closeSpot`), less the box, its gap and a margin; they stand a little nearer, so a
  // touch bigger.
  const tan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  // A window caught mid-resize can be momentarily 0 tall: a wide screen's shape, never a broken number.
  const screen = Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9;
  const front = Math.max((tall * CLOSE_FIT) / (1.1 * tan), (across * CLOSE_FIT) / (1.0 * tan * screen));
  const halfWide = (front + deep / 2) * tan * screen;
  const room = (halfWide * (1 + CLOSE_LEFT) - across / 2 - tall * 0.6 - tall * 0.3) * 0.94;
  const width = Math.min(tall * 1.4, (room - gap * (perRow - 1)) / perRow, ((tall * 3.0) / rows - gap) * aspect);
  const height = width / aspect;
  const spots = box.product.scenarios.map((_, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    return new THREE.Vector3(
      across / 2 + tall * 0.6 + col * (width + gap) + width / 2,
      tall * 0.05 + ((rows - 1) / 2 - row) * (height + gap),
      deep / 2,
    );
  });
  return { spots, width };
}

const frameGold = new THREE.MeshBasicMaterial({ color: 0xf2c230, toneMapped: false });
/** A gold frame round a `w` by `h` front, just outside its edges. */
function selectFrame(w: number, h: number): THREE.Mesh {
  const gap = w * 0.025;
  const band = w * 0.045;
  const outer = new THREE.Shape();
  const [ox, oy] = [w / 2 + gap + band, h / 2 + gap + band];
  outer.moveTo(-ox, -oy).lineTo(ox, -oy).lineTo(ox, oy).lineTo(-ox, oy).lineTo(-ox, -oy);
  const hole = new THREE.Path();
  const [ix, iy] = [w / 2 + gap, h / 2 + gap];
  hole.moveTo(-ix, -iy).lineTo(-ix, iy).lineTo(ix, iy).lineTo(ix, -iy).lineTo(-ix, -iy);
  outer.holes.push(hole);
  return new THREE.Mesh(new THREE.ShapeGeometry(outer), frameGold);
}

const shellGold = new THREE.MeshBasicMaterial({ color: 0xf2c230, toneMapped: false, side: THREE.BackSide });
/**
 * A gold outline round a whole `w` by `h` by `d` box: a slightly bigger box seen only from inside, so its gold shows
 * just round the box's own outline from wherever it is looked at, its spine and top included (Adam, 2026-11-28: "the
 * yellow outline needs adjusting to suit the 3d packs").
 */
function selectShell(w: number, h: number, d: number): THREE.Mesh {
  const band = w * 0.05;
  return new THREE.Mesh(new THREE.BoxGeometry(w + band * 2, h + band * 2, d + band * 2), shellGold);
}

async function buildCards(box: Box, road: readonly ShelfRow[]): Promise<THREE.Mesh[]> {
  const { across, tall, deep } = box.size;
  const n = box.product.scenarios.length;
  const perRow = n <= 3 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / perRow);
  const gap = 0.04;
  const aspect = printAspect(box.product.scenarios[0]!);
  const cardW = Math.min(
    (across - 0.12 - gap * (perRow - 1)) / perRow,
    ((tall - 0.12 - gap * (rows - 1)) / rows) * aspect,
  );
  const cardH = cardW / aspect;
  // A Core Set scenario's box front shows its villain card's art, as on the table: the campaign's own scan.
  const scans = await Promise.all(
    box.product.scenarios.map((s) => {
      const campaign = CAMPAIGNS.find((c) => c.id === s.id);
      if (campaign) return loadImage(campaign.scan);
      return s.scan ? loadImage(`${CARDS}${s.scan}`) : null;
    }),
  );
  return box.product.scenarios.map((scenario, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i % perRow;
    const look = lookOf(road, scenario);
    const map = texture(scenarioPrint(scans[i] ?? null, scenario, look));
    const face = (picture: THREE.Texture, glow = look.next ? 0.32 : 0.2) =>
      new THREE.MeshStandardMaterial({
        map: picture,
        roughness: 0.4,
        ...(look.lit ? { emissive: 0xffffff, emissiveMap: picture, emissiveIntensity: glow } : { color: 0x9a9a9a }),
      });
    // A Core Set scenario is its villain's campaign box, whole, as the table showed them before the shelf (Adam,
    // 2026-11-27: "like the existing boxes on the main screen on live"): its front, its printed spine down each side
    // and its band along the top and bottom. Any other is its villain card.
    const campaign = CAMPAIGNS.find((c) => c.id === scenario.id);
    let card: THREE.Mesh;
    if (campaign) {
      const spine = texture(look.lit ? spinePrint(campaign) : faded(spinePrint(campaign)));
      spine.center.set(0.5, 0.5);
      spine.rotation = Math.PI / 2;
      const band = texture(look.lit ? bandPrint(campaign) : faded(bandPrint(campaign)));
      const sides = face(spine, 0.12);
      const ends = face(band, 0.12);
      card = new THREE.Mesh(new THREE.BoxGeometry(cardW, cardH, cardW * BOX_DEEP), [
        sides,
        sides,
        ends,
        ends,
        face(map),
        ends,
      ]);
    } else card = new THREE.Mesh(new THREE.PlaneGeometry(cardW, cardH), face(map));
    // In the tray at first, lying on its floor; it leaves the box (and its sway) as it comes out.
    card.userData.box = box.mesh.userData.box;
    card.userData.scenario = i;
    card.userData.rest = new THREE.Vector3(
      (col - (inRow - 1) / 2) * (cardW + gap),
      ((rows - 1) / 2 - row) * (cardH + gap),
      -deep / 2 + 0.032 + (campaign ? (cardW * BOX_DEEP) / 2 : 0.004),
    );
    // Where it stands and how big comes from `floatLayout` each frame, so a window resized while it is out keeps it
    // on the screen; `cardW` is its size in the tray.
    card.userData.cardW = cardW;
    // The gold frame round the one picked out (pointed at, or the arrows' and a pad's), outside the box's front, never
    // over it (Adam, 2026-11-27: "the yellow border ... should be outside the box not inside").
    const frame = campaign ? selectShell(cardW, cardH, cardW * BOX_DEEP) : selectFrame(cardW, cardH);
    if (!campaign) frame.position.z = 0.002;
    frame.userData.box = card.userData.box;
    frame.userData.scenario = i;
    frame.visible = false;
    card.add(frame);
    card.userData.frame = frame;
    card.visible = false;
    group?.add(card);
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
/** A see-through button over each scenario standing beside the box up close, its words under it. */
let floats: HTMLElement | null = null;
let backBar: HTMLElement | null = null;

const upClose = () => !!opened && !!card && !card.hidden;

function el<K extends keyof HTMLElementTagNameMap>(name: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The words over a box up close: what the road says about it. */
function whoLine(box: Box, rows: readonly ShelfRow[]): string {
  const count = box.product.scenarios.length;
  const inside = `${count} ${count === 1 ? "scenario" : "scenarios"} inside`;
  if (box.lock) return `Locked · ${box.lock}`;
  if (!box.lit) return `${inside} · not on the table yet`;
  // The boxes say which plays next and what opens the rest (Adam, 2026-11-28): the plate is just the box's name.
  if (rows.length && rows.every((row) => row.status === "beaten")) return "Prologue complete";
  return "";
}

/** The words for a box up close (its name, what the road says) and a button over each scenario beside it. */
function paint(focusKey?: string) {
  if (!card || !floats || !opened || !hooks) return;
  const box = opened;
  const rows = hooks.rows(box.product);
  const head = el("div", "scn-card-head");
  head.append(el("h3", "scn-title", box.product.name));
  const who = whoLine(box, rows);
  if (who) head.append(el("p", "scn-who", who));
  card.replaceChildren(head);
  card.hidden = false;
  const buttons = rows.map((row) => {
    const scenarioAt = box.product.scenarios.indexOf(row.scenario);
    const button = el("button", "scn-float");
    button.type = "button";
    button.dataset.scn = `scenario:${row.key}`;
    button.dataset.road = row.status;
    button.dataset.at = String(scenarioAt);
    if (!row.playable) button.setAttribute("aria-disabled", "true");
    // Named by the scenario; what the road says is read after it.
    button.setAttribute("aria-label", row.name);
    if (row.line) button.setAttribute("aria-description", row.line);
    const words = el("span", "scn-float-words");
    words.setAttribute("aria-hidden", "true");
    const name = el("strong", "", row.name);
    if (row.status === "beaten") name.prepend(mark("scn-tick", "✓"));
    else if (row.status === "locked") name.prepend(mark("scn-lock", "🔒"));
    words.append(name);
    if (row.line) words.append(el("small", "", row.line));
    button.append(words);
    button.onclick = () => choose(row);
    button.onfocus = () => (hoveredCard = scenarioAt);
    button.onblur = () => {
      if (hoveredCard === scenarioAt) hoveredCard = -1;
    };
    button.onpointerenter = () => (hoveredCard = scenarioAt);
    button.onpointerleave = () => {
      if (hoveredCard === scenarioAt) hoveredCard = -1;
    };
    return button;
  });
  floats.setAttribute("aria-label", `${box.product.name}'s scenarios`);
  floats.replaceChildren(...buttons);
  floats.hidden = false;
  placeFloats();
  // The boxes behind are out of reach while one is up close: a pad's D-pad stays on its scenarios.
  if (picks) picks.inert = true;
  if (backBar) backBar.hidden = false;
  // The focus starts on the road's next scenario (else the first that plays, else the first).
  const start = rows.find((row) => row.status === "next") ?? rows.find((row) => row.playable) ?? rows[0];
  const key = focusKey ?? (start ? `scenario:${start.key}` : "");
  floats.querySelector<HTMLElement>(`[data-scn="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

/** A tick or a padlock before a scenario's name: its line says it in words, so a screen reader skips it. */
function mark(kind: string, glyph: string): HTMLElement {
  const node = el("span", `scn-mark ${kind}`, glyph);
  node.setAttribute("aria-hidden", "true");
  return node;
}

/** A row picked in the box up close: Campaign deals it, or it says why not. */
function choose(row: ShelfRow) {
  if (!hooks) return;
  if (row.playable) {
    hooks.pick(row);
    return;
  }
  if (row.status === "beaten") say(`${row.name} is beaten. Play it again in Free Play.`);
  else if (row.status === "locked") say(`${row.name} is locked. ${row.line}.`);
  else say(`${row.name} isn't on the table yet.`);
}

/** A scenario's card picked in the box up close: its row Campaign deals (the road's next first), else its first. */
function chooseCard(i: number) {
  if (!opened || !hooks) return;
  const scenario = opened.product.scenarios[i]!;
  const own = hooks.rows(opened.product).filter((row) => row.scenario === scenario);
  const row = own.find((each) => each.status === "next") ?? own.find((each) => each.playable) ?? own[0];
  if (row) choose(row);
}

/** Makes a box's scenarios' cards, or makes them again when a game won since has changed how one looks. */
function readyCards(box: Box) {
  if (!hooks) return;
  const rows = hooks.rows(box.product);
  const looks = box.product.scenarios.map((scenario) => lookKey(lookOf(rows, scenario))).join();
  if (box.cards && box.looks === looks) return;
  for (const old of box.cards ?? []) {
    old.removeFromParent();
    (old.userData.frame as THREE.Mesh | undefined)?.geometry.dispose();
    old.geometry.dispose();
    const materials = [old.material].flat() as THREE.MeshStandardMaterial[];
    for (const material of new Set(materials)) {
      material.map?.dispose();
      material.dispose();
    }
  }
  box.cards = null;
  box.looks = looks;
  void buildCards(box, rows).then((cards) => {
    // Drawn again meanwhile: these are the old ones.
    if (box.looks !== looks || box.cards) {
      for (const each of cards) each.removeFromParent();
      return;
    }
    box.cards = cards;
  });
}

function pickBox(box: Box) {
  opened = box;
  hovered = -1;
  hoveredCard = -1;
  readyCards(box);
  paint();
}

/**
 * The road has moved (a game won since the shelf was drawn): the boxes it has reached lose their padlocks, and a box up
 * close lists its scenarios again. Each box's scenario cards are drawn again the next time it opens.
 */
export function refreshScenarioShelf() {
  if (!hooks) return;
  for (const box of boxes) repaintBox(box, hooks.boxLock(box.product));
  if (upClose() && opened) {
    readyCards(opened);
    paint(document.activeElement instanceof HTMLElement ? document.activeElement.dataset.scn : undefined);
  }
}

/** Puts the box back on its shelf; the focus goes back to it. */
export function closeBox(refocus = true) {
  if (!card) return;
  card.hidden = true;
  if (floats) floats.hidden = true;
  if (picks) picks.inert = false;
  if (backBar) backBar.hidden = true;
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
  const out: THREE.Object3D[] = boxes.map((box) => box.mesh);
  if (opened?.cards) out.push(...opened.cards.filter((each) => each.visible));
  return raycaster.intersectObjects(out, true)[0];
}

/**
 * The box whose place on the shelf is under the pointer, or -1: by its slot, which stays still, never the box itself,
 * which slides out while pointed at (picked by the box, it slid out from under the pointer, let go, snapped back under
 * it again, and flickered; Adam, 2026-11-27: "boxes are flickering when being hovered over").
 */
const slotBounds = new THREE.Box3();
/** How far a slot reaches past its box: the gap between boxes on a shelf. */
const SLOT_REACH = 0.22;
const slotSize = new THREE.Vector3();
const slotHit = new THREE.Vector3();
function slotAt(x: number, y: number): number {
  pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  let best = -1;
  let nearest = Infinity;
  for (const [i, box] of boxes.entries()) {
    // Widened to meet its neighbours, so the pointer crossing from one box to the next never falls between them.
    slotSize.set(box.size.across + SLOT_REACH, box.size.tall + SLOT_REACH, box.size.deep);
    slotBounds.setFromCenterAndSize(box.home, slotSize);
    if (!raycaster.ray.intersectBox(slotBounds, slotHit)) continue;
    const distance = slotHit.distanceTo(raycaster.ray.origin);
    if (distance < nearest) {
      nearest = distance;
      best = i;
    }
  }
  return best;
}

/** Where the pointer last was: the browser repeats a move when what lies under a still pointer changes (the buttons
 * here follow the boxes), and those mustn't undo what the arrows or a pad picked out. */
let pointerAt = "";
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!active) return;
  const at = `${event.clientX},${event.clientY}`;
  if (at === pointerAt) return;
  pointerAt = at;
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
  hovered = slotAt(event.clientX, event.clientY);
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
    // A scenario beside the box up close picks it; a click anywhere off them is a step back, never another box.
    const inBox = hit && opened && hit.object.userData.box === opened.mesh.userData.box;
    if (inBox && hit.object.userData.scenario !== undefined) chooseCard(hit.object.userData.scenario as number);
    else if (!inBox) closeBox();
    return;
  }
  const box = boxes[slotAt(event.clientX, event.clientY)];
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

const cardCorner = new THREE.Vector3();

/** Where a box up close stands: small and to the left, so its scenarios stand big beside it. */
function closeFor(box: Box) {
  closeSpot(
    { across: box.size.across * CLOSE_FIT, tall: box.size.tall * CLOSE_FIT, deep: box.size.deep },
    closeAt,
    CLOSE_LEFT,
  );
  closeAt.sub(camera.position).multiplyScalar(CLOSE_NEAR).add(camera.position);
}

/** Where a scenario's print stands once it is out of its box, on the screen. */
function landedRect(box: Box, at: number) {
  const { spots, width } = floatLayout(box);
  const spot = spots[at]!;
  const scenario = box.product.scenarios[at]!;
  const height = width / printAspect(scenario);
  // Its front, turned as it stands.
  const front = CAMPAIGNS.some((c) => c.id === scenario.id) ? (width * BOX_DEEP) / 2 : 0;
  const [cos, sin] = [Math.cos(STAND_TURN), Math.sin(STAND_TURN)];
  const r = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const x of [-width / 2, width / 2])
    for (const y of [-height / 2, height / 2]) {
      cardCorner
        .set(spot.x + x * cos + front * sin, spot.y + y, spot.z - x * sin + front * cos)
        .multiplyScalar(CLOSE_NEAR)
        .add(closeAt)
        .project(camera);
      const px = ((cardCorner.x + 1) / 2) * innerWidth;
      const py = ((1 - cardCorner.y) / 2) * innerHeight;
      r.left = Math.min(r.left, px);
      r.right = Math.max(r.right, px);
      r.top = Math.min(r.top, py);
      r.bottom = Math.max(r.bottom, py);
    }
  return r;
}

/**
 * Each scenario's button over where its print lands, from the moment the box is picked: the arrows and a pad's D-pad
 * steer by the buttons' places, so they stand still while the prints are still coming out.
 */
function placeFloats() {
  if (!floats || !opened || floats.hidden) return;
  closeFor(opened);
  // Their words show once the prints have landed above them.
  floats.toggleAttribute("data-out", opened.open >= 1);
  for (const button of floats.querySelectorAll<HTMLElement>(".scn-float")) {
    const style = button.style;
    const r = landedRect(opened, Number(button.dataset.at));
    style.left = `${r.left}px`;
    style.top = `${r.top}px`;
    style.width = `${Math.max(1, r.right - r.left)}px`;
    style.height = `${Math.max(1, r.bottom - r.top)}px`;
  }
}

/** The box's name and what the road says, over the box and its scenarios; Back under them, in the middle. */
function placeCard() {
  if (!card || !upClose() || !opened) return;
  placeFloats();
  if (innerWidth <= 600) return;
  // Over the box itself, on the left (Adam, 2026-11-27: "the core set box text should be above the box over on the
  // left").
  const r = screenRect(opened);
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const left = Math.min(innerWidth - width - 16, Math.max(16, (r.left + r.right) / 2 - width / 2));
  // Clear of the lid too, which lifts above the box as it opens.
  const top = Math.max(84, r.top - (r.bottom - r.top) * 0.32 - height - 12);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  if (backBar) {
    backBar.style.left = `${Math.max(16, innerWidth / 2 - backBar.offsetWidth / 2)}px`;
    backBar.style.top = `${innerHeight - backBar.offsetHeight - 22}px`;
  }
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;

/**
 * While a box is up close the cabinet behind goes soft, so the box and its scenarios stand out (Adam, 2026-11-28:
 * "blur the backdrop a bit to give focus to them"): the cabinet moves to the room's blurred layer (`room.ts`), the
 * box up close and its scenarios stay sharp. Its lights stay on both, so it is lit the same either way.
 */
const FOCUS_BLUR = 0.7;
let focusBlur = 0;
let softened = false;
function softenCabinet(on: boolean) {
  if (on === softened || !group) return;
  softened = on;
  group.traverse((o) => {
    // Lights shine on both layers, as the room's do.
    if ((o as THREE.Light).isLight) o.layers.enableAll();
    else o.layers.set(on ? BACKDROP : 0);
  });
  if (!on || !opened) return;
  opened.mesh.traverse((o) => o.layers.set(0));
  for (const each of opened.cards ?? []) each.traverse((o) => o.layers.set(0));
}

/**
 * A box picked comes straight out of its slot and glides to the left of the screen, square to the room the whole way:
 * no spin, no swoop, no sway (Adam, 2026-11-27: "simpler and faster, and smoother, just come out the shelf and on the
 * left hand side"). Seconds to come out, and for its lid to lift and its scenarios to step out once it is there.
 */
const COME_OUT = 0.7;
const OPEN_UP = 0.5;
/**
 * How far below its scenarios' middle the box lands, as a share of its height: room above it for its name plate,
 * which overlapped the box's top (Adam, 2026-11-27: "core set text shouldn't overlap the image").
 */
const BOX_DROP = 0.4;
const landAt = new THREE.Vector3();
/**
 * A picked box coming out to you, smooth and simple, the way its scenarios come out of it (Adam, 2026-11-27: "it needs
 * to be smooth and simple like the scenarios"): one straight glide that slows as it lands, lifted a little off the
 * shelf on the way so it clears its neighbours, no turn out of the slot first.
 */
function comeOut(box: Box, t: number) {
  const k = easeOut(t);
  landAt.copy(closeAt).setY(closeAt.y - box.size.tall * CLOSE_NEAR * BOX_DROP);
  box.mesh.position.lerpVectors(box.home, landAt, k).addScaledVector(FACING.out, Math.sin(Math.PI * k) * box.size.deep);
  box.mesh.rotation.set(0, SHELF_TURN, 0);
  // Shrinks as it comes, to its size nearer the camera (it looks the same size, only nearer).
  box.mesh.scale.setScalar(1 + (CLOSE_NEAR - 1) * k);
}
const restAt = new THREE.Vector3();
const floatAt = new THREE.Vector3();
/**
 * How the scenarios stand once out: still, each turned a little so a side shows (Adam, 2026-11-27: "I don't like the
 * scenarios floating, it looks a bit cheap. Just have them angled a bit and still so we can see the sides a bit").
 */
const STAND_TURN = -0.32;
const STANDING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), STAND_TURN);

function step(dt: number) {
  for (const [i, box] of boxes.entries()) {
    const up = box === opened && upClose();
    const target = up ? 0 : i === hovered ? 0.4 : 0;
    // Eases out while pointed at, and eases back when let go (snapping back read as a flicker as the pointer crossed
    // the shelf).
    box.out += (target - box.out) * Math.min(1, dt * (target > box.out ? 12 : 16));
    if (Math.abs(box.out - target) < 1e-3) box.out = target;
    if (up) {
      closeFor(box);
      box.fly = Math.min(1, box.fly + dt / COME_OUT);
      comeOut(box, box.fly);
      if (box.fly >= 1) {
        box.swayed += dt;
        box.open = Math.min(1, box.open + dt / OPEN_UP);
      }
      box.wasUp = true;
    } else if (box.wasUp) {
      box.mesh.position.copy(box.home);
      box.mesh.rotation.set(0, SHELF_TURN, 0);
      box.mesh.scale.setScalar(1);
      box.fly = box.swayed = box.open = 0;
      box.wasUp = false;
    } else {
      // Pointed at: lifted a little off its stand and towards the room, tipped back as if taken by its top.
      box.mesh.position.set(
        box.home.x,
        box.home.y + box.out * box.size.tall * 0.12,
        box.home.z + box.out * box.size.deep * 2.2,
      );
      box.mesh.rotation.set(-box.out * 0.18, SHELF_TURN, 0);
    }
    // The lid opens a little: lifted off the tray and tipped back, still over the box.
    const lift = easeOut(Math.min(1, box.open / 0.5));
    box.lid.position.set(0, box.size.tall * 0.22 * lift, box.size.deep * 0.35 * lift);
    box.lid.rotation.x = -0.42 * lift;
    box.lid.visible = true;
    // The scenarios come out from under the lid and stand still in a row beside the box, each turned a little; the one
    // picked out wears its gold frame.
    const out = easeOut(Math.max(0, (box.open - 0.3) / 0.7));
    if (box.cards) box.mesh.updateMatrixWorld();
    const stand = box.cards ? floatLayout(box) : null;
    box.cards?.forEach((each, k) => {
      const shown = up && box.open > 0;
      each.visible = shown;
      if (!shown) return;
      const tall = box.size.tall * CLOSE_NEAR;
      const pointed = box === opened && k === hoveredCard ? 1 : 0;
      const frame = each.userData.frame as THREE.Mesh | undefined;
      if (frame) frame.visible = pointed > 0 && out > 0.95;
      restAt.copy(each.userData.rest as THREE.Vector3).applyMatrix4(box.mesh.matrixWorld);
      floatAt.copy(stand!.spots[k]!).multiplyScalar(CLOSE_NEAR).add(closeAt);
      each.position.lerpVectors(restAt, floatAt, out);
      // A small lift as it leaves the tray, then still; the one picked out rises a little, like a card pointed at.
      each.position.z += Math.sin(Math.PI * out) * tall * 0.35;
      const lift = (each.userData.lift as number | undefined) ?? 0;
      each.userData.lift = lift + (pointed - lift) * Math.min(1, dt * 10);
      each.position.y += (each.userData.lift as number) * tall * 0.1;
      each.quaternion.slerpQuaternions(box.mesh.quaternion, STANDING, out);
      // From the box's own scale in its tray to its full size beside it.
      const from = box.mesh.scale.x;
      const grow = from + ((stand!.width / (each.userData.cardW as number)) * CLOSE_NEAR - from) * out;
      each.scale.setScalar(grow);
    });
  }
  if (veil) {
    const goal = upClose() ? 0.62 : 0;
    const material = veil.material as THREE.MeshBasicMaterial;
    material.opacity = goal > material.opacity ? material.opacity + (goal - material.opacity) * Math.min(1, dt * 8) : 0;
    veil.visible = material.opacity > 0.01;
    focusBlur = (material.opacity / 0.62) * FOCUS_BLUR;
  }
  softenCabinet(focusBlur > 0.04);
  if (!active) return;
  placePicks();
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
  const areas = upClose() ? [backBar, floats] : [picks];
  if (!direction || !areas.every(Boolean)) return false;
  placePicks();
  const buttons = areas
    .flatMap((area) => [...area!.querySelectorAll<HTMLElement>("button")])
    .filter((button) => !button.hidden && button.getClientRects().length > 0);
  const now = document.activeElement as HTMLElement | null;
  event.preventDefault();
  if (!now || !buttons.includes(now)) {
    (upClose() ? floats!.querySelector<HTMLElement>("button") : buttons[0])?.focus({ preventScroll: true });
    return true;
  }
  // Beside a box up close, left and right step through its scenarios in order, whether or not they have finished
  // coming out of the box (their places on the screen are still moving until then).
  if (upClose() && now.classList.contains("scn-float") && (direction === "left" || direction === "right")) {
    const row = [...floats!.querySelectorAll<HTMLElement>(".scn-float")];
    row[row.indexOf(now) + (direction === "right" ? 1 : -1)]?.focus({ preventScroll: true });
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
  // HEADROOM: the camera aims this far above the bookcase's middle, so the case sits lower and the heading over its
  // top-left has room (Adam, 28 Nov 2026); the view's height grows by as much so the bottom shelf stays in.
  const HEADROOM = 0.45;
  const halfH = (layout.top - layout.bottom + 1.6) / 2 + HEADROOM;
  const distance = Math.max(halfW / (tan * aspect), halfH / tan);
  const middle = (layout.top + layout.bottom) / 2 + HEADROOM;
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
  floats = el("div", "scn-floats");
  floats.setAttribute("role", "group");
  floats.hidden = true;
  backBar = el("div", "scn-back-bar");
  backBar.hidden = true;
  const back = el("button", "btn btn-secondary scn-back", "Back to the shelf");
  back.type = "button";
  back.onclick = () => closeBox();
  backBar.append(back);
  const holder = el("div", "scn-shelf");
  holder.append(picks, floats, card, backBar);
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
    const lit = given.onTable(slot.product);
    const lock = given.boxLock(slot.product);
    const art = arts[i] ?? null;
    const own = owns[i] ?? null;
    const { mesh, lid, maps, faces } = buildBox(slot.product, slot.size, lit, lock !== null, art, own, i);
    for (const map of maps) renderer.initTexture(map);
    // On its lit stand.
    // Just clear of its stand (a box's foot on the stand's top, face to face, flickered too).
    const home = slot.at.clone().setY(slot.at.y + STAND + 0.004);
    group!.add(buildPlinth(slot.at, slot.size, lit, lock !== null));
    mesh.position.copy(home);
    mesh.rotation.y = SHELF_TURN;
    group!.add(mesh);
    const button = el("button", "scn-box", slot.product.name);
    button.type = "button";
    button.dataset.scn = `box:${slot.product.code}`;
    const label = boxLabel({ product: slot.product, lit, lock });
    if (label !== slot.product.name) button.setAttribute("aria-label", label);
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
      lock,
      art,
      own,
      faces,
      looks: "",
      mesh,
      lid,
      home,
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
  /** How soft the cabinet behind a box up close is drawn. */
  blur: () => focusBlur,
  /** The camera is here: the boxes answer the pointer. */
  enter() {
    active = true;
    placePicks();
    if (upClose()) paint();
    else {
      // The keyboard and a pad start on the box the road is at, so no one steps through every box to reach it.
      const at = boxes.find((box) => hooks?.rows(box.product).some((row) => row.status === "next"));
      (at ?? boxes.find((box) => box.lit) ?? boxes[0])?.button.focus({ preventScroll: true });
    }
  },
  leave() {
    active = false;
    hovered = -1;
    renderer.domElement.style.cursor = "default";
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
