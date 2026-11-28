/**
 * What fills Trophies & Stats (`trophies.ts` is its furniture): every achievement as a small object on the cabinet's
 * shelves, lit when earned and a dim outline when not; the record pinned to the cork board; and the mats, earned ones
 * to choose from and locked ones rolled up, saying how to earn them.
 *
 * All of it is worked out from the finished games each time the camera arrives (`record/achievements.ts`
 * `trophyRoom`), never stored. Every achievement and every mat is a real button in the panel laid over the picture,
 * grouped by family, so the mouse, a finger, the keyboard and a pad all reach them; focusing or pointing at one lights
 * its object in the cabinet and says its name, how to earn it, how far along it is and what it gives.
 */
import * as THREE from "three";
import { trophyRoom, type Achievement, type Family, type TrophyRoom } from "../../record/achievements.js";
import type { FinishedGame } from "../../record/game.js";
import { chooseMat, currentMat, DEFAULT_MAT, MATS, type MatId } from "../../mats.js";
import { allOpen } from "../../access.js";
import { lerp } from "../motion.js";
import { ROOM, say } from "../room.js";
import { BOARD, CABINET, corkPrint, paintBoard, trophies } from "./trophies.js";

const FAMILIES: readonly { readonly id: Family; readonly name: string }[] = [
  { id: "villains", name: "Villains" },
  { id: "heroes", name: "Heroes" },
  { id: "modules", name: "Modules" },
  { id: "decks", name: "Decks" },
  { id: "feats", name: "Feats" },
  { id: "trying", name: "For trying" },
];
/** Which families share each of the cabinet's four levels, top first. */
const LEVELS: readonly (readonly Family[])[] = [["villains"], ["heroes"], ["modules", "feats"], ["decks", "trying"]];

// ── The panel ────────────────────────────────────────────────────────────────────────────────────────────────────

let panelRoot: HTMLElement | null = null;
let countLine: HTMLElement | null = null;
let detail: HTMLElement | null = null;
let recordBox: HTMLElement | null = null;
let matRow: HTMLElement | null = null;
const tiles = new Map<string, HTMLButtonElement>();
let room: TrophyRoom | null = null;
let readable = true;
/** The achievement whose object is lit (focused or pointed at). */
let lit: string | null = null;

const dateOf = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** What an achievement's reward is, in words. The playmat rewards name the artwork they unlock. */
function rewardWords(reward: string): string {
  const mat = MATS.find((m) => m.reward === reward);
  return mat ? `the ${mat.name} mat` : "a reward still to come";
}

function statusWords(a: Achievement): string {
  if (a.earned) return a.earnedAt ? `Earned ${dateOf(a.earnedAt)}.` : "Earned.";
  if (a.progress) return `${a.progress.have} of ${a.progress.need} so far.`;
  return "Not earned yet.";
}

function showDetail(a: Achievement | null) {
  if (!detail) return;
  detail.replaceChildren();
  if (!a) {
    const hint = document.createElement("p");
    hint.className = "trophies-hint";
    hint.textContent = "Point at a trophy, or move to one, to read it.";
    detail.append(hint);
    return;
  }
  const name = document.createElement("strong");
  name.textContent = a.name;
  const how = document.createElement("p");
  how.textContent = a.how;
  const status = document.createElement("p");
  status.className = a.earned ? "trophies-earned" : "trophies-progress";
  status.textContent = `${statusWords(a)} Reward: ${rewardWords(a.reward)}.`;
  detail.append(name, how, status);
}

/** Lights an achievement (its object in the cabinet, and the words about it). */
function light(id: string | null) {
  lit = id;
  showDetail(room?.achievements.find((a) => a.id === id) ?? null);
}

/** A small picture for a family, drawn in the tile (the same shapes the cabinet's objects take). */
const GLYPH: Record<Family, string> = {
  villains:
    '<path d="M6 4h12v3a6 6 0 0 1-12 0zM4 5h2v3a3 3 0 0 1-2-3zM20 5h-2v3a3 3 0 0 0 2-3zM10 13h4v3h3v3H7v-3h3z"/>',
  heroes: '<path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z"/>',
  modules: '<path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/>',
  decks: '<path d="M5 6h11v14H5zM8 3h11v14h-2V5H8z"/>',
  feats: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  trying: '<path d="M12 3a7 7 0 1 1-7 7h3a4 4 0 1 0 4-4V3zM10 16h4v5h-4z"/>',
};

function buildPanel(panel: HTMLElement) {
  panel.classList.add("trophies");
  panel.innerHTML = `
    <div class="trophies-panel">
      <p class="trophies-count"></p>
      <div class="trophies-families"></div>
      <div class="trophies-detail" id="trophies-detail" aria-live="polite"></div>
    </div>
    <div class="trophies-side">
      <section class="trophies-record" aria-labelledby="trophies-record-title">
        <h3 id="trophies-record-title">Record</h3>
        <div class="trophies-record-body"></div>
      </section>
      <section class="trophies-mats" aria-labelledby="trophies-mats-title">
        <h3 id="trophies-mats-title">Mat</h3>
        <div class="trophies-mat-row" role="group" aria-labelledby="trophies-mats-title"></div>
      </section>
    </div>`;
  panelRoot = panel;
  countLine = panel.querySelector(".trophies-count");
  detail = panel.querySelector(".trophies-detail");
  recordBox = panel.querySelector(".trophies-record-body");
  matRow = panel.querySelector(".trophies-mat-row");
  const families = panel.querySelector<HTMLElement>(".trophies-families")!;
  for (const family of FAMILIES) {
    const section = document.createElement("section");
    section.className = "trophies-family";
    section.setAttribute("role", "group");
    section.setAttribute("aria-labelledby", `trophies-family-${family.id}`);
    const title = document.createElement("h3");
    title.id = `trophies-family-${family.id}`;
    title.textContent = family.name;
    const grid = document.createElement("div");
    grid.className = "trophies-grid";
    grid.dataset.family = family.id;
    section.append(title, grid);
    families.append(section);
  }
  // Each focus shows its words; on a phone the panel scrolls, so the focused one is brought into view (a pad moves
  // the focus without scrolling).
  panel.addEventListener("focusin", (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.achievement) light(target.dataset.achievement);
    target.scrollIntoView?.({ block: "nearest" });
  });
}

/** Draws the panel for what the games say now. */
function paintPanel() {
  if (!room || !panelRoot) return;
  countLine!.textContent = readable
    ? `${room.earned} of ${room.achievements.length} earned`
    : "Your record can't be read just now: everything shows as not yet earned.";
  for (const family of FAMILIES) {
    const grid = panelRoot.querySelector<HTMLElement>(`.trophies-grid[data-family="${family.id}"]`)!;
    for (const a of room.achievements.filter((x) => x.family === family.id)) {
      let tile = tiles.get(a.id);
      if (!tile) {
        tile = document.createElement("button");
        tile.type = "button";
        tile.className = "trophies-tile";
        tile.dataset.achievement = a.id;
        tile.setAttribute("aria-describedby", "trophies-detail");
        tile.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[family.id]}</svg>`;
        const id = a.id;
        tile.onclick = () => light(id);
        tile.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "mouse") tile!.focus({ preventScroll: true });
        });
        tiles.set(a.id, tile);
        grid.append(tile);
      }
      tile.dataset.earned = String(a.earned);
      tile.setAttribute("aria-label", `${a.name}, ${a.earned ? "earned" : "not earned yet"}`);
    }
  }
  paintRecord();
  paintMats();
  showDetail(room.achievements.find((a) => a.id === lit) ?? null);
}

function paintRecord() {
  if (!room || !recordBox) return;
  const { stats } = room;
  recordBox.replaceChildren();
  const table = (caption: string, rows: readonly { name: string; won: number; lost: number }[]) => {
    const t = document.createElement("table");
    t.innerHTML = `<caption>${caption}</caption><thead><tr><th scope="col"></th><th scope="col">Won</th><th scope="col">Lost</th></tr></thead>`;
    const body = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = row.name;
      const won = document.createElement("td");
      won.textContent = String(row.won);
      const lost = document.createElement("td");
      lost.textContent = String(row.lost);
      tr.append(th, won, lost);
      body.append(tr);
    }
    t.append(body);
    return t;
  };
  recordBox.append(
    table(
      "By villain",
      stats.byVillain.map((v) => ({ name: v.name, won: v.tally.won, lost: v.tally.lost })),
    ),
  );
  if (stats.byHero.length)
    recordBox.append(
      table(
        "By hero",
        stats.byHero.map((h) => ({ name: h.name, won: h.tally.won, lost: h.tally.lost })),
      ),
    );
  const facts = document.createElement("dl");
  const fact = (term: string, value: string) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    facts.append(dt, dd);
  };
  const fastest = stats.fastestWin;
  fact(
    "Fastest win",
    fastest
      ? `${fastest.rounds} round${fastest.rounds === 1 ? "" : "s"}, ${fastest.hero} against ${fastest.villain}`
      : "None yet",
  );
  fact("Longest winning run", stats.longestWinningRun ? `${stats.longestWinningRun} in a row` : "None yet");
  recordBox.append(facts);
}

/** The mats this player has earned: the default always. */
function earnedMats(): Set<MatId> {
  const rewards = new Set(room?.achievements.filter((a) => a.earned).map((a) => a.reward) ?? []);
  return new Set(MATS.filter((m) => m.reward === null || rewards.has(m.reward)).map((m) => m.id));
}

/** The mats this player can choose: the earned ones, or every one on Adam's own table (`access.ts`). */
function choosableMats(): Set<MatId> {
  return allOpen() ? new Set(MATS.map((m) => m.id)) : earnedMats();
}

function paintMats() {
  if (!matRow) return;
  const earned = earnedMats();
  const choosable = choosableMats();
  // A mat chosen once but not open now (another player on this device, a record that can't be read, Adam looking as
  // a friend) gives way.
  if (!choosable.has(currentMat())) chooseMat(DEFAULT_MAT);
  const chosen = currentMat();
  matRow.replaceChildren(
    ...MATS.map((mat) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "trophies-mat";
      button.dataset.mat = mat.id;
      const has = choosable.has(mat.id);
      const how = mat.reward ? (room?.achievements.find((a) => a.reward === mat.reward)?.how ?? "") : "";
      const swatch = document.createElement("span");
      swatch.className = "trophies-mat-swatch";
      swatch.style.setProperty("--mat", mat.swatch);
      const name = document.createElement("span");
      name.className = "trophies-mat-name";
      name.textContent = mat.name;
      const line = document.createElement("small");
      line.textContent = has
        ? mat.id === chosen
          ? "On the table"
          : earned.has(mat.id)
            ? "Earned"
            : "Open on your table"
        : how.replace(/\.$/, "");
      button.append(swatch, name, line);
      if (has) {
        button.setAttribute("aria-pressed", String(mat.id === chosen));
        button.setAttribute("aria-label", `${mat.name} mat${mat.id === chosen ? ", on the table" : ""}`);
        button.onclick = () => {
          chooseMat(mat.id);
          paintMats();
          paintRolls();
          matRow!.querySelector<HTMLElement>(`[data-mat="${mat.id}"]`)?.focus({ preventScroll: true });
        };
      } else {
        // Locked: still focusable, to read how to earn it.
        button.setAttribute("aria-disabled", "true");
        button.dataset.locked = "";
        button.setAttribute("aria-label", `${mat.name} mat, locked: ${how}`);
        button.onclick = () => say(`${how} That earns the ${mat.name} mat.`);
      }
      return button;
    }),
  );
}

// ── The things in the room ───────────────────────────────────────────────────────────────────────────────────────

interface Trophy {
  readonly id: string;
  readonly root: THREE.Group;
  readonly solid: THREE.Mesh;
  readonly outline: THREE.LineSegments;
  lift: number;
}
const trophyObjects = new Map<string, Trophy>();
const rolls = new Map<
  MatId,
  {
    root: THREE.Group;
    restingX: number;
    solid: THREE.Mesh;
    outline: THREE.LineSegments;
    material: THREE.MeshStandardMaterial;
  }
>();
const gold = new THREE.MeshStandardMaterial({
  color: 0xd9a441,
  metalness: 0.75,
  roughness: 0.32,
  emissive: 0x3a2508,
});
const unlit = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9, transparent: true, opacity: 0.28 });
const outlineLine = new THREE.LineBasicMaterial({ color: 0xa89577, transparent: true, opacity: 0.55 });
let boardMaterial: THREE.MeshStandardMaterial | null = null;

/** The shape of a family's trophies, about 0.5 tall, standing on y = 0. */
function shapeOf(family: Family): THREE.BufferGeometry {
  switch (family) {
    case "villains": {
      // A cup on a stem.
      const profile = [
        [0, 0],
        [0.17, 0],
        [0.17, 0.05],
        [0.05, 0.08],
        [0.04, 0.22],
        [0.16, 0.3],
        [0.2, 0.52],
        [0.18, 0.52],
        [0.14, 0.32],
        [0, 0.29],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.LatheGeometry(profile, 20);
    }
    case "heroes":
    case "feats": {
      // A star, or a bolt.
      const shape = new THREE.Shape();
      if (family === "heroes")
        for (let i = 0; i < 10; i++) {
          const r = i % 2 ? 0.11 : 0.26;
          const a = Math.PI / 2 + (i * Math.PI) / 5;
          const [x, y] = [Math.cos(a) * r, Math.sin(a) * r + 0.27];
          if (i) shape.lineTo(x, y);
          else shape.moveTo(x, y);
        }
      else
        [
          [0.06, 0.52],
          [-0.15, 0.22],
          [0.0, 0.22],
          [-0.06, 0],
          [0.16, 0.32],
          [0.02, 0.32],
        ].forEach(([x, y], i) => (i ? shape.lineTo(x!, y!) : shape.moveTo(x!, y!)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      g.translate(0, 0, -0.04);
      return g;
    }
    case "modules": {
      // A shield.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(0.22, 0.12, 0.2, 0.44);
      shape.lineTo(0, 0.5);
      shape.lineTo(-0.2, 0.44);
      shape.quadraticCurveTo(-0.22, 0.12, 0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
      g.translate(0, 0, -0.035);
      return g;
    }
    case "decks": {
      const g = new THREE.BoxGeometry(0.3, 0.42, 0.2);
      g.translate(0, 0.21, 0);
      return g;
    }
    case "trying": {
      // A ball on a little stand: for trying.
      const g = new THREE.SphereGeometry(0.17, 16, 12);
      g.translate(0, 0.3, 0);
      return g;
    }
  }
}

function buildTrophies(group: THREE.Group, all: readonly Achievement[]) {
  const { x, z, depth, width, height } = CABINET;
  const spacing = Math.min(0.46, (width - 0.6) / 10);
  LEVELS.forEach((families, level) => {
    const row = all.filter((a) => families.includes(a.family));
    // The plinth's top, then each glass shelf, top level first.
    const y = ROOM.FLOOR + 0.9 + ((3 - level) * (height - 1.2)) / 4 + 0.04;
    row.forEach((a, i) => {
      const geometry = shapeOf(a.family);
      const solid = new THREE.Mesh(geometry, unlit);
      solid.castShadow = true;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), outlineLine);
      const root = new THREE.Group();
      root.add(solid, outline);
      // Along the shelf (z), facing out of the cabinet (towards -x), a little back from the glass.
      root.position.set(x + depth * 0.05, y, z + (i - (row.length - 1) / 2) * spacing * (row.length > 8 ? 1 : 1.12));
      root.rotation.y = -Math.PI / 2;
      root.scale.setScalar(1.05);
      group.add(root);
      trophyObjects.set(a.id, { id: a.id, root, solid, outline, lift: 0 });
    });
  });

  // The rolled mats stand in two staggered rows between the cabinet and the board.
  const gapStart = z + width / 2 + 0.35;
  const gapEnd = BOARD.z - BOARD.width / 2 - 0.35;
  MATS.forEach((mat, i) => {
    const geometry = new THREE.CylinderGeometry(0.13, 0.13, 3.2, 20);
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(mat.swatch), roughness: 0.85 });
    const solid = new THREE.Mesh(geometry, material);
    solid.castShadow = true;
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 40), outlineLine);
    const roll = new THREE.Group();
    roll.add(solid, outline);
    const restingX = ROOM.HALF_WIDTH - 0.55 - (i % 2) * 0.44;
    roll.position.set(restingX, ROOM.FLOOR + 1.55, lerp(gapStart, gapEnd, (i + 0.5) / MATS.length));
    roll.rotation.z = -0.16;
    group.add(roll);
    rolls.set(mat.id, { root: roll, restingX, solid, outline, material });
  });
}

/** Earned trophies lit gold, the rest dim outlines. */
function paintTrophies() {
  for (const a of room?.achievements ?? []) {
    const trophy = trophyObjects.get(a.id);
    if (!trophy) continue;
    trophy.solid.material = a.earned ? gold : unlit;
    trophy.outline.visible = !a.earned;
  }
}

/** Earned mats in their colours, the chosen one standing out a little; locked ones a dim outline. */
function paintRolls() {
  const choosable = choosableMats();
  const chosen = currentMat();
  for (const [id, roll] of rolls) {
    const has = choosable.has(id);
    roll.solid.material = has ? roll.material : unlit;
    roll.outline.visible = !has;
    roll.root.position.x = roll.restingX - (id === chosen ? 0.14 : 0);
  }
}

/** The record, pinned to the cork board as notes. */
function paintCork() {
  if (!boardMaterial || !room) return;
  const [cv, g] = corkPrint(1024, 768);
  const { stats } = room;
  const note = (x: number, y: number, w: number, h: number, tilt: number, lines: readonly string[], title: string) => {
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.rotate(tilt);
    g.fillStyle = "rgba(0,0,0,.35)";
    g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
    g.fillStyle = "#efe6d2";
    g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = "#b3261e";
    g.beginPath();
    g.arc(0, -h / 2 + 14, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1c140e";
    g.font = "900 34px 'Public Sans', sans-serif";
    g.textAlign = "center";
    g.fillText(title, 0, -h / 2 + 62);
    g.font = "700 28px 'Public Sans', sans-serif";
    lines.forEach((line, i) => g.fillText(line, 0, -h / 2 + 108 + i * 40));
    g.restore();
  };
  note(
    60,
    70,
    420,
    300,
    -0.03,
    stats.byVillain.map((v) => `${v.name}   ${v.tally.won} – ${v.tally.lost}`),
    "VILLAINS",
  );
  note(
    540,
    60,
    420,
    300,
    0.025,
    stats.byHero.length
      ? stats.byHero.slice(0, 4).map((h) => `${h.name}   ${h.tally.won} – ${h.tally.lost}`)
      : ["No games yet"],
    "HEROES",
  );
  const fastest = stats.fastestWin;
  note(
    130,
    420,
    380,
    280,
    0.02,
    [fastest ? `${fastest.rounds} rounds` : "None yet", fastest ? `vs ${fastest.villain}` : ""],
    "FASTEST WIN",
  );
  note(
    570,
    430,
    380,
    260,
    -0.035,
    [stats.longestWinningRun ? `${stats.longestWinningRun} in a row` : "None yet"],
    "BEST RUN",
  );
  boardMaterial.map?.dispose();
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  boardMaterial.map = map;
  boardMaterial.needsUpdate = true;
}

/**
 * The arrow keys move between the panel's buttons by where they are on the screen (the room stops every key at the
 * window, so the place handles its own): the nearest one that way, keeping close to the same line.
 */
function key(event: KeyboardEvent): boolean {
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!step || !panelRoot) return false;
  const buttons = [...panelRoot.closest(".room-panel")!.querySelectorAll<HTMLElement>("button")].filter(
    (b) => b.offsetParent !== null,
  );
  const active = document.activeElement as HTMLElement | null;
  const from = active && buttons.includes(active) ? active.getBoundingClientRect() : null;
  event.preventDefault();
  if (!from) {
    buttons[0]?.focus({ preventScroll: true });
    return true;
  }
  const [dx, dy] = step as [number, number];
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  // The panel's own buttons first (on a phone some are scrolled out of view, below Back); Back once there are none.
  const inside = buttons.filter((b) => panelRoot!.contains(b));
  return pick(inside) || pick(buttons) || true;

  function pick(among: readonly HTMLElement[]): boolean {
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const b of among) {
      if (b === active) continue;
      const r = b.getBoundingClientRect();
      const along = (r.left + r.width / 2 - cx) * dx + (r.top + r.height / 2 - cy) * dy;
      if (along <= 4) continue;
      const across = Math.abs((r.left + r.width / 2 - cx) * dy) + Math.abs((r.top + r.height / 2 - cy) * dx);
      const score = along + across * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    best?.focus({ preventScroll: true });
    return best !== null;
  }
}

// ── Mounting ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the finished games come from (`main.ts`: this browser's record, or the test site's). */
export interface TrophySource {
  games(): Promise<readonly FinishedGame[] | null>;
}

async function readRoom(source: TrophySource): Promise<void> {
  let games: readonly FinishedGame[] | null = null;
  try {
    games = await source.games();
  } catch {
    games = null;
  }
  readable = games !== null;
  room = trophyRoom(games ?? []);
}

/** Fills Trophies & Stats (`main.ts`, once the room has loaded). */
export function mountTrophies(source: TrophySource) {
  trophies.mount({
    line: "Your trophies, your record and your mats",
    async build(group, panel) {
      await Promise.all([readRoom(source), document.fonts.load("900 34px 'Public Sans'")]);
      buildPanel(panel);
      buildTrophies(group, room!.achievements);
      boardMaterial = paintBoard();
      paintPanel();
      paintTrophies();
      paintRolls();
      paintCork();
    },
    async enter() {
      // The record is read again on every visit: a game finished since counts.
      await readRoom(source);
      paintPanel();
      paintTrophies();
      paintRolls();
      paintCork();
      const first = panelRoot?.querySelector<HTMLElement>(".trophies-tile");
      if (first && !panelRoot!.contains(document.activeElement)) first.focus({ preventScroll: true });
    },
    leave() {
      lit = null;
    },
    key,
    step(dt, time) {
      for (const trophy of trophyObjects.values()) {
        trophy.lift = lerp(trophy.lift, trophy.id === lit ? 1 : 0, 1 - Math.exp(-dt * 10));
        trophy.root.rotation.y = -Math.PI / 2 + trophy.lift * Math.sin(time * 2.2) * 0.5;
        trophy.root.scale.setScalar(1.05 + 0.35 * trophy.lift);
      }
    },
  });
}
