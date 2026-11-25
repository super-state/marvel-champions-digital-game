/**
 * The campaign shelf, the 3D table's front door: the campaigns stand on a wooden table as retail boxes, with a cube
 * shelf of other game boxes in the dim room behind. Pick one and it tips onto its back, the lid lifts off and is set
 * aside, and the villain card rises out of the tray towards you. A campaign marked `open: false` is sealed ("coming
 * soon") and won't open; all three Core Set villains are open.
 *
 * It lies over the table page (`main.ts` loads it when the page opens on the shelf, and again for New game), with its
 * own renderer. Play deals the game on the table underneath, out of sight, then flies every piece from the box to the
 * spot the table drew it on and fades away over the real table. `?open=klaw` jumps straight to an opened box, `&play`
 * presses Play, `&at=1.8` freezes the opening and `&hold=2.4` the move onto the table (for checks and screenshots).
 *
 * The box prints are our own design drawn on canvases at load, with the villain's art cropped from its card scan.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { TokenKit } from "../tokens3d.js";
import { matPrint, type BattleTable } from "../table.js";
import type { VillainId } from "../model.js";
import "../design.css";
import "./boxes.css";

type CampaignId = "rhino" | "klaw" | "ultron";

interface Campaign {
  id: CampaignId;
  name: string;
  number: string;
  scan: string;
  /** The art window of the scan, clear of the title bar, the stat badges and the text box: x, y, width, height. */
  crop: readonly [number, number, number, number];
  deep: string;
  mid: string;
  accent: string;
  /** Text colour on the accent. */
  ink: string;
  difficulty: number;
  blurb: string;
  /** False: greyed out and sealed. */
  open: boolean;
  /** Sealed until the player unlocks it, saying how ("Beat Rhino to unlock"); otherwise sealed means coming soon. */
  lock?: string;
  /** The villain Play deals; absent while that villain's game isn't on the table yet. */
  villain?: VillainId;
}

const CARDS = "/card-art/bundles/cards/";
const CAMPAIGNS: readonly Campaign[] = [
  {
    id: "rhino",
    name: "RHINO",
    number: "01",
    scan: `${CARDS}01094.png`,
    crop: [150, 128, 460, 372],
    deep: "#141a14",
    mid: "#4b5a45",
    accent: "#9fc25a",
    ink: "#10160b",
    difficulty: 1,
    blurb: "Rhino is smashing through the city. Knock him down before his schemes pile up.",
    open: true,
    villain: "rhino",
  },
  {
    id: "klaw",
    name: "KLAW",
    number: "02",
    scan: `${CARDS}01113.png`,
    crop: [150, 128, 460, 372],
    deep: "#1d0a26",
    mid: "#5a2177",
    accent: "#e2364b",
    ink: "#fff3f0",
    difficulty: 2,
    blurb: "Klaw and his sound weapons are after a secret stash. Stop him before he gets away with it.",
    open: true,
    villain: "klaw",
  },
  {
    id: "ultron",
    name: "ULTRON",
    number: "03",
    scan: `${CARDS}01134.png`,
    crop: [150, 128, 460, 372],
    deep: "#1a1512",
    mid: "#8a4b22",
    accent: "#ff8a2a",
    ink: "#1a0d04",
    difficulty: 3,
    blurb: "Ultron turns the cards in your own deck into his Drones. Break them, then him, before his countdown ends.",
    open: true,
    villain: "ultron",
  },
];

// ---------- sizes (the box lying flat: X across, Y up out of the lid, Z down the front picture) ----------

const W = 2.4;
const H = 3.0;
const D = 1.0;
const WALL = 0.03;
const LID_DROP = 0.5;
const INSET = 0.026;
const BASE_H = D - 0.04;
const CARD_W = 1.02;
const CARD_H = 1.43;

const OPEN_AT = new THREE.Vector3(0.45, 0, 0.35);
const LID_REST = new THREE.Vector3(W + 0.45, -(D - LID_DROP), 0.25);
// Out to the left of the open tray, near enough to read as part of the box (Adam, 2026-11-24: it sat too far left).
const CARD_END = new THREE.Vector3(-1.9, 2.55, 1.85);
const CARD_END_SCALE = 1.5;
const SHELF_X = [-3.4, 0, 3.4];
const SHELF_YAW = [-0.3, 0.26, 0.3];

const CAM_SHELF = { pos: new THREE.Vector3(0, 4.1, 10.2), at: new THREE.Vector3(0, 1.3, 0) };
const CAM_OPEN = { pos: new THREE.Vector3(0.1, 8.0, 7.9), at: new THREE.Vector3(0.1, 0.55, 0.75) };

/** Seconds into the opening at which everything has landed. */
const OPENED = 3.4;
/** How high the villain card lifts, flat, before it turns: clear of the tray's walls (D tall) with room to spare. */
const CARD_LIFT = D + 0.8;

// ---------- small helpers ----------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const span = (s: number, from: number, length: number) => ease(clamp01((s - from) / length));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return [c, c.getContext("2d")!];
}

let maxAnisotropy = 8;
function texture(source: HTMLCanvasElement | HTMLImageElement): THREE.Texture {
  const t = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAnisotropy;
  t.needsUpdate = true;
  return t;
}

let kit: TokenKit | null = null;
const tokens = () => (kit ??= new TokenKit(maxAnisotropy, () => {}));

/** Greys out a print: most of the colour gone, a little darker. */
function greyOut(c: HTMLCanvasElement) {
  const g = c.getContext("2d")!;
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const grey = 0.3 * px[i]! + 0.59 * px[i + 1]! + 0.11 * px[i + 2]!;
    for (let k = 0; k < 3; k++) px[i + k] = (px[i + k]! * 0.12 + grey * 0.88) * 0.72;
  }
  g.putImageData(data, 0, 0);
}

function halftone(g: CanvasRenderingContext2D, width: number, height: number, colour: string, alpha: number) {
  g.save();
  g.fillStyle = colour;
  g.globalAlpha = alpha;
  const step = 18;
  for (let y = 0; y < height + step; y += step)
    for (let x = (y / step) % 2 ? step / 2 : 0; x < width + step; x += step) {
      const r = 2 + 5 * (y / height);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  g.restore();
}

function polygon(g: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/** Draws the scan's art window to cover the box `x, y, w, h`. */
function drawArt(g: CanvasRenderingContext2D, c: Campaign, art: HTMLImageElement | null, box: number[]) {
  const [x, y, w, h] = box as [number, number, number, number];
  if (!art) {
    g.fillStyle = c.mid;
    g.fillRect(x, y, w, h);
    return;
  }
  const [sx, sy, sw, sh] = c.crop;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  g.drawImage(art, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ---------- the prints ----------

function frontPrint(c: Campaign, art: HTMLImageElement | null): HTMLCanvasElement {
  const [cv, g] = canvas(1024, 1280);
  const bg = g.createLinearGradient(0, 0, 1024, 1280);
  bg.addColorStop(0, c.mid);
  bg.addColorStop(1, c.deep);
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 1280);
  halftone(g, 1024, 1280, c.accent, 0.16);

  // A burst of speed lines behind the panel.
  g.save();
  g.translate(512, 560);
  g.strokeStyle = c.accent;
  g.globalAlpha = 0.22;
  for (let i = 0; i < 48; i++) {
    g.rotate((Math.PI * 2) / 48);
    g.lineWidth = i % 2 ? 6 : 14;
    g.beginPath();
    g.moveTo(330, 0);
    g.lineTo(900, 0);
    g.stroke();
  }
  g.restore();

  const panel = [
    [58, 150],
    [970, 116],
    [956, 932],
    [42, 966],
  ] as const;
  g.save();
  polygon(g, panel);
  g.clip();
  drawArt(g, c, art, [42, 116, 928, 850]);
  const shade = g.createLinearGradient(0, 700, 0, 966);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = shade;
  g.fillRect(0, 700, 1024, 270);
  g.restore();
  g.lineJoin = "round";
  polygon(g, panel);
  g.lineWidth = 16;
  g.strokeStyle = "#0b0705";
  g.stroke();

  // The campaign tab and the line across the top.
  polygon(g, [
    [36, 34],
    [452, 34],
    [430, 108],
    [36, 108],
  ]);
  g.fillStyle = c.accent;
  g.fill();
  g.lineWidth = 8;
  g.stroke();
  g.fillStyle = c.ink;
  g.font = "900 44px 'Public Sans'";
  g.fillText(`CAMPAIGN ${c.number}`, 62, 88);
  g.fillStyle = "#f4ead8";
  g.textAlign = "right";
  g.font = "900 30px 'Public Sans'";
  g.fillText("CO-OP CARD GAME", 986, 84);

  // The villain's name, comic style, breaking out of the bottom of the panel.
  g.save();
  g.translate(512, 1118);
  g.rotate(-0.045);
  g.textAlign = "center";
  g.font = "270px Bangers";
  g.lineJoin = "round";
  g.lineWidth = 34;
  g.strokeStyle = "#0b0705";
  g.strokeText(c.name, 10, 12);
  g.strokeText(c.name, 0, 0);
  const fill = g.createLinearGradient(0, -200, 0, 0);
  fill.addColorStop(0, "#fff2a8");
  fill.addColorStop(0.55, "#ffd54a");
  fill.addColorStop(1, "#f29a1c");
  g.fillStyle = fill;
  g.fillText(c.name, 0, 0);
  g.restore();

  // The retail strip along the bottom.
  g.fillStyle = "#0b0705";
  g.fillRect(0, 1192, 1024, 88);
  g.textAlign = "left";
  g.fillStyle = "#e9dcc4";
  g.font = "700 30px 'Public Sans'";
  g.fillText("1–4 PLAYERS   ·   45–90 MIN   ·   14+", 40, 1248);
  g.textAlign = "right";
  g.fillText("DIFFICULTY", 856, 1248);
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.arc(892 + i * 38, 1238, 13, 0, Math.PI * 2);
    g.fillStyle = i < c.difficulty ? c.accent : "#3a3029";
    g.fill();
  }

  if (!c.open) {
    greyOut(cv);
    comingSoon(g, 512, 560, 1, -0.32, c.lock?.toUpperCase());
  }
  return cv;
}

function comingSoon(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  text = "COMING SOON",
) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(size, size);
  g.fillStyle = "#1d2126";
  g.fillRect(-760, -72, 1520, 144);
  g.fillStyle = "#c9cdd2";
  g.fillRect(-760, -72, 1520, 8);
  g.fillRect(-760, 64, 1520, 8);
  g.fillStyle = "#f1f3f5";
  g.textAlign = "center";
  g.font = "118px Bangers";
  // A longer seal ("BEAT RHINO TO UNLOCK") shrinks to stay inside the band.
  const fit = Math.min(1, 1400 / g.measureText(text).width);
  g.font = `${Math.floor(118 * fit)}px Bangers`;
  g.fillText(text, 0, 42 * fit);
  g.restore();
}

/** The long side of the lid: the name reads up the spine, like a box on a shelf. */
function spinePrint(c: Campaign): HTMLCanvasElement {
  const [cv, g] = canvas(1536, 184);
  const bg = g.createLinearGradient(0, 0, 1536, 0);
  bg.addColorStop(0, c.deep);
  bg.addColorStop(1, c.mid);
  g.fillStyle = bg;
  g.fillRect(0, 0, 1536, 184);
  halftone(g, 1536, 184, c.accent, 0.12);
  polygon(g, [
    [0, 0],
    [190, 0],
    [160, 184],
    [0, 184],
  ]);
  g.fillStyle = c.accent;
  g.fill();
  g.fillStyle = c.ink;
  g.font = "120px Bangers";
  g.textAlign = "center";
  g.fillText(c.number, 84, 138);
  g.textAlign = "left";
  g.font = "138px Bangers";
  g.lineWidth = 16;
  g.lineJoin = "round";
  g.strokeStyle = "#0b0705";
  g.strokeText(c.name, 230, 146);
  g.fillStyle = "#ffd54a";
  g.fillText(c.name, 230, 146);
  g.textAlign = "right";
  g.fillStyle = "#e9dcc4";
  g.font = "900 34px 'Public Sans'";
  g.fillText("CAMPAIGN", 1500, 106);
  g.fillStyle = "#0b0705";
  g.fillRect(0, 0, 1536, 6);
  g.fillRect(0, 178, 1536, 6);
  if (!c.open) greyOut(cv);
  return cv;
}

/** The short sides of the lid. */
function bandPrint(c: Campaign): HTMLCanvasElement {
  const [cv, g] = canvas(1024, 154);
  g.fillStyle = c.deep;
  g.fillRect(0, 0, 1024, 154);
  g.fillStyle = c.accent;
  g.fillRect(0, 110, 1024, 12);
  g.fillStyle = "#e9dcc4";
  g.font = "900 40px 'Public Sans'";
  g.textAlign = "center";
  g.fillText(`CAMPAIGN ${c.number}  ·  ${c.name}`, 512, 78);
  if (!c.open) greyOut(cv);
  return cv;
}

/** The floor of the tray, seen once the lid is off. */
function trayPrint(c: Campaign): HTMLCanvasElement {
  const [cv, g] = canvas(512, 640);
  g.fillStyle = c.deep;
  g.fillRect(0, 0, 512, 640);
  halftone(g, 512, 640, c.accent, 0.1);
  g.save();
  g.translate(256, 600);
  g.rotate(-Math.PI / 2);
  g.globalAlpha = 0.16;
  g.fillStyle = c.accent;
  g.font = "250px Bangers";
  g.fillText(c.name, 0, 0);
  g.restore();
  if (!c.open) greyOut(cv);
  return cv;
}

const GUIDE_W = 1.28;
const GUIDE_H = 1.02;

/** The campaign guide booklet's cover: a strip of the villain's art, the title, and a contents line. */
function guidePrint(c: Campaign, art: HTMLImageElement | null): HTMLCanvasElement {
  const [cv, g] = canvas(1024, Math.round((1024 * GUIDE_H) / GUIDE_W));
  const h = cv.height;
  g.fillStyle = "#efe6d2";
  g.fillRect(0, 0, 1024, h);
  // Paper grain.
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2400; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? "120,100,70" : "255,255,255"},${0.05 + rand() * 0.06})`;
    g.fillRect(rand() * 1024, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
  const strip = [
    [0, 0],
    [1024, 0],
    [1024, 360],
    [0, 420],
  ] as const;
  g.save();
  polygon(g, strip);
  g.clip();
  drawArt(g, c, art, [0, -40, 1024, 500]);
  const tint = g.createLinearGradient(0, 0, 0, 420);
  tint.addColorStop(0, "rgba(0,0,0,0)");
  tint.addColorStop(1, c.deep + "cc");
  g.fillStyle = tint;
  g.fillRect(0, 0, 1024, 420);
  g.restore();
  polygon(g, strip);
  g.lineWidth = 10;
  g.strokeStyle = "#0b0705";
  g.stroke();
  g.fillStyle = c.accent;
  polygon(g, [
    [0, 420],
    [1024, 360],
    [1024, 382],
    [0, 442],
  ]);
  g.fill();

  g.save();
  g.translate(56, 560);
  g.rotate(-0.04);
  g.font = "150px Bangers";
  g.lineJoin = "round";
  g.lineWidth = 18;
  g.strokeStyle = "#0b0705";
  g.strokeText(c.name, 0, 0);
  g.fillStyle = "#ffd54a";
  g.fillText(c.name, 0, 0);
  g.restore();
  g.fillStyle = "#1c140e";
  g.font = "900 54px 'Public Sans'";
  g.fillText("CAMPAIGN GUIDE", 60, 650);
  g.fillStyle = "#6f6352";
  g.font = "700 28px 'Public Sans'";
  g.fillText(`STORY  ·  SETUP  ·  RULES  ·  CAMPAIGN ${c.number}`, 60, 702);
  g.fillStyle = c.mid;
  g.fillRect(0, h - 26, 1024, 26);
  // The stapled spine down the left edge.
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(0, 0, 10, h);
  g.fillStyle = "#9aa1a8";
  for (const y of [h * 0.28, h * 0.72]) g.fillRect(3, y - 22, 5, 44);
  if (!c.open) greyOut(cv);
  return cv;
}

/** Edges of a stack of pages: thin cream lines. */
function pagesPrint(): HTMLCanvasElement {
  const [cv, g] = canvas(256, 32);
  g.fillStyle = "#e8dfca";
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = "rgba(90,70,45,0.35)";
  for (let y = 2; y < 32; y += 4) g.fillRect(0, y, 256, 1);
  return cv;
}

/**
 * A plank table top, 8 boards to the texture. Every wave in the grain repeats a whole number of times across the
 * texture and the boards end exactly at its top and bottom, so repeated tiles meet with no visible seam.
 */
function woodPrint(): HTMLCanvasElement {
  const size = 2048;
  const planks = 8;
  const ph = size / planks;
  const TAU = Math.PI * 2;
  const [cv, g] = canvas(size, size);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wave = (x: number, cycles: number, phase: number) => Math.sin((TAU * cycles * x) / size + phase);
  for (let p = 0; p < planks; p++) {
    const top = p * ph;
    const tone = 0.8 + rand() * 0.32;
    const warm = 0.88 + rand() * 0.2;
    g.fillStyle = `rgb(${82 * tone}, ${50 * tone}, ${28 * tone * warm})`;
    g.fillRect(0, top, size, ph);
    g.save();
    g.beginPath();
    g.rect(0, top, size, ph);
    g.clip();
    for (let i = 0; i < 7; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? "255,205,150" : "26,12,4"},${0.03 + rand() * 0.05})`;
      g.fillRect(0, top + rand() * ph, size, 12 + rand() * 50);
    }
    for (let i = 0; i < 120; i++) {
      const y0 = top + rand() * ph;
      const c1 = 1 + Math.floor(rand() * 3);
      const c2 = 4 + Math.floor(rand() * 7);
      const a1 = 2 + rand() * 9;
      const a2 = 0.4 + rand() * 2;
      const p1 = rand() * TAU;
      const p2 = rand() * TAU;
      g.strokeStyle =
        rand() < 0.55 ? `rgba(22,10,3,${0.07 + rand() * 0.16})` : `rgba(170,112,64,${0.05 + rand() * 0.1})`;
      g.lineWidth = 0.7 + rand() * 2.4;
      g.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const y = y0 + a1 * wave(x, c1, p1) + a2 * wave(x, c2, p2);
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    // A knot now and then, drawn three times so one near an edge carries on into the next tile.
    if (rand() < 0.7) {
      const kx = rand() * size;
      const ky = top + ph * (0.3 + rand() * 0.4);
      for (const dx of [-size, 0, size]) {
        for (let r = 7; r >= 1; r--) {
          g.beginPath();
          g.ellipse(kx + dx, ky, r * 15, r * 4.2, 0, 0, TAU);
          g.strokeStyle = `rgba(30,14,5,${0.1 + (7 - r) * 0.03})`;
          g.lineWidth = 2;
          g.stroke();
        }
        g.beginPath();
        g.ellipse(kx + dx, ky, 12, 4, 0, 0, TAU);
        g.fillStyle = "rgba(26,11,3,0.6)";
        g.fill();
      }
    }
    g.restore();
    // The gap between boards, and where one board butts against the next one along.
    g.fillStyle = "rgba(10,5,2,0.85)";
    g.fillRect(0, top, size, 4);
    g.fillStyle = "rgba(255,220,180,0.07)";
    g.fillRect(0, top + 4, size, 2);
    const joint = rand() * size;
    g.fillStyle = "rgba(10,5,2,0.7)";
    g.fillRect(joint, top, 3, ph);
  }
  return cv;
}

function spineStripes(colour: string, light: string): HTMLCanvasElement {
  const [cv, g] = canvas(64, 256);
  g.fillStyle = colour;
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = light;
  g.fillRect(0, 30, 64, 14);
  g.fillRect(0, 196, 64, 30);
  g.globalAlpha = 0.5;
  g.fillRect(14, 70, 36, 100);
  return cv;
}

// ---------- the room ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
// The shelf's own layer over the table page: the room, its headings, and the opened box's card.
const root = document.createElement("div");
root.id = "shelf";
root.className = "shelf";
root.setAttribute("role", "dialog");
root.setAttribute("aria-label", "Choose your campaign");
root.hidden = true;
root.tabIndex = -1;
root.innerHTML = `
  <div class="shelf-stage"></div>
  <header class="shelf-head">
    <p class="eyebrow">Marvel Champions</p>
    <h1>Choose your campaign</h1>
  </header>
  <div class="shelf-picks visually-hidden" role="group" aria-label="Campaigns"></div>
  <p class="shelf-hover-tag" hidden></p>
  <p class="shelf-hint">Pick a box to open it</p>
  <section class="shelf-opened" hidden>
    <p class="eyebrow shelf-kicker"></p>
    <h2 class="shelf-title"></h2>
    <p class="shelf-blurb"></p>
    <div class="shelf-buttons">
      <button type="button" class="btn btn-primary" id="shelf-play">Play</button>
      <button type="button" class="btn btn-secondary" id="shelf-back">Back to the shelf</button>
    </div>
  </section>
  <p class="shelf-toast" role="status" hidden></p>`;
document.body.append(root);
root.querySelector(".shelf-stage")!.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0a08);
const FOG_NEAR = 13;
const FOG_FAR = 26;
scene.fog = new THREE.Fog(0x0d0a08, FOG_NEAR, FOG_FAR);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);

scene.add(new THREE.HemisphereLight(0xffe8cc, 0x1a120c, 0.45));
const key = new THREE.SpotLight(0xffe2b8, 340, 0, 0.62, 0.65, 2);
key.position.set(2.2, 10.5, 6.5);
key.target.position.set(0, 0.6, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0x9db4ff, 0.55);
fill.position.set(-7, 4, 6);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xff9a50, 0.9);
rim.position.set(0, 5, -8);
scene.add(rim);
const shelfLight = new THREE.SpotLight(0xffd7a0, 260, 0, 0.9, 1, 2);
shelfLight.position.set(0, 6.5, -3.5);
shelfLight.target.position.set(0, 0.4, -8.6);
scene.add(shelfLight, shelfLight.target);

// ---------- the soft backdrop ----------
// The shelf and the wall live on their own layer. Each frame they are drawn small, blurred, and laid behind the table
// as the scene's background, like a camera focused on the boxes. The table and the boxes are drawn sharp on top.

const BACKDROP = 1;
const backdropColour = new THREE.Color(0x0d0a08);
const backdrop = {
  a: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }),
  b: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }),
  material: new THREE.ShaderMaterial({
    uniforms: { source: { value: null }, step: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // A 9-tap Gaussian along `step`, run across then down, twice.
    fragmentShader: `
      uniform sampler2D source; uniform vec2 step; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(source, vUv) * 0.2270270270;
        c += (texture2D(source, vUv + step * 1.3846153846) + texture2D(source, vUv - step * 1.3846153846)) * 0.3162162162;
        c += (texture2D(source, vUv + step * 3.2307692308) + texture2D(source, vUv - step * 3.2307692308)) * 0.0702702703;
        gl_FragColor = c;
      }`,
    depthTest: false,
    depthWrite: false,
  }),
  scene: new THREE.Scene(),
  camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
};
backdrop.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdrop.material));

function blurPass(from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget, x: number, y: number) {
  backdrop.material.uniforms.source!.value = from.texture;
  (backdrop.material.uniforms.step!.value as THREE.Vector2).set(x / from.width, y / from.height);
  renderer.setRenderTarget(to);
  renderer.render(backdrop.scene, backdrop.camera);
}

function renderFrame() {
  camera.layers.set(BACKDROP);
  scene.background = backdropColour;
  renderer.setRenderTarget(backdrop.a);
  renderer.render(scene, camera);
  for (let i = 0; i < 2; i++) {
    blurPass(backdrop.a, backdrop.b, 1.6, 0);
    blurPass(backdrop.b, backdrop.a, 0, 1.6);
  }
  renderer.setRenderTarget(null);
  camera.layers.set(0);
  scene.background = backdrop.a.texture;
  renderer.render(scene, camera);
}

function buildTable() {
  const wood = texture(woodPrint());
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  // Whole repeats only: a fraction would cut a board in half at the table's edge.
  wood.repeat.set(2, 1);
  const top = new THREE.MeshPhysicalMaterial({
    map: wood,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
  });
  const side = new THREE.MeshStandardMaterial({ color: 0x24150b, roughness: 0.7 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 15), [side, side, top, side, side, side]);
  table.position.set(0, -0.25, 2.4);
  table.receiveShadow = true;
  scene.add(table);

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 30),
    new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.95 }),
  );
  wall.position.set(0, 4, -9.9);
  wall.layers.set(BACKDROP);
  scene.add(wall);
}

/** A cube shelf of other game boxes behind the table, the kind of shelf people who play this game have at home. */
function buildShelf() {
  const frame = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 });
  const shelf = new THREE.Group();
  const cols = 6;
  const rows = 3;
  const cube = 1.5;
  const board = 0.12;
  const depth = 1.6;
  const width = cols * cube + (cols + 1) * board;
  const height = rows * cube + (rows + 1) * board;
  for (let c = 0; c <= cols; c++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(board, height, depth), frame);
    post.position.set(-width / 2 + board / 2 + c * (cube + board), height / 2, 0);
    shelf.add(post);
  }
  for (let r = 0; r <= rows; r++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(width, board, depth), frame);
    plank.position.set(0, board / 2 + r * (cube + board), 0);
    shelf.add(plank);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.04), frame);
  back.position.set(0, height / 2, -depth / 2);
  shelf.add(back);

  const palette = [
    ["#7b2d26", "#d9a441"],
    ["#2f4b6e", "#e3e0d3"],
    ["#5d6b3a", "#efe2b8"],
    ["#8a6a2a", "#241a10"],
    ["#4a3560", "#e7b94a"],
    ["#2d5a5a", "#f0e6d0"],
    ["#6e3d1f", "#f2c46b"],
    ["#3b3f46", "#d34b3a"],
  ] as const;
  const spines = palette.map(([colour, light]) => {
    const t = texture(spineStripes(colour, light));
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.45 });
  });
  const plain = palette.map(([colour]) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 }));
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const left = -width / 2 + board + c * (cube + board);
      const floor = board + r * (cube + board);
      const kind = rand();
      if (kind < 0.12) continue;
      if (kind < 0.62) {
        // Boxes standing like books, spines out, sometimes one leaning.
        let x = left + 0.04;
        while (x < left + cube - 0.3) {
          const thick = 0.18 + rand() * 0.22;
          const tall = 1.05 + rand() * 0.33;
          const pick = Math.floor(rand() * palette.length);
          const geo = new THREE.BoxGeometry(thick, tall, 1.3);
          const m = plain[pick]!;
          const book = new THREE.Mesh(geo, [m, m, m, m, spines[pick]!, m]);
          book.position.set(x + thick / 2, floor + tall / 2, 0.08);
          shelf.add(book);
          x += thick + 0.015;
        }
      } else {
        // A stack of boxes lying flat.
        let y = floor;
        const count = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < count; i++) {
          const thick = 0.22 + rand() * 0.2;
          const pick = Math.floor(rand() * palette.length);
          const box = new THREE.Mesh(new THREE.BoxGeometry(1.3 - rand() * 0.15, thick, 1.3), plain[pick]!);
          box.position.set(left + cube / 2 + (rand() - 0.5) * 0.08, y + thick / 2, 0.08);
          box.rotation.y = (rand() - 0.5) * 0.08;
          shelf.add(box);
          y += thick;
        }
      }
    }
  shelf.position.set(0, -1.1, -8.7);
  shelf.traverse((o) => o.layers.set(BACKDROP));
  scene.add(shelf);
}

// ---------- a campaign box ----------

interface Box {
  campaign: Campaign;
  index: number;
  group: THREE.Group;
  lid: THREE.Group;
  card: THREE.Group;
  /** Where the villain card sits in the tray, in the box's own frame. */
  cardInTray: THREE.Matrix4;
  /** The encounter deck and the campaign guide in the tray: where cards leave from on the way to the table. */
  deck: THREE.Mesh;
  guide: THREE.Mesh;
  hover: number;
  shake: number;
}

function buildBox(c: Campaign, index: number, art: HTMLImageElement | null, backs: Backs): Box {
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  group.userData.box = index;

  const board = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.deep).multiplyScalar(0.9), roughness: 0.7 });
  const greyBoard = new THREE.MeshStandardMaterial({ color: 0x8d877d, roughness: 0.9 });
  const gloss = (map: THREE.Texture) =>
    new THREE.MeshPhysicalMaterial({
      map,
      roughness: c.open ? 0.42 : 0.18,
      clearcoat: c.open ? 0.55 : 1,
      clearcoatRoughness: c.open ? 0.3 : 0.05,
    });
  const shadowed = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // The lid: a shell a little bigger than the tray, printed on all five outer faces.
  const lid = new THREE.Group();
  const slab = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), greyBoard));
    m.position.set(x, y, z);
    lid.add(m);
  };
  slab(W, WALL, H, 0, D - WALL / 2, 0);
  slab(WALL, LID_DROP, H, W / 2 - WALL / 2, D - LID_DROP / 2, 0);
  slab(WALL, LID_DROP, H, -W / 2 + WALL / 2, D - LID_DROP / 2, 0);
  slab(W, LID_DROP, WALL, 0, D - LID_DROP / 2, H / 2 - WALL / 2);
  slab(W, LID_DROP, WALL, 0, D - LID_DROP / 2, -H / 2 + WALL / 2);
  const print = (geometry: THREE.PlaneGeometry, material: THREE.Material, place: (m: THREE.Mesh) => void) => {
    const m = new THREE.Mesh(geometry, material);
    m.receiveShadow = true;
    place(m);
    lid.add(m);
  };
  const front = gloss(texture(frontPrint(c, art)));
  print(new THREE.PlaneGeometry(W, H), front, (m) => {
    m.rotation.x = -Math.PI / 2;
    m.position.y = D + 0.002;
  });
  const spine = gloss(texture(spinePrint(c)));
  for (const side of [1, -1])
    print(new THREE.PlaneGeometry(H, LID_DROP), spine, (m) => {
      m.rotation.y = (side * Math.PI) / 2;
      m.position.set(side * (W / 2 + 0.002), D - LID_DROP / 2, 0);
    });
  const band = gloss(texture(bandPrint(c)));
  for (const side of [1, -1])
    print(new THREE.PlaneGeometry(W, LID_DROP), band, (m) => {
      m.rotation.y = side > 0 ? 0 : Math.PI;
      m.position.set(0, D - LID_DROP / 2, side * (H / 2 + 0.002));
    });
  group.add(lid);

  // The tray, a touch smaller, printed inside.
  const tray = new THREE.Group();
  const innerW = W - 2 * INSET;
  const innerH = H - 2 * INSET;
  const wall = (w: number, d: number, x: number, z: number) => {
    const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, BASE_H, d), board));
    m.position.set(x, BASE_H / 2, z);
    tray.add(m);
  };
  wall(WALL, innerH, innerW / 2 - WALL / 2, 0);
  wall(WALL, innerH, -innerW / 2 + WALL / 2, 0);
  wall(innerW, WALL, 0, innerH / 2 - WALL / 2);
  wall(innerW, WALL, 0, -innerH / 2 + WALL / 2);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(innerW, 0.03, innerH),
    new THREE.MeshStandardMaterial({ map: texture(trayPrint(c)), roughness: 0.8 }),
  );
  floor.position.y = 0.015;
  floor.receiveShadow = true;
  tray.add(floor);

  // What's inside: the encounter deck, some tokens, and the villain card on top of the deck slot.
  const deckTop = new THREE.MeshStandardMaterial({ map: backs.encounter, roughness: 0.6 });
  const edges = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.9 });
  const deck = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 0.26, CARD_H), [edges, edges, deckTop, edges, edges, edges]),
  );
  deck.position.set(0.55, 0.03 + 0.13, 0.55);
  tray.add(deck);
  // The villain's later stages, under the villain card.
  const stagesTop = new THREE.MeshStandardMaterial({ map: backs.villain, roughness: 0.6 });
  const stages = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 0.08, CARD_H), [edges, edges, stagesTop, edges, edges, edges]),
  );
  stages.position.set(-0.55, 0.03 + 0.04, 0.55);
  stages.rotation.y = -0.04;
  tray.add(stages);
  // The campaign guide: a stapled booklet in the top corner.
  const pages = new THREE.MeshStandardMaterial({ map: texture(pagesPrint()), roughness: 0.9 });
  const cover = new THREE.MeshPhysicalMaterial({
    map: texture(guidePrint(c, art)),
    roughness: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  });
  const guide = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(GUIDE_W, 0.035, GUIDE_H), [pages, pages, cover, pages, pages, pages]),
  );
  guide.position.set(-0.5, 0.03 + 0.0175, -0.84);
  guide.rotation.y = 0.035;
  tray.add(guide);

  // The same tokens the game table uses, loose in the other corner.
  const loose: [name: string, count: number, x: number, y: number, z: number, turn: number][] = [
    ["damage", 3, 0.47, 0, -1.13, 0.2],
    ["damage", 1, 0.88, 0, -1.2, -0.4],
    ["damage", 1, 0.86, 0.053, -1.15, 0.9],
    ["threat", 2, 0.5, 0, -0.78, 0.1],
    ["acceleration", 1, 0.86, 0, -0.8, -0.2],
    ["stunned", 1, 0.48, 0, -0.45, 0.12],
    ["tough", 1, 0.93, 0, -0.42, -0.1],
  ];
  for (const [name, count, x, y, z, turn] of loose) {
    const token = tokens().build(name, count);
    token.rotation.set(-Math.PI / 2, 0, turn);
    token.position.set(x, 0.03 + y, z);
    token.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    tray.add(token);
  }
  group.add(tray);

  // The villain card is its own object so it can leave the box; `cardInTray` is where it lies inside.
  const card = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W, CARD_H),
    new THREE.MeshPhysicalMaterial({
      map: art ? texture(art) : null,
      color: art ? 0xffffff : new THREE.Color(c.mid),
      roughness: 0.35,
      clearcoat: 0.4,
    }),
  );
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W, CARD_H),
    new THREE.MeshStandardMaterial({ map: backs.villain, roughness: 0.5 }),
  );
  back.rotation.y = Math.PI;
  face.castShadow = back.castShadow = true;
  card.add(face, back);
  scene.add(card);
  const cardInTray = new THREE.Matrix4().compose(
    new THREE.Vector3(-0.55, 0.03 + 0.08 + 0.003, 0.55),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.04)),
    new THREE.Vector3(1, 1, 1),
  );

  group.traverse((o) => (o.userData.box = index));
  scene.add(group);
  return { campaign: c, index, group, lid, card, cardInTray, deck, guide, hover: 0, shake: 0 };
}

interface Backs {
  villain: THREE.Texture | null;
  encounter: THREE.Texture | null;
}

// ---------- the page ----------

const el = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T;
const head = el<HTMLElement>(".shelf-head");
const hoverTag = el<HTMLParagraphElement>(".shelf-hover-tag");
const hint = el<HTMLParagraphElement>(".shelf-hint");
const opened = el<HTMLElement>(".shelf-opened");
const toast = el<HTMLParagraphElement>(".shelf-toast");
const play = el<HTMLButtonElement>("#shelf-play");

let boxes: Box[] = [];
/** The open box, or -1 on the shelf. */
let chosen = -1;
/** A box asked for from the keyboard while another was still going back onto the shelf. */
let queued = -1;
/** How far into the opening the chosen box is, in seconds (0 = on the shelf, OPENED = all out). */
let s = 0;
let target = 0;
let hovered = -1;
/**
 * How far the camera leans after the pointer, eased: following the pointer straight jolted the whole shelf sideways
 * the first time the mouse moved after the page loaded (Adam, 2026-11-25: "the boxes still shake when they load up").
 */
let sway = 0;
const pointer = new THREE.Vector2(-9, -9);
const raycaster = new THREE.Raycaster();
let toastTimer = 0;

function say(text: string) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2600);
}

function choose(index: number) {
  const box = boxes[index]!;
  if (!box.campaign.open) {
    box.shake = 1;
    const name = `${box.campaign.name[0]}${box.campaign.name.slice(1).toLowerCase()}`;
    say(box.campaign.lock ? `${name} is locked. ${box.campaign.lock}.` : `${name} is coming soon.`);
    return;
  }
  chosen = index;
  queued = -1;
  target = OPENED;
  hovered = -1;
  hoverTag.hidden = true;
  hint.hidden = true;
  renderer.domElement.style.cursor = "default";
}

function close() {
  if (outro) return;
  target = 0;
  opened.hidden = true;
  // The keyboard goes back to the box it opened.
  el<HTMLElement>(".shelf-picks").querySelectorAll("button")[chosen]?.focus({ preventScroll: true });
}

function showOpened(c: Campaign) {
  el(".shelf-kicker").textContent = `Campaign ${c.number}`;
  el(".shelf-title").textContent = c.name;
  el(".shelf-blurb").textContent = c.blurb;
  play.textContent = `Play vs ${c.name[0]}${c.name.slice(1).toLowerCase()}`;
  play.onclick = () => {
    if (c.villain) beginPlay(c.villain);
    else say("This villain's table is still being built.");
  };
  opened.hidden = false;
  play.focus();
  // `&play` presses Play at once (for checks).
  if (c.villain && pressPlay) {
    pressPlay = false;
    beginPlay(c.villain);
  }
}

function pickAt(x: number, y: number): number {
  pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(
    boxes.map((b) => b.group),
    true,
  )[0];
  return hit ? (hit.object.userData.box as number) : -1;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  if (chosen >= 0) return;
  hovered = pickAt(event.clientX, event.clientY);
  renderer.domElement.style.cursor =
    hovered < 0 ? "default" : boxes[hovered]!.campaign.open ? "pointer" : "not-allowed";
});
renderer.domElement.addEventListener("pointerleave", () => (hovered = -1));
renderer.domElement.addEventListener("click", (event) => {
  if (chosen >= 0) return;
  const index = pickAt(event.clientX, event.clientY);
  if (index >= 0) choose(index);
});
el("#shelf-back").addEventListener("click", close);
// While the shelf is up, keys are the shelf's: none reach the table's own (Enter for End Turn, Escape for its menu,
// Ctrl+Z) on the page underneath. Listening on the window in the capture phase runs before every one of those.
addEventListener(
  "keydown",
  (event) => {
    if (root.hidden) return;
    event.stopPropagation();
    if (event.key === "Escape" && chosen >= 0) {
      event.preventDefault();
      close();
    }
  },
  { capture: true },
);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  const px = renderer.getPixelRatio() / 4;
  backdrop.a.setSize(Math.ceil(innerWidth * px), Math.ceil(innerHeight * px));
  backdrop.b.setSize(Math.ceil(innerWidth * px), Math.ceil(innerHeight * px));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

const aim = new THREE.Vector3();
const scratch = {
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  endQuat: new THREE.Quaternion(),
  matrix: new THREE.Matrix4(),
  look: new THREE.Object3D(),
};

function pose(time: number, dt: number) {
  const c = span(s, 0.15, 1.2);
  // Pull the camera back on narrow screens so all three boxes fit.
  const pullBack = Math.max(1, 1.45 / camera.aspect);
  camera.position.lerpVectors(CAM_SHELF.pos, CAM_OPEN.pos, c);
  aim.lerpVectors(CAM_SHELF.at, CAM_OPEN.at, c);
  const pull = lerp(pullBack, Math.max(1, 1.1 / camera.aspect), c);
  const near = camera.position.distanceTo(aim);
  camera.position.sub(aim).multiplyScalar(pull).add(aim);
  sway = lerp(sway, pointer.x > -2 ? pointer.x : 0, 1 - Math.exp(-dt * 3));
  camera.position.x += (1 - c) * sway * 0.35;
  // Play: the camera swings round to the game table's own angle.
  const toGame = outro ? span(outro.u, 0, 1.2) : 0;
  // The fog starts as far beyond the boxes as it does on a wide screen, however far a narrow one pulls the camera
  // back: otherwise a phone held upright sees the boxes through it, or not at all.
  const fog = scene.fog as THREE.Fog;
  const extra = near * (pull - 1) * (1 - toGame);
  fog.near = FOG_NEAR + extra;
  fog.far = FOG_FAR + extra;
  camera.position.lerp(CAM_GAME.pos, toGame);
  aim.lerp(CAM_GAME.at, toGame);
  camera.lookAt(aim);

  const moved = span(s, 0, 0.9);
  const others = span(s, 0, 0.8);
  for (const box of boxes) {
    const { group, index } = box;
    box.hover = lerp(box.hover, hovered === index && box.campaign.open ? 1 : 0, 1 - Math.exp(-dt * 12));
    box.shake = Math.max(0, box.shake - dt * 1.8);
    const h = box.hover;
    const shelf = new THREE.Vector3(SHELF_X[index]!, H / 2 + 0.2 * h, -D / 2 + 0.35 * h);
    group.rotation.z = Math.sin(time * 38) * 0.035 * box.shake;
    if (index === chosen) {
      group.position.lerpVectors(shelf, OPEN_AT, moved);
      group.position.y += Math.sin(Math.PI * moved) * 0.9;
      group.rotation.x = lerp(Math.PI / 2 - 0.1 * h, 0, moved);
      group.rotation.y = lerp(SHELF_YAW[index]!, 0, moved);
      // Play: the emptied box and its lid are cleared off the table to the side.
      if (outro) group.position.x += 16 * span(outro.u, 0.1, 1.0);
    } else {
      const away = chosen >= 0 ? others : 0;
      const side = Math.sign(SHELF_X[index]! - (chosen >= 0 ? SHELF_X[chosen]! : 0)) || 1;
      group.position.copy(shelf);
      group.position.x += side * 10 * away;
      group.position.z -= 3 * away;
      group.rotation.x = Math.PI / 2 - 0.1 * h;
      group.rotation.y = SHELF_YAW[index]!;
    }

    // The lid: up, then over to the side, landing top up.
    const { lid } = box;
    if (index === chosen) {
      const up = span(s, 1.0, 0.6);
      const aside = span(s, 1.55, 0.75);
      const lift = 1.45;
      lid.position.set(
        LID_REST.x * aside,
        aside > 0 ? lerp(lift, LID_REST.y, aside) + Math.sin(Math.PI * aside) * 0.55 : lift * up,
        LID_REST.z * aside,
      );
      lid.rotation.set(0, 0.14 * aside, -Math.sin(Math.PI * aside) * 0.4 + Math.sin(Math.PI * up) * 0.04);
    } else {
      lid.position.set(0, 0, 0);
      lid.rotation.set(0, 0, 0);
    }
    group.updateMatrixWorld(true);

    // The villain card rides in the tray, lifts straight up, still flat, until it is clear of the tray's walls, and
    // only then turns and travels out to face you.
    const lift = index === chosen ? span(s, 2.0, 0.5) : 0;
    const travel = index === chosen ? span(s, 2.4, 0.95) : 0;
    scratch.matrix.multiplyMatrices(group.matrixWorld, box.cardInTray);
    scratch.matrix.decompose(scratch.pos, scratch.quat, scratch.scale);
    scratch.pos.y += CARD_LIFT * lift;
    const end = CARD_END.clone();
    if (index === chosen && s >= OPENED - 0.001) end.y += Math.sin(time * 1.6) * 0.06;
    scratch.look.position.copy(end);
    scratch.look.lookAt(camera.position);
    scratch.endQuat.copy(scratch.look.quaternion);
    box.card.position.lerpVectors(scratch.pos, end, travel);
    box.card.position.y += Math.sin(Math.PI * travel) * 0.35;
    box.card.quaternion.slerpQuaternions(scratch.quat, scratch.endQuat, travel);
    box.card.scale.setScalar(lerp(1, CARD_END_SCALE, travel));
    if (index === chosen && travel >= 1) box.card.rotation.z += Math.sin(time * 1.1) * 0.02;
    // Play: it rises up out of view as the box clears; the table brings in its own villain card from above.
    if (index === chosen && outro) box.card.position.y += 9 * span(outro.u, 0.05, 0.75);
  }
}

function placeHoverTag() {
  if (hovered < 0 || chosen >= 0) {
    hoverTag.hidden = true;
    return;
  }
  const box = boxes[hovered]!;
  const top = new THREE.Vector3(0, 0, -H / 2).applyMatrix4(box.group.matrixWorld);
  top.y += 0.25;
  top.project(camera);
  hoverTag.style.left = `${((top.x + 1) / 2) * innerWidth}px`;
  hoverTag.style.top = `${((1 - top.y) / 2) * innerHeight}px`;
  hoverTag.textContent = box.campaign.open
    ? `Campaign ${box.campaign.number} · ${box.campaign.name}`
    : `${box.campaign.name} · ${box.campaign.lock ?? "coming soon"}`;
  hoverTag.hidden = false;
}

// ---------- Play: from the box onto the game table ----------
// Play deals the game on the table underneath, out of sight. Here the box clears away and the villain card lifts up out
// of view, the camera swings round to the table's own angle, and the table's own mat rolls out across the wooden
// table to exactly where the table has it. Then the room fades into the table's colour, and the table itself brings
// its pieces in, its own 3D cards landing one at a time (`BattleTable.enter`), then deals the hand and asks about the
// mulligan. Nothing is drawn twice, so there is no moment where a stand-in is swapped for the real card.

const CAM_GAME = { pos: new THREE.Vector3(0, 10.8, 8.3), at: new THREE.Vector3(0, 0, 0.4) };
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
}

let host: ShelfHost | null = null;
let pressPlay = false;
let outro: {
  u: number;
  launched: boolean;
  done: boolean;
  /** `&hold=1.2`: stop the shelf's part there (for screenshots). */
  hold: number;
} | null = null;
let stopped = false;

function beginPlay(villain: VillainId) {
  if (outro || !host) return;
  opened.hidden = true;
  // The game is dealt now, under the shelf, and waits out of sight until the table brings it in.
  host.deal(villain);
  outro = {
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
  print.anisotropy = maxAnisotropy;
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

function stepOutro(dt: number) {
  if (!outro || !host || outro.done) return;
  if (outro.u >= TARGETS_AT && !outro.launched) {
    const table = host.table();
    if (!table) return;
    outro.launched = true;
    launch(table, outro.u);
  }
  outro.u = Math.min(outro.u + dt, outro.hold, FADE_AT + FADE_LENGTH);
  placeMat(outro.u);
  head.style.opacity = String(1 - span(outro.u, 0, 0.4));
  // The room fades into the table's own colour, leaving the mat where the table's mat already lies.
  root.style.opacity = String(1 - span(outro.u, FADE_AT, FADE_LENGTH));
  if (outro.u >= FADE_AT + FADE_LENGTH) finishOutro();
}

/** The table is in front: hand it the page. The shelf keeps its room, ready for the next New game. */
function finishOutro() {
  if (!outro || !host) return;
  outro.done = true;
  stopped = true;
  root.hidden = true;
  // The shelf's own address settings (an opened box, a pressed Play) have had their turn: a reload opens the table.
  const params = new URLSearchParams(location.search);
  for (const key of ["open", "play", "at", "hold"]) params.delete(key);
  const query = params.toString();
  history.replaceState(history.state, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  host.shown();
}

/** Back to the room as it first stands: every box on the shelf, nothing in flight. */
function reset() {
  if (mat) {
    scene.remove(mat.flat, mat.roll);
    mat.flat.geometry.dispose();
    mat.flat.material.map?.dispose();
    mat.flat.material.dispose();
    mat.roll.geometry.dispose();
    (mat.roll.material as THREE.Material).dispose();
    mat = null;
  }
  outro = null;
  chosen = -1;
  s = target = 0;
  hovered = -1;
  head.style.opacity = "";
  hint.textContent = "Pick a box to open it";
  hint.hidden = false;
  opened.hidden = true;
  toast.hidden = true;
  hoverTag.hidden = true;
  renderer.domElement.style.cursor = "default";
}

let last = performance.now();
let looping = false;
function frame(now: number) {
  if (stopped) {
    looping = false;
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  stepOutro(dt);
  if (stopped) {
    looping = false;
    return;
  }
  if (s !== target) {
    const speed = target > s ? 1 : 1.7;
    s = target > s ? Math.min(target, s + dt * speed) : Math.max(target, s - dt * speed);
    if (s === OPENED && chosen >= 0) showOpened(boxes[chosen]!.campaign);
    if (s === 0 && chosen >= 0) {
      chosen = -1;
      hint.hidden = false;
      if (queued >= 0) {
        const next = queued;
        queued = -1;
        choose(next);
      }
    }
  }
  pose(now / 1000, dt);
  placeHoverTag();
  renderFrame();
  requestAnimationFrame(frame);
}

let built: Promise<void> | null = null;
async function build() {
  // The player's locks seal a box the same way coming soon does, saying what opens it. Drawn once: main.ts starts the
  // page again when a villain unlocks, so the box is drawn open.
  const campaigns = CAMPAIGNS.map((c) => {
    const lock = c.villain ? host?.lock?.(c.villain) : null;
    return lock ? { ...c, open: false, lock } : c;
  });
  await Promise.all([document.fonts.load("120px Bangers"), document.fonts.load("900 40px 'Public Sans'")]);
  const [villainBack, encounterBack, ...arts] = await Promise.all([
    loadImage(`${CARDS}marvel-villain-back.webp`),
    loadImage(`${CARDS}marvel-encounter-back.webp`),
    ...campaigns.map((c) => loadImage(c.scan)),
  ]);
  const backs: Backs = {
    villain: villainBack ? texture(villainBack) : null,
    encounter: encounterBack ? texture(encounterBack) : null,
  };
  buildTable();
  buildShelf();
  // Lights shine on both layers: the sharp table and the soft backdrop.
  scene.traverse((o) => {
    if (o instanceof THREE.Light) o.layers.enableAll();
  });
  boxes = campaigns.map((c, i) => buildBox(c, i, arts[i] ?? null, backs));
  // The boxes from the keyboard (and for screen readers): a button each, which lifts its box while it has the focus.
  const picks = el<HTMLElement>(".shelf-picks");
  campaigns.forEach((c, i) => {
    const name = `${c.name[0]}${c.name.slice(1).toLowerCase()}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = c.open ? `Open ${name}` : `${name} (${c.lock ?? "coming soon"})`;
    button.onclick = () => {
      if (outro) return;
      // On the shelf, or this box still going back onto it (it turns round and opens again).
      if (chosen < 0 || (chosen === i && target === 0)) choose(i);
      // Another box, asked for while the last one is still going back: it opens as soon as that one is home (the
      // press used to be dropped, so Escape then a different box did nothing).
      else if (chosen !== i && target === 0) queued = i;
    };
    button.onfocus = () => {
      if (chosen < 0) hovered = i;
    };
    button.onblur = () => {
      if (hovered === i) hovered = -1;
    };
    picks.append(button);
  });
}

/**
 * Puts the shelf up over the table page: the room with every box on the shelf, or, the first time with `?open=rhino`
 * in the address, that box already open. Resolves once the room is drawn.
 */
export async function openShelf(over: ShelfHost): Promise<void> {
  host = over;
  root.hidden = false;
  root.style.opacity = "1";
  // The keyboard starts on the shelf (Tab reaches the boxes), not on the table underneath.
  root.focus({ preventScroll: true });
  await (built ??= build());
  reset();
  resize();

  // ?open=rhino opens a box at once; &at=1.8 freezes the opening that many seconds in (for screenshots). Only the
  // first time: the address loses them once the game is on the table.
  const params = new URLSearchParams(location.search);
  const preset = boxes.findIndex((b) => b.campaign.id === params.get("open") && b.campaign.open);
  if (preset >= 0) {
    const at = Number(params.get("at") ?? OPENED);
    chosen = preset;
    s = target = Math.min(OPENED, Math.max(0, at));
    hint.hidden = true;
    pressPlay = params.has("play");
    if (s === OPENED) showOpened(boxes[preset]!.campaign);
  }
  pose(performance.now() / 1000, 0);
  renderFrame();
  stopped = false;
  last = performance.now();
  if (!looping) {
    looping = true;
    requestAnimationFrame(frame);
  }
}

/** Whether the shelf is up over the table. */
export const shelfShown = () => !root.hidden;
