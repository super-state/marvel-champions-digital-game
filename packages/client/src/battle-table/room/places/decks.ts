/**
 * Heroes & Decks: the bench on the left wall (room plan steps 0.6.0 and 0.9.0), with the hero shelf on it: a deck box
 * for every hero in the game (`hero-shelf.ts`), in one continuous run. The heroes the table can deal (`HEROES` in
 * `model.ts`, read here rather than named, so a hero task's new entry lights up) are lit; the rest stand among them,
 * faded. There is no menu beside it (Adam, 2026-11-26): the boxes are the choice. Over the shelf, a search box, the
 * sorts (release, A–Z, favourites first, last played first) and "Playable only"; the boxes move to their new places.
 *
 * Picking a box brings it off the shelf and up close, the rest of the shelf dimmed behind it, with a card beside it:
 * who, the deck they play (the starter deck, as it comes out of the box: no deck building here yet, Adam 2026-11-26),
 * Add to favourites (a gold sticker on the box), and for a hero the table deals, Play as: they become the
 * hero Campaign and Free Play deal (`battle-hero`) with their starter deck. Pointing at a box eases it out a little;
 * let go, it snaps straight back, as the table's cards do.
 *
 * Every choice is a real button (mouse, touch, the keyboard's arrows here, and the table's own controller, which moves
 * the focus and presses A and B in the room): a see-through button over each box, as the campaign shelf has.
 * `mountBench` fills the place once the room has loaded (`main.ts`).
 */
import * as THREE from "three";
import { HEROES, type HeroId } from "../../model.js";
import { STARTER, chooseDeck } from "../../decks/chosen-deck.js";
import { ASPECT_NAMES, BUILDER_HEROES, type HeroChoice } from "../../decks/deck-model.js";
import type { FinishedGame } from "../../record/game.js";
import { spatialPick, type FocusDirection } from "../../pad/spatial.js";
import { camera, setPose } from "../camera.js";
import { ROOM, pointer, raycaster, renderer, say } from "../room.js";
import { followHero } from "./free-play.js";
import { SHELF_RELEASES } from "./hero-catalogue.js";
import { CASE, SHELF_LOOK, buildBoxes, buildCase, type ShelfBox } from "./hero-shelf.js";
import { BOARD, SHELF_SORTS, orderHeroes, shelfFrame, shelfOf, spotOf, type ShelfSort } from "./hero-shelf-layout.js";
import { furniturePlace } from "./place.js";
import "./decks.css";

/** The bookcase, built tall enough for every hero, standing on the bench top. */
const frame = shelfFrame(-1.4);

/** The bench top: its middle, how long it runs along the wall (z) and how deep it is (x). The hero shelf stands on it. */
export const BENCH = { x: -ROOM.HALF_WIDTH + 1.7, z: CASE.z, top: frame.bottom, length: CASE.width + 0.9, depth: 3.1 };

/** How far down the shelf the bench has scrolled (room units), easing towards `scrollTo`; how far it can. */
let scroll = 0;
let scrollTo = 0;
let scrollRange = 0;

/** How much of the shelf the camera sees: half the screen's height at the shelf, and where it aims unscrolled. */
let halfSeen = 1;
let aimTop = 0;
/** How many boxes the search and the playable cut leave on the shelf. */
let shownCount = 0;

export const decks = furniturePlace({
  id: "decks",
  label: "Heroes & Decks",
  promise: "a deck box for each hero, and the card binder to build decks with.",
  view(out, aspect) {
    // Square on to the shelf, near enough that it fills the screen's width (clear of the title in the top corner). A
    // shelf taller than the screen starts at its top, and the wheel scrolls down it (`scroll`, in the room's units).
    // Scrolling reaches down to the lowest shelf with a box on it.
    const { top } = frame;
    const bottom = shownCount ? frame.floors[shelfOf(frame, shownCount - 1)]! - BOARD : top - 3;
    // The camera never stands back past the lamp over the games table (room.ts: hanging at x = 0, its shade 2.3
    // wide at the rim): on a screen too narrow to fit the shelf from in front of it, it looks wider instead.
    const at = CASE.back + CASE.depth;
    const nearestLamp = -2.8;
    const across = 0.9;
    const upDown: [number, number] = [-0.92, 0.8];
    const half = (CASE.width + 0.8) / (2 * across);
    const usual = Math.tan((38 / 2) * (Math.PI / 180));
    const distance = Math.min(half / (usual * aspect), nearestLamp - at);
    const tanV = half / distance / aspect;
    const fov = (2 * Math.atan(tanV) * 180) / Math.PI;
    const seen = distance * tanV * (upDown[1] - upDown[0]);
    scrollRange = Math.max(0, top + 0.4 - (bottom - 0.4) - seen);
    scroll = Math.min(scrollRange, Math.max(0, scroll));
    // The aim: the shelf's top at the top of the view, less how far down it has scrolled.
    halfSeen = distance * tanV;
    aimTop = top + 0.4 - upDown[1] * halfSeen;
    const y = aimTop - scroll;
    // High enough to see the shelf over the games table's near edge (x = -TABLE_WIDTH / 2, its top at 0).
    const lowest = Math.max(bottom + 0.2, y - distance * tanV);
    const overTable = (0.4 - lowest) / (at + ROOM.TABLE_WIDTH / 2);
    const height = Math.max(y + 0.8, lowest + overTable * -distance);
    setPose(out, [at + distance, height, CASE.z], [at, y, CASE.z], fov, [distance + 4, distance + 40], 0);
  },
  furniture(group) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24160c, roughness: 0.7 });
    const baize = new THREE.MeshStandardMaterial({ color: 0x1f3b2a, roughness: 0.95 });
    const { x, z, top, length, depth } = BENCH;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.35, length), wood);
    slab.position.set(x, top - 0.175, z);
    slab.castShadow = slab.receiveShadow = true;
    // A green baize mat along the front, like a card player's desk.
    const mat = new THREE.Mesh(new THREE.BoxGeometry(depth - CASE.depth - 0.25, 0.04, length - 0.8), baize);
    mat.position.set(x + CASE.depth / 2 + 0.05, top + 0.02, z);
    mat.receiveShadow = true;
    group.add(slab, mat);
    const legHeight = top - 0.35 - ROOM.FLOOR;
    for (const dz of [-1, 1])
      for (const dx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, legHeight, 0.45), dark);
        leg.position.set(x + dx * (depth / 2 - 0.35), ROOM.FLOOR + legHeight / 2, z + dz * (length / 2 - 0.4));
        group.add(leg);
      }
    // A low drawer front under the top.
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, length - 1.4), dark);
    drawer.position.set(x + depth / 2 - 0.05, top - 0.75, z);
    group.add(drawer);
    // The hero shelf: the bookcase now, its boxes once the bench is filled (`mountBench`).
    buildCase(group, frame);
  },
});

// ── Who and what ──────────────────────────────────────────────────────────────────────────────────────────────────

interface BenchHero {
  readonly id: HeroId;
  readonly name: string;
  readonly card: HeroChoice;
}

/** The heroes the table can deal, each with their identity and starter deck from the builder's pool. */
function benchHeroes(): BenchHero[] {
  return HEROES.flatMap((hero) => {
    const card = BUILDER_HEROES.find((each) => each.starterDeckId === hero.starterDeckId);
    return card ? [{ id: hero.id, name: hero.name, card }] : [];
  });
}

/** The chosen hero (`battle-hero`, as the deal reads it), or the first. */
function chosenHero(heroes: readonly BenchHero[]): BenchHero {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("battle-hero");
  } catch {
    // A private window: the first hero.
  }
  return heroes.find((hero) => hero.id === saved) ?? heroes[0]!;
}

function rememberHero(hero: HeroId) {
  try {
    localStorage.setItem("battle-hero", hero);
  } catch {
    // The choice lasts while the page is open.
  }
}

// ── The bench's state ─────────────────────────────────────────────────────────────────────────────────────────────

let heroes: BenchHero[] = [];
let current: BenchHero | null = null;
/** The see-through buttons over the lit boxes, the deck card, the name tag, and the line at the bottom. */
let picks: HTMLElement | null = null;
let card: HTMLElement | null = null;
let tag: HTMLElement | null = null;
let hint: HTMLElement | null = null;
let tools: HTMLElement | null = null;
/**
 * The bench's panel. Its `data-input` says what was used last ("keys" or "mouse"): the focus ring round a box shows
 * only for the keyboard (or a pad, `pad.css`), never just because the bench put the focus on the chosen hero.
 */
let benchPanel: HTMLElement | null = null;
const usedInput = (kind: "keys" | "mouse") => {
  if (benchPanel && benchPanel.dataset.input !== kind) benchPanel.dataset.input = kind;
};
/** Back to the shelf, top left while a box is up close: apart from its card, so it is plain to find. */
let backBar: HTMLElement | null = null;
let searchBox: HTMLInputElement | null = null;
/** The camera is here: the boxes answer the pointer. */
let active = false;
/** The box the pointer (or the focus) is on, by its index in `boxes`; -1 for none. */
let hovered = -1;

interface Box extends ShelfBox {
  /** The hero the table deals with it (none for a faded box). */
  readonly id: HeroId | null;
  /** The see-through button over it. */
  readonly button: HTMLButtonElement;
  /** Where it stands on the shelf now; it glides there. */
  readonly home: THREE.Vector3;
  /** Its place in the shelf's order; -1 while the search or the playable cut leaves it off. */
  place: number;
  /** How far out it stands (0 back on its shelf, 1 its card open), and how big (0 off the shelf, 1 on it). */
  out: number;
  size01: number;
  /** It was up close last frame: when it goes back, it is put straight back on its shelf. */
  wasUp: boolean;
  /** How far through its flight up close (0 on the shelf, 1 there). */
  fly: number;
  /** Seconds it has been up close, for its slow turn from side to side. */
  sway: number;
}
const boxes: Box[] = [];
/** The box whose card is open (or was last). */
let opened: Box | null = null;

const cardOpen = () => !!card && !card.hidden && !!opened;

// ── The order: the sort, the search, the playable cut, favourites and last played ─────────────────────────────────

const PREFS = "mc-hero-shelf";
let sort: ShelfSort = "release";
let playableOnly = false;
let search = "";
const favourites = new Set<string>();
let lastPlayed = new Map<string, number>();
let lit = new Set<string>();
let games: (() => Promise<readonly FinishedGame[] | null>) | null = null;

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS) ?? "null") as {
      sort?: unknown;
      playableOnly?: unknown;
      favourites?: unknown;
    } | null;
    if (SHELF_SORTS.some((each) => each.id === saved?.sort)) sort = saved!.sort as ShelfSort;
    playableOnly = saved?.playableOnly === true;
    if (Array.isArray(saved?.favourites))
      for (const code of saved.favourites) if (typeof code === "string") favourites.add(code);
  } catch {
    // Nothing saved, or a private window: release order, every hero.
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ sort, playableOnly, favourites: [...favourites] }));
  } catch {
    // It lasts while the page is open.
  }
}

/** When each hero was last played, from the record (this browser's, or the test site's). */
async function readPlayed() {
  let finished: readonly FinishedGame[] | null = null;
  try {
    finished = (await games?.()) ?? null;
  } catch {
    return;
  }
  if (!finished) return;
  const byName = new Map(heroes.map((hero) => [hero.name, hero.card.identityCardId]));
  const played = new Map<string, number>();
  for (const game of finished) {
    const code = game.facts?.heroId ?? byName.get(game.hero);
    if (code && game.endedAt > (played.get(code) ?? -1)) played.set(code, game.endedAt);
  }
  const changed = played.size !== lastPlayed.size || [...played].some(([code, at]) => lastPlayed.get(code) !== at);
  lastPlayed = played;
  if (changed && sort === "played") arrange();
}

/** Puts every box in its place for the order now; `jump` stands them there at once (the first time). */
function arrange(jump = false) {
  const order = orderHeroes({ sort, search, playableOnly, lit, favourites, lastPlayed });
  shownCount = order.length;
  const places = new Map(order.map((hero, i) => [hero.code, i]));
  for (const box of boxes) {
    box.place = places.get(box.hero.code) ?? -1;
    if (box.place >= 0) spotOf(frame, box.place, shownCount, CASE.back, box.home);
    box.button.hidden = box.place < 0;
    box.star.visible = favourites.has(box.hero.code);
    if (jump) {
      box.mesh.position.copy(box.home);
      box.size01 = box.place >= 0 ? 1 : 0;
      box.mesh.visible = box.place >= 0;
    }
  }
  // The buttons in the shelf's order, so Tab walks it as the eye reads it.
  const byCode = new Map(boxes.map((box) => [box.hero.code, box]));
  picks?.append(...order.map((hero) => byCode.get(hero.code)!.button));
  if (opened && opened.place < 0) closeCard(false);
  hovered = -1;
  if (!jump) scrollTo = 0;
  if (hint) hint.textContent = shownCount ? "Pick a hero" : "No heroes match";
  for (const button of tools?.querySelectorAll<HTMLElement>("[data-sort]") ?? [])
    button.setAttribute("aria-pressed", String(button.dataset.sort === sort));
  tools?.querySelector("[data-bench='playable']")?.setAttribute("aria-pressed", String(playableOnly));
}

function toggleFavourite(box: Box) {
  const { code, name } = box.hero;
  if (favourites.has(code)) favourites.delete(code);
  else favourites.add(code);
  savePrefs();
  say(favourites.has(code) ? `${name} is a favourite.` : `${name} is no longer a favourite.`);
  if (sort === "favourites") arrange();
  box.star.visible = favourites.has(code);
}

/** The bar over the shelf: find a hero, the sorts, and the playable cut. */
function makeTools(): HTMLElement {
  const bar = el("div", "bench-tools");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Sort and find heroes");
  const input = el("input", "bench-search");
  searchBox = input;
  input.type = "search";
  input.placeholder = "Find a hero";
  input.setAttribute("aria-label", "Find a hero");
  input.dataset.bench = "search";
  input.oninput = () => {
    search = input.value;
    arrange();
  };
  const sorts = el("div", "bench-sorts");
  sorts.setAttribute("role", "group");
  sorts.setAttribute("aria-label", "Sort");
  sorts.append(el("span", "bench-label", "Sort"));
  for (const each of SHELF_SORTS) {
    const button = el("button", "bench-chip", each.label);
    button.type = "button";
    button.dataset.sort = each.id;
    button.dataset.bench = `sort:${each.id}`;
    button.onclick = () => {
      sort = each.id;
      savePrefs();
      arrange();
    };
    sorts.append(button);
  }
  const playable = el("button", "bench-chip bench-toggle", "Playable only");
  playable.type = "button";
  playable.dataset.bench = "playable";
  playable.onclick = () => {
    playableOnly = !playableOnly;
    savePrefs();
    arrange();
  };
  bar.append(input, sorts, playable);
  return bar;
}

// ── The deck boxes ────────────────────────────────────────────────────────────────────────────────────────────────

async function standBoxes(group: THREE.Group) {
  const byCard = new Map(heroes.map((hero) => [hero.card.identityCardId, hero.id]));
  for (const box of await buildBoxes(group, SHELF_LOOK, lit)) {
    const index = boxes.length;
    const id = byCard.get(box.hero.code) ?? null;
    const button = el("button", "bench-hero", box.hero.name);
    button.type = "button";
    button.dataset.bench = id ? `hero:${id}` : `shelf:${box.hero.code}`;
    button.dataset.box = String(index);
    if (!id) button.setAttribute("aria-label", `${box.hero.name}, not on the table yet`);
    button.onclick = () => pick(boxes[index]!);
    button.onfocus = () => {
      hovered = index;
      // The arrows (or the pad) stepping onto a box off the screen bring it into view; the window coming back to the
      // front gives the same button the focus again, and that alone moves nothing.
      const box = boxes[index]!;
      if (box !== revealed && !quietFocus) reveal(box);
      revealed = box;
    };
    button.onblur = () => {
      if (hovered === index) hovered = -1;
    };
    boxes.push({
      ...box,
      id,
      button,
      home: new THREE.Vector3(),
      place: -1,
      out: 0,
      size01: 0,
      wasUp: false,
      fly: 0,
      sway: 0,
    });
  }
}

/** The box last brought into view; set while the bench gives a box the focus without scrolling to it. */
let revealed: Box | null = null;
let quietFocus = false;

/** Scrolls the shelf so the box is in view, below the bar over it. */
function reveal(box: Box) {
  const high = box.home.y + box.size.tall / 2 + 0.25;
  const low = box.home.y - box.size.tall / 2 - 0.25;
  let want = scrollTo;
  if (high > aimTop - want + halfSeen * 0.72) want = aimTop + halfSeen * 0.72 - high;
  if (low < aimTop - want - halfSeen * 0.95) want = aimTop - halfSeen * 0.95 - low;
  scrollTo = Math.min(scrollRange, Math.max(0, want));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function markChosen() {
  for (const box of boxes) if (box.id) box.button.setAttribute("aria-pressed", String(box.id === current?.id));
}

const heroButton = (id: HeroId | undefined) => boxes.find((box) => box.id && box.id === id)?.button ?? null;

/** A box picked: it comes off the shelf and up close, its card beside it. Nothing is chosen until Play as. */
function pick(box: Box) {
  opened = box;
  hovered = -1;
  paint();
}

// ── Up close ──────────────────────────────────────────────────────────────────────────────────────────────────────

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The card beside a box up close: who, the deck they play (the starter deck, out of the box: no deck building at the
 * bench yet, Adam 2026-11-26), Play as for a hero the table deals, and Add to favourites under it.
 */
function paint(focusKey?: string) {
  if (!card || !opened) return;
  const box = opened;
  const { hero } = box;
  const bench = box.id ? (heroes.find((each) => each.id === box.id) ?? null) : null;

  const head = el("div", "bench-card-head");
  const words = el("div", "bench-card-words");
  words.append(el("h3", "bench-title", hero.name));
  if (hero.alterEgo !== hero.name) words.append(el("p", "bench-who", hero.alterEgo));
  head.append(words);
  // Favourite: a plain secondary button under Play (Adam, 2026-11-27: a star in the corner read as a close button).
  const on = favourites.has(hero.code);
  const star = el("button", "btn btn-secondary bench-fav", on ? "★ In your favourites" : "☆ Add to favourites");
  star.type = "button";
  star.dataset.bench = "favourite";
  star.setAttribute("aria-pressed", String(on));
  star.setAttribute("aria-label", "Favourite");
  star.onclick = () => {
    toggleFavourite(box);
    paint("favourite");
  };

  const aspect = bench ? ASPECT_NAMES[bench.card.starterAspect] : hero.aspect ? capital(hero.aspect) : null;
  const parts: HTMLElement[] = [head, el("p", "bench-deck-line", `Starter deck${aspect ? ` · ${aspect}` : ""}`)];
  if (bench) {
    const chosen = current?.id === bench.id;
    const choose = el(
      "button",
      "btn btn-primary bench-choose",
      chosen ? `Playing as ${bench.name}` : `Play as ${bench.name}`,
    );
    choose.type = "button";
    choose.dataset.bench = "choose";
    choose.setAttribute("aria-pressed", String(chosen));
    choose.onclick = () => chooseHero(bench);
    parts.push(
      choose,
      star,
      el(
        "p",
        "bench-line",
        chosen
          ? `Campaign and Free Play deal ${bench.name} with the starter deck.`
          : `Play as ${bench.name} in Campaign and Free Play.`,
      ),
    );
  } else {
    const release = SHELF_RELEASES.find((each) => each.id === hero.release)?.name;
    parts.push(el("p", "bench-line", `Not on the table yet${release ? `: from ${release}` : ""}.`), star);
  }
  card.replaceChildren(...parts);
  card.hidden = false;
  if (backBar) backBar.hidden = false;
  if (hint) hint.hidden = true;
  card
    .querySelector<HTMLElement>(`[data-bench="${CSS.escape(focusKey ?? (bench ? "choose" : "favourite"))}"]`)
    ?.focus({ preventScroll: true });
}

/** Play as confirmed: the hero (and their starter deck) for Campaign and Free Play; the box goes back on the shelf. */
function chooseHero(hero: BenchHero) {
  current = hero;
  rememberHero(hero.id);
  followHero(hero.id);
  chooseDeck(hero.id, STARTER);
  markChosen();
  say(`${hero.name} chosen: Campaign and Free Play deal them with their starter deck.`);
  closeCard();
}

/** Puts the card away and the box back on its shelf; the focus goes back to the box. */
function closeCard(refocus = true) {
  if (!card) return;
  card.hidden = true;
  if (backBar) backBar.hidden = true;
  if (hint) hint.hidden = false;
  if (refocus && opened && !opened.button.hidden) opened.button.focus({ preventScroll: true });
}

/** How long a box takes to come up close, in seconds, and how fast it then turns side to side (radians a second). */
const FLY = 0.62;
const SWAY = 0.35;

const easeOut = (x: number) => 1 - (1 - x) ** 3;
/** Past the end and back: the landing's overshoot. */
const easeOutBack = (x: number) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2;
const pulled = new THREE.Vector3();
const over = new THREE.Vector3();

/**
 * A box coming off the shelf, `t` from 0 to 1 (Adam, 2026-11-26: "more juice, a slightly different path"). First it
 * slides straight out of its slot, leaning back as if pulled by its top; then it swoops up and over towards the camera
 * on a curve, spinning once round, and lands up close a touch past its place and settles back, with a small pop.
 */
function flyUp(box: Box, t: number) {
  const out = 1.3;
  const slide = 0.24;
  pulled.copy(box.home).setX(box.home.x + out);
  const mesh = box.mesh;
  if (t < slide) {
    const a = easeOut(t / slide);
    mesh.position.lerpVectors(box.home, pulled, a);
    mesh.rotation.set(0, 0, 0.22 * a);
    mesh.scale.setScalar(1);
    return;
  }
  const b = (t - slide) / (1 - slide);
  const k = easeOutBack(b);
  // A curve over the top: from the slot's mouth, up past the shelf above, to up close.
  over.copy(pulled).lerp(closeAt, 0.35);
  over.y = Math.max(pulled.y, closeAt.y) + 2.6;
  const u = 1 - k;
  mesh.position.set(
    u * u * pulled.x + 2 * u * k * over.x + k * k * closeAt.x,
    u * u * pulled.y + 2 * u * k * over.y + k * k * closeAt.y,
    u * u * pulled.z + 2 * u * k * over.z + k * k * closeAt.z,
  );
  mesh.rotation.set(0, Math.PI * 2 * easeOut(b), 0.22 * (1 - b) - Math.sin(Math.PI * b) * 0.18);
  mesh.scale.setScalar(1 + Math.sin(Math.PI * Math.min(1, b * 1.25)) * 0.08);
}

/** How far in front of the camera a box up close stands, and the veil that dims the shelf behind it. */
const closeAt = new THREE.Vector3();
const lookingAt = new THREE.Vector3();
let veil: THREE.Mesh | null = null;

/** Where a box up close stands: big in front of the camera, a little left of the middle. */
function closeTo(box: Box, out: THREE.Vector3) {
  const tan = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  // Its front fills a little over half the screen's height (or, for a box lying flat, half its width): measured to the
  // front, which stands half the box's depth nearer than its middle.
  const front = Math.max(box.size.tall / (1.1 * tan), box.size.across / (1.0 * tan * camera.aspect));
  const distance = front + box.size.deep / 2;
  camera.getWorldDirection(lookingAt);
  out.copy(camera.position).addScaledVector(lookingAt, distance);
  // A touch above the middle, clear of the bottom of the screen.
  out.y += front * tan * 0.06;
  // The reader's left is +z here; the box sits a fifth of the screen's width left of the middle.
  out.z += distance * tan * camera.aspect * 0.42;
}

// ── The pointer ───────────────────────────────────────────────────────────────────────────────────────────────────

function boxAt(x: number, y: number): number {
  pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(
    boxes.filter((box) => box.place >= 0).map((box) => box.mesh),
    true,
  )[0];
  return hit ? (hit.object.userData.box as number) : -1;
}

const busy = () => !active;

renderer.domElement.addEventListener("pointermove", (event) => {
  usedInput("mouse");
  if (busy()) return;
  if (cardOpen()) {
    hovered = -1;
    renderer.domElement.style.cursor = "default";
    return;
  }
  hovered = boxAt(event.clientX, event.clientY);
  renderer.domElement.style.cursor = hovered >= 0 ? "pointer" : "default";
});
renderer.domElement.addEventListener("pointerleave", () => {
  if (active) hovered = -1;
});
renderer.domElement.addEventListener("click", (event) => {
  if (busy()) return;
  const box = boxes[boxAt(event.clientX, event.clientY)];
  // A box up close: a click anywhere off it is a step back, never another box picked from the shelf behind.
  if (cardOpen()) {
    if (box !== opened) closeCard();
  } else if (box) pick(box);
});

renderer.domElement.addEventListener(
  "wheel",
  (event) => {
    if (busy()) return;
    event.preventDefault();
    scrollTo = Math.min(scrollRange, Math.max(0, scrollTo + event.deltaY * 0.012));
  },
  { passive: false },
);

// ── Each frame: the boxes, the buttons over them, the name tag and the card ───────────────────────────────────────

const corner = new THREE.Vector3();
/** The box's outline on the screen, in pixels. */
function screenRect(box: Box) {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  const { deep, tall, across } = box.size;
  for (const x of [-deep / 2, deep / 2])
    for (const y of [-tall / 2, tall / 2])
      for (const z of [-across / 2, across / 2]) {
        corner.set(x, y, z).add(box.mesh.position).project(camera);
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
    if (box.place < 0) continue;
    const { button } = box;
    const r = screenRect(box);
    button.style.left = `${r.left}px`;
    button.style.top = `${r.top}px`;
    button.style.width = `${Math.max(1, r.right - r.left)}px`;
    button.style.height = `${Math.max(1, r.bottom - r.top)}px`;
  }
}

let tagText = "";
function placeTag() {
  if (!tag) return;
  const box = boxes[hovered];
  if (!active || !box || box.place < 0 || (cardOpen() && box === opened)) {
    tag.hidden = true;
    return;
  }
  const { hero } = box;
  const text = box.id
    ? `${hero.name} · ${hero.alterEgo}`
    : `${hero.name}${hero.alterEgo !== hero.name ? ` · ${hero.alterEgo}` : ""} · not on the table yet`;
  if (text !== tagText || tag.hidden) {
    tag.textContent = tagText = text;
    tag.hidden = false;
  }
  const r = screenRect(box);
  // Scrolled out of view: no tag pinned to the edge for it.
  if (r.bottom < 0 || r.top > innerHeight) {
    tag.hidden = true;
    return;
  }
  const half = tag.offsetWidth / 2 + 8;
  tag.style.left = `${Math.min(innerWidth - half, Math.max(half, (r.left + r.right) / 2))}px`;
  tag.style.top = `${Math.max(tag.offsetHeight + 8, r.top - 8)}px`;
}

/** The card beside the box up close: to its right, or under it where there is no room. Narrow: decks.css pins it. */
function placeCard() {
  if (!card || !cardOpen() || innerWidth <= 600) return;
  const box = opened;
  if (!box) return;
  const r = screenRect(box);
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const right = r.right + 32 + width <= innerWidth - 16;
  const left = right
    ? r.right + 32
    : Math.min(innerWidth - width - 16, Math.max(16, (r.left + r.right) / 2 - width / 2));
  const top = right ? (r.top + r.bottom) / 2 - height / 2 : r.bottom + 14;
  // Back sits just above the card, lined up with its left edge; the card leaves room for it.
  const cardTop = Math.min(innerHeight - height - 16, Math.max(72, top));
  card.style.left = `${left}px`;
  card.style.top = `${cardTop}px`;
  if (backBar) {
    backBar.style.left = `${left}px`;
    backBar.style.top = `${cardTop - 58}px`;
  }
}

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const ARROWS: Record<string, FocusDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** The arrows move between the deck card's buttons while it is open, and between the heroes' boxes while it isn't. */
function key(event: KeyboardEvent): boolean {
  if (ARROWS[event.key] || event.key === "Tab") usedInput("keys");
  // In the search box: typing is its own; Escape empties it first; Down or Enter goes to the first hero found.
  if (searchBox && event.target === searchBox) {
    if (event.key === "Escape" && searchBox.value) {
      searchBox.value = search = "";
      arrange();
    } else if (event.key === "ArrowDown" || event.key === "Enter") {
      boxes.find((box) => box.place === 0)?.button.focus({ preventScroll: true });
    } else return false;
    event.preventDefault();
    return true;
  }
  const direction = ARROWS[event.key];
  const areas = cardOpen() ? [backBar, card] : [tools, picks];
  if (!direction || !areas.every(Boolean)) return false;
  // Where the boxes are now, not where the last frame left them (a slow frame can still be to come).
  placePicks();
  const buttons = areas
    .flatMap((area) => [...area!.querySelectorAll<HTMLElement>("button, input")])
    .filter((button) => !button.hidden && button.getClientRects().length > 0);
  const active = document.activeElement as HTMLElement | null;
  event.preventDefault();
  if (!active || !buttons.includes(active)) {
    (cardOpen() ? buttons[0] : (picks?.querySelector<HTMLElement>("button:not([hidden])") ?? buttons[0]))?.focus({
      preventScroll: true,
    });
    return true;
  }
  const rect = (node: HTMLElement) => {
    const r = node.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  const others = buttons.filter((button) => button !== active).map((button) => ({ key: button, rect: rect(button) }));
  (spatialPick(others, rect(active), direction) ?? spatialPick(others, rect(active), direction, true))?.focus({
    preventScroll: true,
  });
  return true;
}

// ── Mounting ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fills the bench (`main.ts`, once the room has loaded); `source` is the record, for "Last played". */
export function mountBench(source?: { games(): Promise<readonly FinishedGame[] | null> }) {
  games = source ? () => source.games() : null;
  decks.mount({
    line: "Pick a hero, build a deck",
    async build(group, panel) {
      heroes = benchHeroes();
      current = chosenHero(heroes);
      lit = new Set(heroes.map((hero) => hero.card.identityCardId));
      loadPrefs();
      panel.classList.add("bench");
      benchPanel = panel;
      tools = makeTools();
      picks = el("div", "bench-picks");
      picks.setAttribute("role", "group");
      picks.setAttribute("aria-label", "Heroes");
      card = el("section", "bench-card");
      card.setAttribute("aria-label", "Decks");
      card.hidden = true;
      tag = el("p", "bench-tag");
      tag.hidden = true;
      hint = el("p", "bench-hint", "Pick a hero");
      backBar = el("div", "bench-back-bar");
      backBar.hidden = true;
      const back = el("button", "btn btn-secondary bench-back", "‹ Back to the shelf");
      back.type = "button";
      back.dataset.bench = "back";
      back.onclick = () => closeCard();
      backBar.append(back);
      panel.append(tools, picks, card, tag, hint, backBar);
      await document.fonts.load("900 34px 'Public Sans'");
      await standBoxes(group);
      veil = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 60),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
      );
      veil.rotation.y = Math.PI / 2;
      veil.position.set(CASE.back + CASE.depth + 1.6, 0, CASE.z);
      veil.visible = false;
      group.add(veil);
      arrange(true);
      markChosen();
      void readPlayed();
    },
    enter() {
      active = true;
      placePicks();
      void readPlayed();
      // A deck saved or deleted elsewhere (Free Play's slot only chooses) and the hero chosen since: drawn fresh.
      if (!heroes.length) return;
      current = chosenHero(heroes);
      markChosen();
      if (cardOpen()) paint();
      else {
        // No scrolling to it: the shelf opens at its top. (In a window not in front, the focus event itself only
        // comes once the window is, so the box is marked as shown here rather than by the event.)
        const id = current.id;
        revealed = boxes.find((box) => box.id === id) ?? null;
        quietFocus = true;
        heroButton(id)?.focus({ preventScroll: true });
        quietFocus = false;
        // Focused for the arrows to start from, not pointed at: it stays on its shelf.
        hovered = -1;
      }
    },
    leave() {
      active = false;
      hovered = -1;
      renderer.domElement.style.cursor = "default";
      if (tag) tag.hidden = true;
    },
    back() {
      if (!cardOpen()) return false;
      closeCard();
      return true;
    },
    key,
    step(dt) {
      scroll += (scrollTo - scroll) * Math.min(1, dt * 10);
      const glide = Math.min(1, dt * 8);
      for (const [i, box] of boxes.entries()) {
        // The open card's box stands right out; the one pointed at comes out a little. A box the search leaves off
        // shrinks away; the rest glide to their places.
        const up = box === opened && cardOpen();
        const target = up ? 0 : i === hovered ? 0.4 : 0;
        // The board's way with a card under the pointer (`table.ts`, the hand's lean): a box eases out while pointed
        // at, and snaps straight back the moment it is let go.
        box.out = target > box.out ? box.out + (target - box.out) * Math.min(1, dt * 12) : target;
        box.size01 += ((box.place >= 0 ? 1 : 0) - box.size01) * Math.min(1, dt * 10);
        box.mesh.visible = box.size01 > 0.02;
        box.mesh.scale.setScalar(Math.max(0.001, box.size01));
        if (up) {
          closeTo(box, closeAt);
          box.fly = Math.min(1, box.fly + dt / FLY);
          flyUp(box, box.fly);
          // Once there, it turns slowly from side to side, so it reads as a box in the hand.
          if (box.fly >= 1) {
            box.sway += dt;
            box.mesh.rotation.y = Math.sin(box.sway * SWAY) * 0.42;
          }
          box.wasUp = true;
        } else if (box.wasUp) {
          // Let go: straight back on its shelf.
          box.mesh.position.copy(box.home);
          box.mesh.rotation.set(0, 0, 0);
          box.mesh.scale.setScalar(1);
          box.fly = 0;
          box.sway = 0;
          box.wasUp = false;
        } else if (box.place >= 0) {
          // A box on its way to a new place comes forward off the shelf first, clear of the boards and the others.
          const at = box.mesh.position;
          const away = Math.min(1, Math.hypot(box.home.y - at.y, box.home.z - at.z));
          const x = box.home.x + box.out * 0.8 + away * 1.4;
          at.set(
            away < 0.01 ? x : at.x + (x - at.x) * glide,
            at.y + (box.home.y - at.y) * glide,
            at.z + (box.home.z - at.z) * glide,
          );
        }
      }
      // The shelf dims behind a box up close (easing in; gone at once when it goes back).
      if (veil) {
        const goal = cardOpen() ? 0.62 : 0;
        const material = veil.material as THREE.MeshBasicMaterial;
        material.opacity =
          goal > material.opacity ? material.opacity + (goal - material.opacity) * Math.min(1, dt * 8) : 0;
        veil.visible = material.opacity > 0.01;
      }
      if (!active) return;
      placePicks();
      placeTag();
      placeCard();
    },
  });
}
