/**
 * Free Play: the setup tray on the table, to the right of where the mat lies, with a slot each for the villain, the
 * module, the difficulty, the hero and the deck (room plan step 0.4.0). The tray stands as furniture from the start;
 * `mountFreePlay` fills it once the room has loaded (`main.ts`).
 *
 * Each slot is a row of real buttons laid over the picture, so the mouse, touch, the keyboard (arrows move between
 * the choices and the rows, Enter picks) and a pad (the table's own controller moves the focus) all work, and a
 * screen reader reads them. In each slot of the tray stands a small piece in the room's own look, drawn here: the
 * villain's box (its campaign box's print), the module's cards, the difficulty's token, the hero's card (its scan) and
 * the deck's box. Play deals that game onto the mat the way a campaign box does (`campaign-play.ts`).
 *
 * Only villains this player has opened are offered: on the test site the ones the room's locks leave open, on Adam's
 * own table all of them. The module starts as the villain's recommended one (and follows the villain until another is
 * picked); the deck is the hero's starter deck until saved decks come (room plan 0.9.0).
 */
import * as THREE from "three";
import {
  HEROES,
  MODULES,
  recommendedModule,
  VILLAINS,
  type Difficulty,
  type HeroId,
  type ModuleId,
  type VillainId,
} from "../../model.js";
import { canvas, halftone, loadImage, texture } from "../canvas.js";
import { CAM_GAME, setPose } from "../camera.js";
import { lerp, span } from "../motion.js";
import { ROOM } from "../room.js";
import { beginPlay, play } from "./campaign-play.js";
import { CAMPAIGNS, CARDS, frontPrint, type Campaign } from "./campaign-prints.js";
import { fitNarrow, furniturePlace } from "./place.js";

/** The tray: its middle on the table, and its size (x across, z deep). */
export const TRAY = { x: ROOM.TABLE_WIDTH / 2 - 2.1, z: 4.8, width: 2.6, length: 5.4, height: 0.32, slots: 5 };
const TRAY_YAW = -0.06;

export const freePlay = furniturePlace({
  id: "free-play",
  label: "Free Play",
  promise: "a setup tray to build any game you have opened: villain, module, difficulty, hero and deck.",
  view(out, aspect) {
    if (aspect >= 1.2) {
      // On a wide screen the tray stands right of the middle, clear of the buttons on the left.
      setPose(out, [TRAY.x - 6.7, 5.6, TRAY.z + 6.4], [TRAY.x - 1.5, 0, TRAY.z - 0.5], 38, [7, 30], 1);
    } else {
      // Held upright, the buttons fill the lower half: the camera looks down on the tray from in front, so it stands
      // lengthwise in the top half, clear of them.
      setPose(out, [TRAY.x - 2, 12.5, TRAY.z + 8.2], [TRAY.x - 0.7, 0, TRAY.z + 3], 38, [9, 34], 1);
      fitNarrow(out, aspect, 0.75, 0.6);
    }
    // Play swings the camera round to the game table's own angle as the room fades, as it does from the boxes.
    const toGame = play.outro ? span(play.outro.u, 0, 1.2) : 0;
    if (toGame > 0) {
      out.pos.lerp(CAM_GAME.pos, toGame);
      out.at.lerp(CAM_GAME.at, toGame);
      out.fogNear = lerp(out.fogNear, 13, toGame);
      out.fogFar = lerp(out.fogFar, 26, toGame);
    }
  },
  furniture(group) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4527, roughness: 0.5 });
    const felt = new THREE.MeshStandardMaterial({ color: 0x14202e, roughness: 0.95 });
    const { width, length, height, slots } = TRAY;
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
    placeOnTray(tray);
    group.add(tray);
  },
});

function placeOnTray(object: THREE.Object3D) {
  object.position.set(TRAY.x, 0, TRAY.z);
  object.rotation.y = TRAY_YAW;
}

// ---------- the game being built ----------

type Slot = "villain" | "module" | "difficulty" | "hero" | "deck";
const SLOTS: readonly Slot[] = ["villain", "module", "difficulty", "hero", "deck"];

interface Built {
  villain: VillainId;
  module: ModuleId;
  difficulty: Difficulty;
  hero: HeroId;
}

const DIFFICULTIES: readonly { id: Difficulty; name: string }[] = [
  { id: "standard", name: "Standard" },
  { id: "expert", name: "Expert" },
];

/** The hero's identity card (its scan, as the boxes use the villain's) and their starter deck's aspect. */
const HERO_CARDS: Partial<Record<HeroId, string>> = { "spider-man": "01001a", "captain-marvel": "01010a" };
const ASPECTS: Record<string, { name: string; colour: string; ink: string }> = {
  justice: { name: "Justice", colour: "#f2c230", ink: "#2a2006" },
  leadership: { name: "Leadership", colour: "#3d8fe0", ink: "#f4f8ff" },
  aggression: { name: "Aggression", colour: "#d8342b", ink: "#fff3f0" },
  protection: { name: "Protection", colour: "#3fae4a", ink: "#08190a" },
};
const heroOf = (id: HeroId) => HEROES.find((hero) => hero.id === id)!;
const villainName = (id: VillainId) => VILLAINS.find((villain) => villain.id === id)!.name;
const moduleName = (id: ModuleId) => MODULES.find((module) => module.id === id)!.name;
/** The starter deck's aspect, read from its id ("core-spider-man-justice"). */
function aspectOf(hero: HeroId) {
  const id = heroOf(hero).starterDeckId;
  return ASPECTS[id.slice(id.lastIndexOf("-") + 1)] ?? { name: "Starter", colour: "#8d877d", ink: "#10100f" };
}
const deckName = (hero: HeroId) => `${aspectOf(hero).name} starter deck`;

const SAVED = "battle-free-play-tray";
let built: Built = { villain: "rhino", module: recommendedModule("rhino"), difficulty: "standard", hero: "spider-man" };
/** A module the player picked stays when the villain changes; otherwise it follows the villain's recommended one. */
let modulePicked = false;
try {
  const saved = JSON.parse(localStorage.getItem(SAVED) ?? "null") as (Built & { modulePicked?: boolean }) | null;
  if (
    saved &&
    VILLAINS.some((v) => v.id === saved.villain) &&
    MODULES.some((m) => m.id === saved.module) &&
    DIFFICULTIES.some((d) => d.id === saved.difficulty) &&
    HEROES.some((h) => h.id === saved.hero)
  ) {
    built = { villain: saved.villain, module: saved.module, difficulty: saved.difficulty, hero: saved.hero };
    modulePicked = !!saved.modulePicked;
  }
} catch {
  // A private window: the tray starts as new.
}
function save() {
  try {
    localStorage.setItem(SAVED, JSON.stringify({ ...built, modulePicked }));
  } catch {
    // The choice lasts this visit.
  }
}

/** The villains this player has opened (the room's locks; all of them on Adam's own table). */
const openVillains = () => VILLAINS.filter((villain) => !play.host?.lock?.(villain.id));

// ---------- the pieces in the tray ----------

interface Piece {
  root: THREE.Group;
  face: THREE.MeshStandardMaterial;
  /** 0 at rest, 1 lifted (its row has the focus). */
  lift: number;
  /** A hop when its choice changes, 1 → 0. */
  hop: number;
}
const pieces = new Map<Slot, Piece>();
let focusedSlot: Slot | null = null;

const art = new Map<string, HTMLImageElement | null>();
const image = (url: string) => art.get(url) ?? null;

/** A piece standing in its slot, leaning back and turned a little towards the camera. */
function stand(slot: Slot, object: THREE.Object3D, face: THREE.MeshStandardMaterial): Piece {
  const root = new THREE.Group();
  const index = SLOTS.indexOf(slot);
  root.position.set(0, 0.1, -TRAY.length / 2 + ((index + 0.5) * TRAY.length) / TRAY.slots);
  root.rotation.order = "YXZ";
  root.rotation.y = -0.42;
  root.rotation.x = -0.3;
  root.scale.setScalar(1.25);
  object.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  root.add(object);
  return { root, face, lift: 0, hop: 0 };
}

const printMaterial = () => new THREE.MeshStandardMaterial({ roughness: 0.55 });
function setPrint(piece: Piece, source: HTMLCanvasElement | HTMLImageElement) {
  piece.face.map?.dispose();
  piece.face.map = texture(source);
  piece.face.needsUpdate = true;
}

/** A small box standing on end: `w` across, `h` tall, `d` deep, its front printed. */
function box(w: number, h: number, d: number, sides: number, face: THREE.MeshStandardMaterial): THREE.Group {
  const group = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ color: sides, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, side, side, face, side]);
  body.position.y = h / 2;
  group.add(body);
  return group;
}

function villainPrint(id: VillainId): HTMLCanvasElement {
  const campaign = CAMPAIGNS.find((c) => c.villain === id) as Campaign;
  return frontPrint({ ...campaign, open: true }, image(campaign.scan));
}

function modulePrint(id: ModuleId): HTMLCanvasElement {
  const [cv, g] = canvas(512, 716);
  const bg = g.createLinearGradient(0, 0, 512, 716);
  bg.addColorStop(0, "#3a1a4a");
  bg.addColorStop(1, "#120818");
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 716);
  halftone(g, 512, 716, "#c86bff", 0.14);
  g.strokeStyle = "#e9dcc4";
  g.lineWidth = 10;
  g.strokeRect(22, 22, 468, 672);
  g.fillStyle = "#e9dcc4";
  g.font = "900 34px 'Public Sans'";
  g.textAlign = "center";
  g.fillText("MODULAR SET", 256, 120);
  const words = moduleName(id).toUpperCase().split(" ");
  // Two lines at most: "THE DOOMSDAY / CHAIR", "LEGIONS OF / HYDRA".
  const lines =
    words.length > 2 ? [words.slice(0, -1).join(" "), words.at(-1)!] : words.length === 2 ? words : [words[0]!];
  g.font = "96px Bangers";
  const fit = Math.min(1, 440 / Math.max(...lines.map((line) => g.measureText(line).width)));
  g.font = `${Math.floor(96 * fit)}px Bangers`;
  g.lineWidth = 12;
  g.lineJoin = "round";
  g.strokeStyle = "#0b0705";
  lines.forEach((line, i) => {
    const y = 360 + (i - (lines.length - 1) / 2) * 100 * fit;
    g.strokeText(line, 256, y);
    g.fillStyle = "#ffd54a";
    g.fillText(line, 256, y);
  });
  return cv;
}

function difficultyPrint(id: Difficulty): HTMLCanvasElement {
  const [cv, g] = canvas(512, 512);
  const expert = id === "expert";
  const rim = g.createRadialGradient(256, 256, 60, 256, 256, 256);
  rim.addColorStop(0, expert ? "#d8342b" : "#4b5a45");
  rim.addColorStop(1, expert ? "#5a0f0c" : "#1d241b");
  g.fillStyle = rim;
  g.fillRect(0, 0, 512, 512);
  halftone(g, 512, 512, expert ? "#ff9a7a" : "#9fc25a", 0.16);
  g.strokeStyle = "#e9dcc4";
  g.lineWidth = 14;
  g.beginPath();
  g.arc(256, 256, 226, 0, Math.PI * 2);
  g.stroke();
  // Pips: one for Standard, three for Expert.
  g.fillStyle = "#ffd54a";
  const pips = expert ? 3 : 1;
  for (let i = 0; i < pips; i++) {
    g.beginPath();
    g.arc(256 + (i - (pips - 1) / 2) * 56, 150, 18, 0, Math.PI * 2);
    g.fill();
  }
  g.font = `${expert ? 112 : 92}px Bangers`;
  g.textAlign = "center";
  g.lineWidth = 12;
  g.lineJoin = "round";
  g.strokeStyle = "#0b0705";
  const word = expert ? "EXPERT" : "STANDARD";
  g.strokeText(word, 256, 300);
  g.fillStyle = "#ffd54a";
  g.fillText(word, 256, 300);
  return cv;
}

function heroPrint(id: HeroId): HTMLCanvasElement | HTMLImageElement {
  const code = HERO_CARDS[id];
  const scan = code ? image(`${CARDS}${code}.png`) : null;
  if (scan) return scan;
  // No scan to hand: the hero's name on a plain card.
  const [cv, g] = canvas(512, 716);
  g.fillStyle = "#1c2a44";
  g.fillRect(0, 0, 512, 716);
  halftone(g, 512, 716, "#6fa8ff", 0.14);
  g.fillStyle = "#ffd54a";
  g.font = "80px Bangers";
  g.textAlign = "center";
  g.fillText(heroOf(id).name.toUpperCase(), 256, 380);
  return cv;
}

function deckPrint(id: HeroId): HTMLCanvasElement {
  const aspect = aspectOf(id);
  const [cv, g] = canvas(512, 716);
  g.fillStyle = "#14110d";
  g.fillRect(0, 0, 512, 716);
  g.fillStyle = aspect.colour;
  g.fillRect(0, 0, 512, 250);
  halftone(g, 512, 250, aspect.ink, 0.12);
  g.fillStyle = aspect.ink;
  g.textAlign = "center";
  g.font = "104px Bangers";
  g.fillText(aspect.name.toUpperCase(), 256, 170);
  g.fillStyle = "#e9dcc4";
  g.font = "900 40px 'Public Sans'";
  g.fillText("STARTER DECK", 256, 340);
  g.font = "64px Bangers";
  g.fillStyle = "#ffd54a";
  g.fillText(heroOf(id).name.toUpperCase(), 256, 470);
  g.strokeStyle = aspect.colour;
  g.lineWidth = 10;
  g.strokeRect(24, 24, 464, 668);
  return cv;
}

function paintPiece(slot: Slot) {
  const piece = pieces.get(slot);
  if (!piece) return;
  if (slot === "villain") setPrint(piece, villainPrint(built.villain));
  else if (slot === "module") setPrint(piece, modulePrint(built.module));
  else if (slot === "difficulty") setPrint(piece, difficultyPrint(built.difficulty));
  else if (slot === "hero") setPrint(piece, heroPrint(built.hero));
  else setPrint(piece, deckPrint(built.hero));
}

function buildPieces(group: THREE.Group) {
  const tray = new THREE.Group();
  placeOnTray(tray);
  // The villain's box, on end, its lid's print to the front (portrait, as on the shelf).
  const villainFace = printMaterial();
  pieces.set("villain", stand("villain", box(0.64, 0.8, 0.22, 0x1a1512, villainFace), villainFace));
  // The module's cards: a short stack of encounter cards, its top one printed with the set's name.
  const moduleFace = printMaterial();
  const stack = box(0.5, 0.7, 0.16, 0x3a1a4a, moduleFace);
  pieces.set("module", stand("module", stack, moduleFace));
  // The difficulty's token: a thick disc stood on its edge.
  const tokenFace = printMaterial();
  const rim = new THREE.MeshStandardMaterial({ color: 0xc9a45c, roughness: 0.35, metalness: 0.6 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.09, 40), [rim, tokenFace, rim]);
  disc.rotation.x = Math.PI / 2;
  // Spun on its face so its word reads across.
  const spin = new THREE.Group();
  spin.position.y = 0.36;
  spin.rotation.z = Math.PI / 2;
  spin.add(disc);
  const token = new THREE.Group();
  token.add(spin);
  pieces.set("difficulty", stand("difficulty", token, tokenFace));
  // The hero's card, in a little stand.
  const heroFace = printMaterial();
  const card = box(0.5, 0.7, 0.02, 0xe9dcc4, heroFace);
  const foot = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.06, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x3b2515, roughness: 0.5 }),
  );
  foot.position.y = 0.03;
  card.add(foot);
  pieces.set("hero", stand("hero", card, heroFace));
  // The deck's box.
  const deckFace = printMaterial();
  pieces.set("deck", stand("deck", box(0.52, 0.72, 0.28, 0x14110d, deckFace), deckFace));
  for (const piece of pieces.values()) tray.add(piece.root);
  group.add(tray);
  for (const slot of SLOTS) paintPiece(slot);
}

// ---------- the buttons ----------

let rows: Record<Slot, HTMLElement> | null = null;
let playButton: HTMLButtonElement | null = null;
let summary: HTMLElement | null = null;
let panelRoot: HTMLElement | null = null;

interface Option {
  value: string;
  label: string;
  /** A short line under it (the module the villain recommends). */
  tag?: string;
}

function optionsOf(slot: Slot): Option[] {
  switch (slot) {
    case "villain":
      return openVillains().map((v) => ({ value: v.id, label: v.name }));
    case "module":
      return MODULES.map((m) => ({
        value: m.id,
        label: m.name,
        ...(m.id === recommendedModule(built.villain) ? { tag: "Recommended" } : {}),
      }));
    case "difficulty":
      return DIFFICULTIES.map((d) => ({ value: d.id, label: d.name }));
    case "hero":
      return HEROES.map((h) => ({ value: h.id, label: h.name }));
    case "deck":
      return [{ value: heroOf(built.hero).starterDeckId, label: deckName(built.hero) }];
  }
}

const valueOf = (slot: Slot): string =>
  slot === "deck" ? heroOf(built.hero).starterDeckId : slot === "module" ? built.module : built[slot];

function choose(slot: Slot, value: string) {
  if (slot === "villain") {
    built.villain = value as VillainId;
    if (!modulePicked) built.module = recommendedModule(built.villain);
  } else if (slot === "module") {
    built.module = value as ModuleId;
    modulePicked = built.module !== recommendedModule(built.villain);
  } else if (slot === "difficulty") built.difficulty = value as Difficulty;
  else if (slot === "hero") built.hero = value as HeroId;
  save();
  paint();
  // Its piece hops as it changes (and the module's and deck's, which follow the villain and the hero).
  const changed: Slot[] = slot === "villain" ? ["villain", "module"] : slot === "hero" ? ["hero", "deck"] : [slot];
  for (const each of changed) {
    paintPiece(each);
    const piece = pieces.get(each);
    if (piece) piece.hop = 1;
  }
}

/** Draws the rows from the game being built; the focus stays on the same choice. */
function paint() {
  if (!rows || !playButton || !summary) return;
  const focused = document.activeElement as HTMLElement | null;
  const keep = focused?.dataset.slot ? `${focused.dataset.slot}:${focused.dataset.value}` : null;
  for (const slot of SLOTS) {
    const box = rows[slot];
    box.replaceChildren(
      ...optionsOf(slot).map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-option free-play-option";
        button.dataset.slot = slot;
        button.dataset.value = option.value;
        button.setAttribute("aria-pressed", String(option.value === valueOf(slot)));
        button.textContent = option.label;
        if (option.tag) {
          const tag = document.createElement("small");
          tag.textContent = option.tag;
          button.append(tag);
        }
        button.onclick = () => choose(slot, option.value);
        button.onfocus = () => (focusedSlot = slot);
        button.onblur = () => {
          if (focusedSlot === slot) focusedSlot = null;
        };
        return button;
      }),
    );
  }
  if (keep) panelRoot?.querySelector<HTMLElement>(`[data-slot="${keep.replace(":", '"][data-value="')}"]`)?.focus();
  playButton.textContent = `Play vs ${villainName(built.villain)}`;
  summary.textContent = [
    `${heroOf(built.hero).name} vs. ${villainName(built.villain)}`,
    DIFFICULTIES.find((d) => d.id === built.difficulty)!.name,
    moduleName(built.module),
  ].join(" · ");
}

/** The buttons of the panel, in reading order, row by row (Play and Back last). */
function buttonRows(): HTMLButtonElement[][] {
  if (!rows || !playButton || !panelRoot) return [];
  const back = panelRoot.querySelector<HTMLButtonElement>(".room-back");
  return [...SLOTS.map((slot) => [...rows![slot].querySelectorAll("button")]), [playButton], ...(back ? [[back]] : [])];
}

/** Arrows: left and right along a row, up and down between rows (onto the row's chosen one). */
function key(event: KeyboardEvent): boolean {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return false;
  const grid = buttonRows();
  const active = document.activeElement;
  let row = grid.findIndex((buttons) => buttons.some((b) => b === active));
  if (row < 0) {
    grid[0]?.[0]?.focus();
    event.preventDefault();
    return true;
  }
  const buttons = grid[row]!;
  const column = buttons.findIndex((b) => b === active);
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const next = buttons[column + (event.key === "ArrowLeft" ? -1 : 1)];
    next?.focus();
  } else {
    row = Math.max(0, Math.min(grid.length - 1, row + (event.key === "ArrowUp" ? -1 : 1)));
    const target = grid[row]!;
    (target.find((b) => b.getAttribute("aria-pressed") === "true") ?? target[0])?.focus();
  }
  event.preventDefault();
  return true;
}

const LABELS: Record<Slot, string> = {
  villain: "Villain",
  module: "Module",
  difficulty: "Difficulty",
  hero: "Hero",
  deck: "Deck",
};

function buildPanel(panel: HTMLElement) {
  panelRoot = panel.closest<HTMLElement>(".room-panel") ?? panel;
  panel.classList.add("free-play");
  panel.innerHTML = `<div class="free-play-rows"></div>
    <p class="free-play-summary" aria-live="polite"></p>
    <button type="button" class="btn btn-primary free-play-go">Play</button>`;
  const list = panel.querySelector<HTMLElement>(".free-play-rows")!;
  rows = {} as Record<Slot, HTMLElement>;
  for (const slot of SLOTS) {
    const row = document.createElement("div");
    row.className = "free-play-row";
    row.setAttribute("role", "group");
    const label = document.createElement("span");
    label.id = `free-play-${slot}`;
    label.textContent = LABELS[slot];
    row.setAttribute("aria-labelledby", label.id);
    const options = document.createElement("div");
    options.className = "free-play-options";
    row.append(label, options);
    list.append(row);
    rows[slot] = options;
  }
  summary = panel.querySelector(".free-play-summary");
  playButton = panel.querySelector(".free-play-go");
  playButton!.onclick = () => {
    if (play.outro) return;
    beginPlay({
      villain: built.villain,
      hero: built.hero,
      difficulty: built.difficulty,
      modules: [built.module],
    });
  };
}

/** Fills the Free Play place (`main.ts`, once the room has loaded). */
export function mountFreePlay() {
  freePlay.mount({
    line: "Build any game you have opened",
    async build(group, panel) {
      await Promise.all([
        document.fonts.load("96px Bangers"),
        document.fonts.load("900 40px 'Public Sans'"),
        ...[...CAMPAIGNS.map((c) => c.scan), ...Object.values(HERO_CARDS).map((code) => `${CARDS}${code}.png`)].map(
          async (url) => art.set(url, await loadImage(url)),
        ),
      ]);
      buildPanel(panel);
      buildPieces(group);
      paint();
    },
    enter() {
      if (panelRoot) panelRoot.style.opacity = "1";
      // The locks are read each visit: a villain opened since shows up, and a locked one is never left chosen.
      const open = openVillains();
      if (!open.some((v) => v.id === built.villain) && open[0]) {
        built.villain = open[0].id;
        if (!modulePicked) built.module = recommendedModule(built.villain);
        paintPiece("villain");
        paintPiece("module");
      }
      paint();
      // The keyboard and a pad start on the villain row's chosen one.
      rows?.villain.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    },
    leave() {
      focusedSlot = null;
    },
    key,
    step(dt, time) {
      // Play: the tray's words fade as the camera swings round to the table.
      if (play.outro && panelRoot) panelRoot.style.opacity = String(1 - span(play.outro.u, 0, 0.4));
      for (const [slot, piece] of pieces) {
        piece.lift = lerp(piece.lift, focusedSlot === slot ? 1 : 0, 1 - Math.exp(-dt * 10));
        piece.hop = Math.max(0, piece.hop - dt * 2.4);
        const hop = Math.sin(Math.PI * piece.hop) * 0.22;
        const index = SLOTS.indexOf(slot);
        piece.root.position.y = 0.1 + 0.12 * piece.lift + hop;
        // A slow sway, each piece its own, so the tray doesn't look frozen.
        piece.root.rotation.z = Math.sin(time * 0.8 + index) * 0.015 * (1 - piece.lift);
      }
    },
  });
}
