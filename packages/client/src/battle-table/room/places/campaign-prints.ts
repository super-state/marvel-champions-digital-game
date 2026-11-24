/**
 * The campaigns on the shelf, and the prints on their boxes: our own design drawn on canvases at load, with the
 * villain's art cropped from its card scan.
 */
import type { VillainId } from "../../model.js";
import { canvas, greyOut, halftone, polygon } from "../canvas.js";

export type CampaignId = "rhino" | "klaw" | "ultron";

export interface Campaign {
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

export const CARDS = "/card-art/bundles/cards/";
export const CAMPAIGNS: readonly Campaign[] = [
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

export function frontPrint(c: Campaign, art: HTMLImageElement | null): HTMLCanvasElement {
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
export function spinePrint(c: Campaign): HTMLCanvasElement {
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
export function bandPrint(c: Campaign): HTMLCanvasElement {
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
export function trayPrint(c: Campaign): HTMLCanvasElement {
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

export const GUIDE_W = 1.28;
export const GUIDE_H = 1.02;

/** The campaign guide booklet's cover: a strip of the villain's art, the title, and a contents line. */
export function guidePrint(c: Campaign, art: HTMLImageElement | null): HTMLCanvasElement {
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
export function pagesPrint(): HTMLCanvasElement {
  const [cv, g] = canvas(256, 32);
  g.fillStyle = "#e8dfca";
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = "rgba(90,70,45,0.35)";
  for (let y = 2; y < 32; y += 4) g.fillRect(0, y, 256, 1);
  return cv;
}
