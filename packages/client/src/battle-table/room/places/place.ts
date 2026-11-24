/**
 * A place in the room: where the camera stands to look at it, the things standing there, and its buttons (a panel laid
 * over the picture, shown only while the camera is there). The title menu glides the camera from the doorway to each
 * place, and Back (Escape, B) glides it one step back towards the doorway. The room's map is
 * `docs/project/room-map.svg`; `index.ts` keeps the list of places and moves between them.
 *
 * Three places stand as plain furniture until their task fills them: the deck bench (`decks.ts`), the trophy cabinet
 * and record board (`trophies.ts`) and the Free Play setup tray (`free-play.ts`). Their menu choices say "Coming soon"
 * and the camera doesn't go there (`?room=decks` still does, for checks). To fill one, `mount` it from the module that
 * opens the room, before the room is opened:
 *
 *   import { decks } from "./room/places/decks.js";
 *   decks.mount({
 *     build(group, panel) {
 *       // The first time the camera heads to the bench: things into `group` (it stands at the bench), buttons
 *       // into `panel` (laid over the picture there). May return a promise; the camera waits for it.
 *     },
 *     enter() {}, // the camera has arrived
 *     leave() {}, // it is leaving
 *     back: () => false, // Escape or B here: true if something was put away, false to go back to the doorway
 *     step(dt, time) {}, // each frame while here
 *   });
 */
import * as THREE from "three";
import { camera, newPose, type Pose } from "../camera.js";
import { root, scene } from "../room.js";

export type PlaceId = "title" | "campaign" | "free-play" | "decks" | "trophies" | "settings";

export interface Place {
  readonly id: PlaceId;
  /** Its name on the title menu, and the short line under it. */
  readonly label: string;
  readonly line: string;
  /** Its buttons and words, laid over the picture: shown only while the camera is here. */
  readonly panel: HTMLElement;
  /** Whether there is anything to do here yet: false while it is only furniture ("Coming soon"). */
  ready(): boolean;
  /** Where the camera stands to look at it, now. */
  view(out: Pose): void;
  /** Builds its things the first time the camera heads there (resolves at once after that). */
  build(): Promise<void>;
  /** The camera has arrived. */
  enter(): void;
  /** The camera is leaving. */
  leave(): void;
  /** Escape or B while here: true if something was put away, false to go back towards the doorway. */
  back(): boolean;
  /** Each frame, wherever the camera is. */
  step(dt: number, time: number): void;
}

/** What a later task gives a furniture place to fill it. */
export interface PlaceContents {
  build(group: THREE.Group, panel: HTMLElement): void | Promise<void>;
  enter?(): void;
  leave?(): void;
  back?(): boolean;
  step?(dt: number, time: number): void;
}

/** A place's panel, in the room's layer over the page: hidden until the camera is there. */
export function makePanel(id: PlaceId, className: string, html: string): HTMLElement {
  const panel = document.createElement("section");
  panel.className = `room-panel ${className}`;
  panel.dataset.for = id;
  panel.hidden = true;
  panel.innerHTML = html;
  root.querySelector(".room-panels")!.append(panel);
  return panel;
}

/**
 * Stands the camera further back on a screen narrower than `wide` (width over height), along the line it looks down,
 * so what fits a laptop still fits a phone held upright; the fog moves back with it.
 */
export function fitNarrow(out: Pose, aspect: number, wide = 1.4, power = 0.75): Pose {
  if (aspect >= wide) return out;
  const pull = (wide / aspect) ** power;
  const distance = out.pos.distanceTo(out.at);
  out.pos.sub(out.at).multiplyScalar(pull).add(out.at);
  const extra = distance * (pull - 1);
  out.fogNear += extra;
  out.fogFar += extra;
  return out;
}

export interface FurniturePlace extends Place {
  /** Fills the place: its menu choice opens, and `contents.build` runs the first time the camera heads there. */
  mount(contents: PlaceContents): void;
  /** Stands the furniture in the room (the room calls this once, as it is built). */
  furnish(): void;
}

/**
 * A place that stands as furniture until a later task mounts its contents: until then its panel says "Coming soon"
 * (seen only with `?room=`) and its menu choice doesn't go there.
 */
export function furniturePlace(spec: {
  id: PlaceId;
  label: string;
  /** What will be here, for the "Coming soon" line. */
  promise: string;
  /** Where the camera stands, for a screen of this shape. */
  view(out: Pose, aspect: number): void;
  /** The furniture, built into `group` (already in the scene). */
  furniture(group: THREE.Group): void;
}): FurniturePlace {
  const panel = makePanel(
    spec.id,
    "room-place",
    `<header class="room-place-head">
      <p class="eyebrow">Marvel Champions</p>
      <h2></h2>
      <p class="room-soon"></p>
    </header>
    <div class="room-contents"></div>
    <button type="button" class="btn btn-secondary room-back">Back</button>`,
  );
  panel.querySelector("h2")!.textContent = spec.label;
  const soon = panel.querySelector<HTMLElement>(".room-soon")!;
  soon.textContent = `Coming soon: ${spec.promise}`;
  const contentsPanel = panel.querySelector<HTMLElement>(".room-contents")!;
  const group = new THREE.Group();
  const contentsGroup = new THREE.Group();
  let contents: PlaceContents | null = null;
  let built: Promise<void> | null = null;
  let furnished = false;
  const place: FurniturePlace = {
    id: spec.id,
    label: spec.label,
    get line() {
      return contents ? "" : "Coming soon";
    },
    panel,
    ready: () => contents !== null,
    view: (out) => spec.view(out, camera.aspect),
    build() {
      if (!contents) return Promise.resolve();
      return (built ??= (async () => {
        scene.add(contentsGroup);
        await contents!.build(contentsGroup, contentsPanel);
      })());
    },
    enter: () => contents?.enter?.(),
    leave: () => contents?.leave?.(),
    back: () => contents?.back?.() ?? false,
    step(dt, time) {
      if (contents && built) contents.step?.(dt, time);
    },
    mount(next) {
      contents = next;
      soon.hidden = true;
    },
    furnish() {
      if (furnished) return;
      furnished = true;
      spec.furniture(group);
      scene.add(group);
    },
  };
  return place;
}

/** A spare pose, for working one out without allocating each frame. */
export const scratchPose = newPose();
