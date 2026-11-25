/**
 * Heroes & Decks: the bench on the left wall (room plan steps 0.6.0 and 0.9.0). A deck box stands on it for each hero
 * the table can deal (`HEROES` in `model.ts`, read here rather than named, so a hero task's new entry shows up). Picking
 * a hero makes them the chosen hero for Campaign and Free Play (`battle-hero`, which the deal reads) and slides their
 * box forward; the panel then lists their decks: the starter deck and every deck saved for them, each either chosen
 * for play (`decks/chosen-deck.ts`) or held back with the reason (`decks/deal-gate.ts`: an aspect not yet on the table,
 * or not legal). Edit, or New deck, lays the deck builder over the room (`decks/deck-screen.ts`, only the heroes and
 * aspects checked on the table); its Back returns to the bench.
 *
 * Every choice is a real button (mouse, touch, the keyboard's arrows here, and the table's own controller, which moves
 * the focus and presses A and B in the room). `mountBench` fills the place once the room has loaded (`main.ts`).
 */
import * as THREE from "three";
import { HEROES, type HeroId } from "../../model.js";
import { cardArtUrl } from "../../decks/card-art.js";
import { STARTER, chooseDeck, chosenDeck } from "../../decks/chosen-deck.js";
import { dealVerdict } from "../../decks/deal-gate.js";
import { ASPECT_NAMES, BUILDER_HEROES, cardCount, type HeroChoice } from "../../decks/deck-model.js";
import { browserDeckStore, type SavedDeck } from "../../decks/deck-store.js";
import type { DeckScreen } from "../../decks/deck-screen.js";
import { TABLE_ASPECTS } from "../../decks/table-pool.js";
import { spatialPick, type FocusDirection } from "../../pad/spatial.js";
import { canvas, loadImage, texture } from "../canvas.js";
import { setPose } from "../camera.js";
import { ROOM, root, say } from "../room.js";
import { followHero } from "./free-play.js";
import { fitNarrow, furniturePlace } from "./place.js";
import "./decks.css";

/** The bench top: its middle, how long it runs along the wall (z) and how deep it is (x). */
export const BENCH = { x: -ROOM.HALF_WIDTH + 1.7, z: -1, top: -1.4, length: 9.5, depth: 3.1 };

export const decks = furniturePlace({
  id: "decks",
  label: "Heroes & Decks",
  promise: "a deck box for each hero, and the card binder to build decks with.",
  view(out, aspect) {
    setPose(out, [-5.5, 6.8, 11.5], [BENCH.x + 0.6, BENCH.top + 1.2, BENCH.z - 1.2], 40, [12, 44], 0);
    fitNarrow(out, aspect, 1.2);
  },
  furniture(group) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24160c, roughness: 0.7 });
    const baize = new THREE.MeshStandardMaterial({ color: 0x1f3b2a, roughness: 0.95 });
    const { x, z, top, length, depth } = BENCH;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.35, length), wood);
    slab.position.set(x, top - 0.175, z);
    slab.castShadow = slab.receiveShadow = true;
    // A green baize mat to work on, like a card player's desk.
    const mat = new THREE.Mesh(new THREE.BoxGeometry(depth - 0.6, 0.04, length - 0.8), baize);
    mat.position.set(x + 0.1, top + 0.02, z);
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
    // A shelf on the wall above.
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, length - 1.5), wood);
    shelf.position.set(-ROOM.HALF_WIDTH + 0.95, top + 4.3, z);
    shelf.castShadow = true;
    group.add(shelf);
    for (const dz of [-1, 1]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.16), dark);
      bracket.position.set(-ROOM.HALF_WIDTH + 0.75, top + 3.85, z + dz * (length / 2 - 1.6));
      group.add(bracket);
    }
  },
});

// ── Who and what ──────────────────────────────────────────────────────────────────────────────────────────────────

const ASPECT_COLOURS: Record<string, number> = {
  justice: 0xf2c230,
  leadership: 0x3d8fe0,
  aggression: 0xd8342b,
  protection: 0x3fae4a,
};

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

const store = browserDeckStore();
let heroes: BenchHero[] = [];
let current: BenchHero | null = null;
let panelRoot: HTMLElement | null = null;
let contents: HTMLElement | null = null;
let screen: DeckScreen | null = null;
let screenHost: HTMLElement | null = null;
/** The deck the builder was opened on, to put the focus back on its row afterwards. */
let editing: string | null = null;

interface Box {
  readonly hero: HeroId;
  readonly mesh: THREE.Group;
  readonly home: THREE.Vector3;
  /** How far forward it stands (0 back on the bench, 1 chosen). */
  out: number;
}
const boxes: Box[] = [];

const savedFor = (hero: BenchHero): SavedDeck[] =>
  store.list().filter((deck) => deck.identityCardId === hero.card.identityCardId);

// ── The deck boxes ────────────────────────────────────────────────────────────────────────────────────────────────

/** The box's side: dark card stock with the hero's name, and their starter aspect's colour along the edge. */
function sidePrint(hero: BenchHero): HTMLCanvasElement {
  const [cv, g] = canvas(256, 384);
  g.fillStyle = "#15110d";
  g.fillRect(0, 0, 256, 384);
  g.fillStyle = `#${(ASPECT_COLOURS[hero.card.starterAspect] ?? 0x8d877d).toString(16).padStart(6, "0")}`;
  g.fillRect(0, 0, 256, 26);
  g.save();
  g.translate(128, 200);
  g.rotate(-Math.PI / 2);
  g.fillStyle = "#f3eee3";
  g.font = "900 34px 'Public Sans', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(hero.name.toUpperCase(), 0, 0);
  g.restore();
  return cv;
}

async function buildBoxes(group: THREE.Group) {
  const spacing = Math.min(2.1, (BENCH.length - 2) / Math.max(1, heroes.length));
  const first = BENCH.z - (spacing * (heroes.length - 1)) / 2;
  const scans = await Promise.all(heroes.map((hero) => loadImage(cardArtUrl(hero.card.identity))));
  heroes.forEach((hero, i) => {
    const stock = new THREE.MeshStandardMaterial({ map: texture(sidePrint(hero)), roughness: 0.7 });
    const scan = scans[i];
    const front = scan
      ? new THREE.MeshStandardMaterial({ map: texture(scan), roughness: 0.55 })
      : new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.7 });
    const lid = new THREE.MeshStandardMaterial({
      color: ASPECT_COLOURS[hero.card.starterAspect] ?? 0x8d877d,
      roughness: 0.5,
    });
    // A deck box standing upright, its front (the hero's card) facing the room: +x, -x, +y, -y, +z, -z.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.1, 1.5), [front, stock, lid, stock, stock, stock]);
    body.castShadow = true;
    const mesh = new THREE.Group();
    mesh.add(body);
    const home = new THREE.Vector3(BENCH.x - 0.4, BENCH.top + 1.07, first + i * spacing);
    mesh.position.copy(home);
    group.add(mesh);
    boxes.push({ hero: hero.id, mesh, home, out: 0 });
  });
}

// ── The panel ─────────────────────────────────────────────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function paint(focusKey?: string) {
  if (!contents || !current) return;
  const hero = current;
  const chosen = chosenDeck(hero.id);
  const heroRow = el("div", "bench-row");
  heroRow.setAttribute("role", "group");
  heroRow.setAttribute("aria-label", "Hero");
  heroRow.append(el("span", "bench-label", "Hero"));
  const heroOptions = el("div", "bench-options");
  for (const each of heroes) {
    const button = el("button", "btn btn-option bench-hero", each.name);
    button.type = "button";
    button.dataset.bench = `hero:${each.id}`;
    button.setAttribute("aria-pressed", String(each.id === hero.id));
    button.onclick = () => pickHero(each.id);
    heroOptions.append(button);
  }
  heroRow.append(heroOptions);

  const deckList = el("div", "bench-decks");
  deckList.setAttribute("role", "group");
  deckList.setAttribute("aria-label", `${hero.name}'s decks`);
  const starterAspect = ASPECT_NAMES[hero.card.starterAspect];
  deckList.append(
    deckRow(
      hero,
      STARTER,
      "Starter deck",
      `${starterAspect}, as printed`,
      null,
      chosen === STARTER || !hasDeck(chosen),
    ),
  );
  for (const deck of savedFor(hero)) {
    const verdict = dealVerdict(deck, TABLE_ASPECTS);
    const aspect = deck.aspects[0];
    const note = `${cardCount(deck)} cards${aspect ? `, ${ASPECT_NAMES[aspect]}` : ""}`;
    deckList.append(deckRow(hero, deck.id, deck.name, note, verdict.ok ? null : verdict.reason, chosen === deck.id));
  }
  const fresh = el("button", "btn btn-secondary bench-new", "New deck");
  fresh.type = "button";
  fresh.dataset.bench = "new";
  fresh.onclick = () => openBuilder("new");

  const line = el("p", "bench-line");
  line.setAttribute("aria-live", "polite");
  const deckName = chosen !== STARTER && hasDeck(chosen) ? store.get(chosen)!.name : "their starter deck";
  line.textContent = `Campaign and Free Play deal ${hero.name} with ${deckName}.`;

  contents.replaceChildren(heroRow, el("h3", "bench-title", `${hero.name}'s decks`), deckList, fresh, line);
  if (focusKey) contents.querySelector<HTMLElement>(`[data-bench="${CSS.escape(focusKey)}"]`)?.focus();
}

const hasDeck = (id: string) => id !== STARTER && store.get(id) !== undefined;

/** One deck: the button that chooses it for play (or says why it can't), and Edit. */
function deckRow(
  hero: BenchHero,
  id: string,
  name: string,
  note: string,
  heldBack: string | null,
  chosen: boolean,
): HTMLElement {
  const row = el("div", "bench-deck");
  const pick = el("button", "btn btn-option bench-pick");
  pick.type = "button";
  pick.dataset.bench = `deck:${id}`;
  pick.setAttribute("aria-pressed", String(chosen));
  if (heldBack) pick.setAttribute("aria-disabled", "true");
  pick.append(el("strong", "", name), el("small", "", heldBack ?? note));
  pick.onclick = () => {
    if (heldBack) {
      say(`${name} can't be dealt: ${heldBack}`);
      return;
    }
    chooseDeck(hero.id, id);
    say(`${hero.name} will play ${id === STARTER ? "their starter deck" : name}.`);
    paint(`deck:${id}`);
  };
  const edit = el("button", "btn btn-ghost bench-edit", id === STARTER ? "Build from it" : "Edit");
  edit.type = "button";
  edit.dataset.bench = `edit:${id}`;
  edit.setAttribute("aria-label", id === STARTER ? `Build a deck from ${hero.name}'s starter deck` : `Edit ${name}`);
  edit.onclick = () => openBuilder(id);
  row.append(pick, edit);
  return row;
}

function pickHero(id: HeroId) {
  const hero = heroes.find((each) => each.id === id);
  if (!hero) return;
  current = hero;
  rememberHero(id);
  followHero(id);
  paint(`hero:${id}`);
}

// ── The builder, over the room ────────────────────────────────────────────────────────────────────────────────────

async function ensureScreen(): Promise<DeckScreen> {
  if (screen) return screen;
  const { createDeckScreen } = await import("../../decks/deck-screen.js");
  screenHost = el("div");
  screenHost.setAttribute("role", "region");
  screenHost.setAttribute("aria-label", "Deck builder");
  root.append(screenHost);
  screen = createDeckScreen(screenHost, {
    mode: "room",
    heroes: heroes.map((hero) => hero.card.identityCardId),
    aspects: TABLE_ASPECTS,
    store,
    backLabel: "‹ Bench",
    onExit: closeBuilder,
  });
  return screen;
}

function openBuilder(deck: string) {
  if (!current) return;
  const hero = current;
  editing = deck;
  void ensureScreen().then((built) => {
    if (panelRoot) panelRoot.inert = true;
    built.open(hero.card.identityCardId, deck);
  });
}

/** The builder was left: back to the bench, its list redrawn (a deck saved or deleted), the focus where it was. */
function closeBuilder(savedId: string | null) {
  if (screenHost) screenHost.hidden = true;
  if (panelRoot) panelRoot.inert = false;
  // A deck just built (from new, or from the starter deck) is the one this hero plays, when it can be dealt.
  const saved = savedId ? store.get(savedId) : undefined;
  const fresh = editing === "new" || editing === STARTER;
  if (current && fresh && saved && dealVerdict(saved, TABLE_ASPECTS).ok) chooseDeck(current.id, saved.id);
  const focus = saved
    ? `deck:${saved.id}`
    : editing && editing !== "new" && hasDeck(editing)
      ? `deck:${editing}`
      : "new";
  editing = null;
  paint(focus);
}

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const ARROWS: Record<string, FocusDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function key(event: KeyboardEvent): boolean {
  if (screen?.isOpen()) return screen.key(event);
  const direction = ARROWS[event.key];
  if (!direction || !panelRoot) return false;
  const buttons = [...panelRoot.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => !button.hidden && button.getClientRects().length > 0,
  );
  const active = document.activeElement as HTMLElement | null;
  event.preventDefault();
  if (!active || !buttons.includes(active as HTMLButtonElement)) {
    buttons[0]?.focus();
    return true;
  }
  const rect = (node: HTMLElement) => {
    const r = node.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  const others = buttons.filter((button) => button !== active).map((button) => ({ key: button, rect: rect(button) }));
  (spatialPick(others, rect(active), direction) ?? spatialPick(others, rect(active), direction, true))?.focus();
  return true;
}

// ── Mounting ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fills the bench (`main.ts`, once the room has loaded). */
export function mountBench() {
  decks.mount({
    line: "Pick a hero, build a deck",
    async build(group, panel) {
      heroes = benchHeroes();
      current = chosenHero(heroes);
      panelRoot = panel.closest<HTMLElement>(".room-panel") ?? panel;
      panel.classList.add("bench");
      contents = panel;
      await Promise.all([document.fonts.load("900 34px 'Public Sans'"), buildBoxes(group)]);
      paint();
    },
    enter() {
      // A deck saved or deleted elsewhere (Free Play's slot only chooses) and the hero chosen since: drawn fresh.
      if (heroes.length) {
        current = chosenHero(heroes);
        paint();
      }
    },
    back: () => screen?.back() ?? false,
    key,
    step(dt) {
      for (const box of boxes) {
        const target = box.hero === current?.id ? 1 : 0;
        box.out += (target - box.out) * Math.min(1, dt * 8);
        box.mesh.position.set(box.home.x + box.out * 0.9, box.home.y + box.out * 0.25, box.home.z);
        box.mesh.rotation.y = box.out * 0.18;
      }
    },
  });
}
