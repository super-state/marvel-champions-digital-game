/**
 * The room over the 3D table page, the table's front door. There is no menu screen: every menu choice is a place in
 * one room (`docs/project/room-plan.md`, `docs/project/room-map.svg`), and choosing it glides the camera there.
 *
 *   title       the doorway, the whole room in view: the game's name, "press any button", then the menu
 *   campaign    the villain boxes on the table (Play deals the game and hands over to the table)
 *   settings    the radio on the shelf
 *   free-play   the setup tray on the table          } furniture until their tasks mount them (`places/place.ts`):
 *   decks       the bench on the left wall           } "Coming soon" on the menu
 *   trophies    the cabinet and board on the right   }
 *
 * Back (Escape, B on a pad, a place's Back button) goes one step back towards the doorway. With "reduce motion" the
 * camera fades between places instead of gliding. The room lies over the table page (`main.ts` loads it when the page
 * opens, and again for New game, which starts at the boxes), with its own renderer. A place's things are built the
 * first time the camera heads there; the boxes, seen from the doorway too, just after the title first shows.
 *
 * For checks and screenshots: `?room=settings` (any place) starts there; `?open=klaw` jumps straight to an opened box,
 * `&play` presses Play, `&at=1.8` freezes the opening and `&hold=2.4` the move onto the table. `#shelf` carries
 * `data-place` (where the camera is, or is heading) and `data-moving` (while it travels).
 *
 * The room itself is `room.ts`, the camera `camera.ts`, and each place has its own file in `places/`.
 */
import type { Fog } from "three";
import { closeTo, currentPose, fadeAmount, headTo, moving, newPose, stepCamera } from "./camera.js";
import { boxesBuilt, campaignPlace, openFromAddress, reset as resetCampaign } from "./places/campaign.js";
import { play, stepOutro, type ShelfHost } from "./places/campaign-play.js";
import { decks } from "./places/decks.js";
import { freePlay, mountFreePlay } from "./places/free-play.js";
import type { Place, PlaceId } from "./places/place.js";
import { furnishSettings, offerSettings, settingsPlace } from "./places/settings.js";
import {
  configureTitle,
  menuKey,
  resetTitle,
  showMenu,
  showPlayer,
  titlePlace,
  waitingForPress,
} from "./places/title.js";
import { trophies } from "./places/trophies.js";
import { buildRoom, renderFrame, resize, root, say, scene } from "./room.js";

export type { RoomGame, ShelfHost } from "./places/campaign-play.js";
export type { RoomSetting } from "./places/settings.js";
export type { PlaceContents, PlaceId } from "./places/place.js";
/** The places still to be filled, for their tasks to `mount` once the room has loaded (`places/place.ts`). */
export { decks, freePlay, trophies };
/** Fills Free Play's tray (once, after the room has loaded). */
export { mountFreePlay };
/** Fills Trophies & Stats (once, after the room has loaded). */
export { mountTrophies, type TrophySource } from "./places/trophy-cabinet.js";
/** Fills the bench: the heroes' deck boxes, their decks, and the deck builder (once, after the room has loaded). */
export { mountBench } from "./places/decks.js";

const places: Record<PlaceId, Place> = {
  title: titlePlace,
  campaign: campaignPlace,
  "free-play": freePlay,
  decks,
  trophies,
  settings: settingsPlace,
};
const allPlaces: readonly Place[] = Object.values(places);
/** The title menu, in order. */
const MENU: readonly PlaceId[] = ["campaign", "free-play", "decks", "trophies", "settings"];
const isPlace = (id: string | null): id is PlaceId => !!id && id in places;
const lessMotion = matchMedia("(prefers-reduced-motion: reduce)");

/** A spare pose: where the camera is heading. */
const ahead = newPose();
/** Where the camera is (or, while `heading` is set, where it was). */
let here: PlaceId = "title";
let heading: PlaceId | null = null;

configureTitle({ choices: () => MENU.map((id) => places[id]), go: (id) => void go(id) });

function showPanel(id: PlaceId | null) {
  for (const place of allPlaces) place.panel.hidden = place.id !== id;
}

/**
 * Glides the camera to a place (or fades, with "reduce motion"), building its things first if this is the first
 * visit. A place that isn't ready yet says so instead, unless `force` (`?room=`). With `now`, it is there at once.
 */
async function go(id: PlaceId, options: { force?: boolean; now?: boolean } = {}) {
  const place = places[id];
  if (heading || play.outro) return;
  if (!place.ready() && !options.force) {
    say(`${place.label} is coming soon.`);
    return;
  }
  if (id === here && !options.now) return;
  const from = places[here];
  from.leave();
  showPanel(null);
  heading = id;
  root.dataset.place = id;
  root.dataset.moving = "";
  try {
    await place.build();
  } catch (error) {
    // Its things couldn't be built (a picture or a font failed to load): stay where the camera is, still usable.
    console.error(error);
    heading = null;
    root.dataset.place = here;
    delete root.dataset.moving;
    showPanel(here);
    places[here].enter();
    say(`${place.label} couldn't be opened. Try again in a moment.`);
    return;
  }
  if (id === "title" && here !== "title") {
    titlePlace.cameFrom(here);
    titlePlace.resumeFrom(currentPose());
  }
  // The menu has usually brought the camera to the place's view already: then it opens at once, with no second move.
  place.view(ahead);
  const now = !!options.now || closeTo(ahead);
  headTo((out) => place.view(out), { fade: lessMotion.matches, now });
  if (now) arrive();
}

function arrive() {
  if (!heading) return;
  here = heading;
  heading = null;
  delete root.dataset.moving;
  const place = places[here];
  root.setAttribute("aria-label", here === "title" ? "Marvel Champions" : place.label);
  showPanel(here);
  place.enter();
  // The keyboard (and a pad) starts on the place's first button, unless the place chose one.
  if (!place.panel.contains(document.activeElement))
    place.panel.querySelector<HTMLElement>("button:not([hidden])")?.focus({ preventScroll: true });
}

/** One step back towards the doorway: the place puts something away first if it has something out. */
export function back() {
  if (root.hidden || heading || play.outro) return;
  if (places[here].back()) return;
  if (here !== "title") void go("title");
}

// Keys are the room's while it is up: none reach the table's own (Enter for End Turn, Escape for its menu, Ctrl+Z) on
// the page underneath. Listening on the window in the capture phase runs before every one of those.
addEventListener(
  "keydown",
  (event) => {
    if (root.hidden) return;
    event.stopPropagation();
    if (waitingForPress()) {
      // Any key is "any button". The modifier keys alone, Tab (moving round the page), the F keys and the browser's
      // own shortcuts (Ctrl+R) are not, and still do what they do.
      if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(event.key) || /^F\d+$/.test(event.key)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      showMenu();
      return;
    }
    if (menuKey(event)) return;
    // A place's own keys (a mounted place's binder, say) come before Escape's step back.
    if (!heading && places[here].key?.(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      back();
    }
  },
  { capture: true },
);
// Any button on a pad, at "press any button" (the table's controller then moves the focus and presses the menu's
// buttons, and its B comes here through `main.ts` as Back).
let padHeld = true;
function padPressed(): boolean {
  let any = false;
  for (const pad of navigator.getGamepads?.() ?? []) if (pad?.buttons.some((button) => button.pressed)) any = true;
  const fresh = any && !padHeld;
  padHeld = any;
  return fresh;
}
root.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest(".room-back")) back();
});

let last = performance.now();
let looping = false;
function frame(now: number) {
  if (play.stopped) {
    looping = false;
    return;
  }
  // Never backwards: a frame's time can come before `last` when `last` was read from `performance.now()` (a headless
  // browser's frames run seconds behind it), and a negative step flung the boxes off the table.
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  stepOutro(dt);
  if (play.stopped) {
    looping = false;
    return;
  }
  if (padPressed() && waitingForPress()) showMenu();
  const time = now / 1000;
  for (const place of allPlaces) place.step(dt, time);
  const { blur, arrived } = stepCamera(dt, scene.fog as Fog);
  if (arrived) arrive();
  fade.style.opacity = String(fadeAmount());
  renderFrame(blur);
  requestAnimationFrame(frame);
}
const fade = root.querySelector<HTMLElement>(".room-fade")!;

let built: Promise<void> | null = null;
function buildShell() {
  buildRoom();
  furnishSettings();
  for (const place of [freePlay, decks, trophies]) place.furnish();
}

/** Where the room opens: `?room=`, else `?open=` (the boxes), else what `main.ts` asked for, else the doorway. */
function startingPlace(asked: PlaceId | undefined): PlaceId {
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (isPlace(room)) return room;
  if (params.has("open")) return "campaign";
  return asked ?? "title";
}

/**
 * Puts the room up over the table page, at the doorway's "press any button" (or `start`: New game starts at the
 * boxes). The first time with `?open=rhino` in the address, that box is already open. Resolves once the room is
 * drawn.
 */
export async function openShelf(over: ShelfHost, start?: PlaceId): Promise<void> {
  play.host = over;
  root.hidden = false;
  root.style.opacity = "1";
  // The keyboard starts in the room, not on the table underneath.
  root.focus({ preventScroll: true });
  offerSettings(over.settings?.() ?? []);
  void over.player?.().then(showPlayer, () => showPlayer(null));
  await (built ??= Promise.resolve().then(buildShell));
  resize();
  // Whatever place the room was left at (the boxes, after Play) lets go of the pointer and the keys.
  places[here].leave();
  resetCampaign();
  here = "title";
  heading = null;
  padHeld = true;
  const first = startingPlace(start);
  // The doorway asks for a button press each time the room opens on it; New game, at the boxes, leaves the menu up.
  if (first === "title") resetTitle();
  await go(first, { force: true, now: true });
  // `?open=klaw` opens a box (and `&play` presses Play) once the camera stands at the boxes: Play's swing round to the
  // table starts from there.
  if (first === "campaign") openFromAddress();
  if (first === "title") {
    // The boxes stand on the table, seen from the doorway: build them once the title is up.
    if (!boxesBuilt()) setTimeout(() => void campaignPlace.build(), 0);
  }
  renderFrame(stepCamera(0, scene.fog as Fog).blur);
  play.stopped = false;
  last = performance.now();
  if (!looping) {
    looping = true;
    requestAnimationFrame(frame);
  }
}

/** Whether the room is up over the table. */
export const shelfShown = () => !root.hidden;
/** Whether the camera is on its way between places (for checks). */
export const roomMoving = moving;
