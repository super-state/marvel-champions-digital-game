/**
 * The title: the camera stands in the doorway with the whole room in view, under the game's name and the player's
 * (when the test site knows it). "Press any button" (a key, a click, a tap, any button on a pad) brings up the menu:
 * a real button for each place, laid over the picture. Pointing at or focusing a choice leans the camera a little
 * towards its place; choosing it glides there (`index.ts`). A place that isn't built yet says "Coming soon".
 */
import { camera, copyPose, lerpPose, newPose, setPose, type Pose } from "../camera.js";
import { fitNarrow, makePanel, type Place, type PlaceId } from "./place.js";

/** How far a pointed-at choice leans the camera towards its place, and how quickly it eases there. */
const LEAN = 0.17;
const LEAN_RATE = 3.2;
/** A press that brings up the menu can't also choose from it: the menu waits this long after it appears. */
const MENU_GUARD_MS = 350;

const panel = makePanel(
  "title",
  "room-title",
  `<div class="room-brand">
    <p class="eyebrow">A co-op card game</p>
    <h1 class="room-name">Marvel Champions</h1>
    <p class="room-player" hidden></p>
  </div>
  <button type="button" class="room-press">Press any button</button>
  <nav class="room-menu" aria-label="Main menu" hidden></nav>`,
);
const press = panel.querySelector<HTMLButtonElement>(".room-press")!;
const menu = panel.querySelector<HTMLElement>(".room-menu")!;
const playerLine = panel.querySelector<HTMLElement>(".room-player")!;

interface TitleHooks {
  /** The menu's places, in order. */
  choices(): readonly Place[];
  /** Go there (the room checks it is ready). */
  go(id: PlaceId): void;
}
let hooks: TitleHooks | null = null;
let shownAt = 0;
/** The choice the camera leans towards (pointed at, or focused), or null. */
let lean: Place | null = null;
/** The place the camera last came back from: its choice takes the focus. */
let cameFrom: PlaceId | null = null;
let atPress = true;
const lessMotion = matchMedia("(prefers-reduced-motion: reduce)");

export function configureTitle(next: TitleHooks) {
  hooks = next;
}

/** Who is playing, under the name; null hides the line. */
export function showPlayer(name: string | null) {
  playerLine.textContent = name ? `Playing as ${name}` : "";
  playerLine.hidden = !name;
}

/** Back to "Press any button" (each time the room opens on the title). */
export function resetTitle() {
  atPress = true;
  press.hidden = false;
  menu.hidden = true;
  lean = null;
  cameFrom = null;
  panel.dataset.stage = "press";
}

/** "Press any button" has been pressed: the menu comes up, its first choice focused. */
export function showMenu() {
  if (!atPress) return;
  atPress = false;
  shownAt = performance.now();
  press.hidden = true;
  paintMenu();
  menu.hidden = false;
  panel.dataset.stage = "menu";
  focusChoice();
}

/** Whether the title is still waiting for its first press. */
export const waitingForPress = () => atPress && !panel.hidden;

function paintMenu() {
  menu.replaceChildren();
  for (const place of hooks?.choices() ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "room-choice";
    button.dataset.go = place.id;
    const ready = place.ready();
    if (!ready) button.setAttribute("aria-disabled", "true");
    const name = document.createElement("span");
    name.className = "room-choice-name";
    name.textContent = place.label;
    const line = document.createElement("span");
    line.className = "room-choice-line";
    line.textContent = ready ? place.line : "Coming soon";
    button.append(name, line);
    button.onclick = () => {
      if (performance.now() - shownAt < MENU_GUARD_MS) return;
      hooks?.go(place.id);
    };
    const leanHere = () => (lean = place);
    // Pointing at a choice also takes the focus there, so one choice is lit at a time and Enter takes the one pointed at.
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") button.focus({ preventScroll: true });
    });
    const leanOff = () => {
      if (lean === place) lean = null;
    };
    button.addEventListener("pointerenter", leanHere);
    button.addEventListener("focus", leanHere);
    button.addEventListener("pointerleave", () => {
      // The keyboard's choice keeps the lean when the pointer moves off.
      if (document.activeElement !== button) leanOff();
    });
    button.addEventListener("blur", leanOff);
    menu.append(button);
  }
}

function focusChoice() {
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
  const back = cameFrom ? buttons.find((b) => b.dataset.go === cameFrom) : undefined;
  (back ?? buttons[0])?.focus({ preventScroll: true });
}

/**
 * Up and down move through the menu as Tab does (the room's key guard, `index.ts`, hands them here: it stops every key
 * before it reaches the page). Says whether it used the key.
 */
export function menuKey(event: KeyboardEvent): boolean {
  if (menu.hidden || panel.hidden || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return false;
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = at < 0 ? buttons[0] : buttons[(at + step + buttons.length) % buttons.length];
  next?.focus({ preventScroll: true });
  event.preventDefault();
  return true;
}
press.onclick = showMenu;

/** The camera in the doorway: the whole room in view, standing further back (and wider) on a narrow screen. */
function doorway(out: Pose, aspect: number): Pose {
  const narrow = aspect < 1;
  setPose(out, [0, 8.6, 27], [0, -1.2, -2], narrow ? 64 : 50, [34, 80], 0);
  return fitNarrow(out, aspect, 1.6, 0.32);
}

const smooth = newPose();
const wanted = newPose();
const towards = newPose();
let settled = false;

export const titlePlace: Place & { cameFrom(id: PlaceId): void } = {
  id: "title",
  label: "Marvel Champions",
  line: "",
  panel,
  ready: () => true,
  view(out) {
    if (!settled) {
      doorway(smooth, camera.aspect);
      settled = true;
    }
    copyPose(out, smooth);
  },
  build: () => Promise.resolve(),
  enter() {
    if (atPress) press.focus({ preventScroll: true });
    else {
      paintMenu();
      focusChoice();
    }
  },
  leave() {
    lean = null;
  },
  back() {
    // At "press any button", Back is a press like any other; at the menu there is nowhere further back to go.
    if (atPress) showMenu();
    return true;
  },
  step(dt) {
    doorway(wanted, camera.aspect);
    if (lean && !lessMotion.matches) {
      lean.view(towards);
      lerpPose(wanted, wanted, towards, LEAN);
      // The doorway sees the whole room sharp, leaning or not.
      wanted.blur = 0;
    }
    if (!settled) {
      copyPose(smooth, wanted);
      settled = true;
    } else lerpPose(smooth, smooth, wanted, 1 - Math.exp(-dt * LEAN_RATE));
  },
  cameFrom(id) {
    cameFrom = id;
  },
};
