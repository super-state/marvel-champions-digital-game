/**
 * Campaign boxes (mock-up): the campaigns stand on a wooden table as retail boxes, with a cube shelf of other game
 * boxes in the dim room behind. Pick one and it tips onto its back, the lid lifts off and is set aside, and the villain
 * card rises out of the tray towards you. Ultron is still sealed ("coming soon") and won't open.
 *
 * Dev page only (`/battle/boxes.html`, not in the build). It is a look at what a 3D menu could be, not the game's real
 * start flow: only Rhino's Play button goes anywhere (the table we have today). `?open=klaw` jumps straight to an
 * opened box, for screenshots.
 *
 * The box prints are our own design drawn on canvases at load, with the villain's art cropped from its card scan.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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
  /** Where Play goes; absent while that villain's game isn't on the table yet. */
  play?: string;
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
    play: "/battle/",
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
    blurb: "Ultron's drones are coming.",
    open: false,
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
const CARD_END = new THREE.Vector3(-2.55, 2.55, 1.85);
const CARD_END_SCALE = 1.5;
const SHELF_X = [-3.4, 0, 3.4];
const SHELF_YAW = [-0.3, 0.26, 0.3];

const CAM_SHELF = { pos: new THREE.Vector3(0, 4.1, 10.2), at: new THREE.Vector3(0, 1.3, 0) };
const CAM_OPEN = { pos: new THREE.Vector3(0.1, 8.0, 7.9), at: new THREE.Vector3(0.1, 0.55, 0.75) };

/** Seconds into the opening at which everything has landed. */
const OPENED = 3.1;

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
    comingSoon(g, 512, 560, 1, -0.32);
  }
  return cv;
}

function comingSoon(g: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number) {
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
  g.fillText("COMING SOON", 0, 42);
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

/** The campaign guide's cover, folded in the tray. */
function guidePrint(c: Campaign): HTMLCanvasElement {
  const [cv, g] = canvas(1024, 480);
  g.fillStyle = "#efe6d2";
  g.fillRect(0, 0, 1024, 480);
  g.fillStyle = c.mid;
  g.fillRect(0, 0, 1024, 150);
  g.fillStyle = c.accent;
  g.fillRect(0, 150, 1024, 14);
  g.fillStyle = "#ffd54a";
  g.font = "110px Bangers";
  g.fillText(`${c.name}`, 40, 118);
  g.fillStyle = "#f4ead8";
  g.textAlign = "right";
  g.font = "900 38px 'Public Sans'";
  g.fillText("CAMPAIGN GUIDE", 984, 96);
  g.textAlign = "left";
  g.fillStyle = "#b9ad97";
  for (let line = 0; line < 7; line++) g.fillRect(40, 214 + line * 34, line % 3 === 2 ? 560 : 940, 12);
  g.fillStyle = "rgba(0,0,0,0.08)";
  g.fillRect(508, 0, 8, 480);
  if (!c.open) greyOut(cv);
  return cv;
}

function woodPrint(): HTMLCanvasElement {
  const [cv, g] = canvas(1024, 1024);
  g.fillStyle = "#4e301b";
  g.fillRect(0, 0, 1024, 1024);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let plank = 0; plank < 4; plank++) {
    const top = plank * 256;
    g.fillStyle = `rgba(${plank % 2 ? "255,200,150" : "0,0,0"},0.05)`;
    g.fillRect(0, top, 1024, 256);
    for (let i = 0; i < 70; i++) {
      const y0 = top + rand() * 256;
      const wave = 3 + rand() * 9;
      const freq = 0.004 + rand() * 0.01;
      g.strokeStyle =
        rand() < 0.5 ? `rgba(20,10,4,${0.08 + rand() * 0.18})` : `rgba(160,104,60,${0.06 + rand() * 0.12})`;
      g.lineWidth = 0.8 + rand() * 2.6;
      g.beginPath();
      for (let x = 0; x <= 1024; x += 16) {
        const y = y0 + Math.sin(x * freq + i) * wave + Math.sin(x * 0.031 + i * 3) * 1.5;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = "rgba(12,6,2,0.75)";
    g.fillRect(0, top, 1024, 3);
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
const stage = document.getElementById("stage")!;
stage.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0a08);
scene.fog = new THREE.Fog(0x0d0a08, 13, 26);
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

function buildTable() {
  const wood = texture(woodPrint());
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.repeat.set(4, 2.2);
  const top = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0 });
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
  // The campaign guide, a folded sheet along the top of the tray under the tokens.
  const guide = new THREE.Mesh(
    new THREE.BoxGeometry(innerW - 0.16, 0.012, 1.05),
    new THREE.MeshStandardMaterial({ map: texture(guidePrint(c)), roughness: 0.85 }),
  );
  guide.position.set(0, 0.036, -0.86);
  guide.rotation.y = 0.02;
  guide.receiveShadow = true;
  tray.add(guide);
  const tokenColours = [c.accent, "#d8342c", "#2a7bd8", "#f2c94c", "#e9e3d6"];
  tokenColours.forEach((colour, i) => {
    const token = shadowed(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.05, 28),
        new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 }),
      ),
    );
    token.position.set(0.25 + (i % 3) * 0.36, 0.068 + Math.floor(i / 3) * 0.01, -1.02 + Math.floor(i / 3) * 0.34);
    tray.add(token);
  });
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
  return { campaign: c, index, group, lid, card, cardInTray, hover: 0, shake: 0 };
}

interface Backs {
  villain: THREE.Texture | null;
  encounter: THREE.Texture | null;
}

// ---------- the page ----------

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hoverTag = el<HTMLParagraphElement>("hover-tag");
const hint = el<HTMLParagraphElement>("hint");
const opened = el<HTMLElement>("opened");
const toast = el<HTMLParagraphElement>("toast");
const play = el<HTMLAnchorElement>("play");

let boxes: Box[] = [];
/** The open box, or -1 on the shelf. */
let chosen = -1;
/** How far into the opening the chosen box is, in seconds (0 = on the shelf, OPENED = all out). */
let s = 0;
let target = 0;
let hovered = -1;
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
    say(`${box.campaign.name[0]}${box.campaign.name.slice(1).toLowerCase()} is coming soon.`);
    return;
  }
  chosen = index;
  target = OPENED;
  hovered = -1;
  hoverTag.hidden = true;
  hint.hidden = true;
  renderer.domElement.style.cursor = "default";
}

function close() {
  target = 0;
  opened.hidden = true;
}

function showOpened(c: Campaign) {
  el("opened-kicker").textContent = `Campaign ${c.number}`;
  el("opened-title").textContent = c.name;
  el("opened-blurb").textContent = c.blurb;
  play.textContent = `Play vs ${c.name[0]}${c.name.slice(1).toLowerCase()}`;
  play.href = c.play ?? "#";
  play.onclick = c.play
    ? null
    : (event) => {
        event.preventDefault();
        say("This villain's table is still being built. This page is a mock-up.");
      };
  opened.hidden = false;
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
el("back").addEventListener("click", close);
addEventListener("keydown", (event) => {
  if (event.key === "Escape" && chosen >= 0) close();
});

function resize() {
  renderer.setSize(innerWidth, innerHeight);
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
  camera.position
    .sub(aim)
    .multiplyScalar(lerp(pullBack, Math.max(1, 1.1 / camera.aspect), c))
    .add(aim);
  camera.position.x += (1 - c) * (pointer.x > -2 ? pointer.x * 0.35 : 0);
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

    // The villain card: rides in the tray, then rises to face you.
    const rise = index === chosen ? span(s, 2.0, 1.0) : 0;
    scratch.matrix.multiplyMatrices(group.matrixWorld, box.cardInTray);
    scratch.matrix.decompose(scratch.pos, scratch.quat, scratch.scale);
    const end = CARD_END.clone();
    if (index === chosen && s >= OPENED - 0.001) end.y += Math.sin(time * 1.6) * 0.06;
    scratch.look.position.copy(end);
    scratch.look.lookAt(camera.position);
    scratch.endQuat.copy(scratch.look.quaternion);
    box.card.position.lerpVectors(scratch.pos, end, rise);
    box.card.position.y += Math.sin(Math.PI * rise) * 0.9;
    box.card.quaternion.slerpQuaternions(scratch.quat, scratch.endQuat, rise);
    box.card.scale.setScalar(lerp(1, CARD_END_SCALE, rise));
    if (index === chosen && rise >= 1) box.card.rotation.z += Math.sin(time * 1.1) * 0.02;
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
    : `${box.campaign.name} · coming soon`;
  hoverTag.hidden = false;
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (s !== target) {
    const speed = target > s ? 1 : 1.7;
    s = target > s ? Math.min(target, s + dt * speed) : Math.max(target, s - dt * speed);
    if (s === OPENED && chosen >= 0) showOpened(boxes[chosen]!.campaign);
    if (s === 0 && chosen >= 0) {
      chosen = -1;
      hint.hidden = false;
    }
  }
  pose(now / 1000, dt);
  placeHoverTag();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

async function start() {
  await Promise.all([document.fonts.load("120px Bangers"), document.fonts.load("900 40px 'Public Sans'")]);
  const [villainBack, encounterBack, ...arts] = await Promise.all([
    loadImage(`${CARDS}marvel-villain-back.webp`),
    loadImage(`${CARDS}marvel-encounter-back.webp`),
    ...CAMPAIGNS.map((c) => loadImage(c.scan)),
  ]);
  const backs: Backs = {
    villain: villainBack ? texture(villainBack) : null,
    encounter: encounterBack ? texture(encounterBack) : null,
  };
  buildTable();
  buildShelf();
  boxes = CAMPAIGNS.map((c, i) => buildBox(c, i, arts[i] ?? null, backs));
  resize();

  // ?open=rhino opens a box at once; &at=1.8 freezes the opening that many seconds in (for screenshots).
  const params = new URLSearchParams(location.search);
  const preset = boxes.findIndex((b) => b.campaign.id === params.get("open") && b.campaign.open);
  if (preset >= 0) {
    const at = Number(params.get("at") ?? OPENED);
    chosen = preset;
    s = target = Math.min(OPENED, Math.max(0, at));
    hint.hidden = true;
    if (s === OPENED) showOpened(boxes[preset]!.campaign);
  }
  pose(performance.now() / 1000, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

void start();
