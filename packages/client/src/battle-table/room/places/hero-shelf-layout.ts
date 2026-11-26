/**
 * Where every deck box stands on the hero shelf (`hero-shelf.ts` builds it): which shelf, how far along, and which way
 * round. Kept apart from the building so it can be tested without a page.
 *
 * A collector's shelf, not a catalogue: every hero in the game, the ones the table deals lit and first, the rest greyed
 * out after them in release order, with no sets marked out. Adam (2026-11-26) wants "a really good looking nice nerd
 * collection bookshelf", and one way round for every box ("we can't do half and half"), so two looks to compare
 * (`?shelf=` on the page's address):
 *   faces (the default)  every box face-out, its hero's card showing; the lit heroes on display on the top shelf
 *   spines               every box lying flat in stacks, its spine out, so the names read straight across
 * The shelf can be taller than the screen: the bench scrolls down it (`decks.ts`).
 *
 * Read top-left to bottom-right, as a bookcase is: the room's camera at the bench looks at the left wall (towards -x),
 * so the reader's left is +z.
 */
import * as THREE from "three";
import { SHELF_HEROES, SHELF_RELEASES, type ShelfHero } from "./hero-catalogue.js";

export type ShelfLook = "faces" | "spines";

export const SHELF_LOOK: ShelfLook = (() => {
  try {
    return new URLSearchParams(location.search).get("shelf") === "spines" ? "spines" : "faces";
  } catch {
    return "faces";
  }
})();

/** The bookcase: its middle along the wall (z), the width inside, and how deep it is (x). */
export const CASE_SPAN = { z: 0, width: 18, depth: 1.75 };

/** A deck box: across its face, tall, and thick (the spine's width). */
const BOX = { across: 1.4, tall: 1.96, thick: 0.66 };
/** The heroes on display stand bigger, the collection's pride. */
const DISPLAY = { across: 1.75, tall: 2.45, thick: 0.8 };

/** How a box stands: face-out, or lying flat with its spine out. */
export type BoxPose = "face" | "flat";

/** Its size as it stands: along the shelf (z), tall (y), and deep into the shelf (x). */
export interface BoxSize {
  readonly across: number;
  readonly tall: number;
  readonly deep: number;
}

export const BOARD = 0.16;
/** Room over the tallest thing on a shelf. */
const HEADROOM = 0.5;
/** Space between two boxes standing side by side, and between two stacks. */
const GAP = 0.14;
const STACK_GAP = 0.24;
/** How many boxes high a stack is. */
const STACK = 4;
/** The display shelf's boxes stand apart, each on a little stand. */
const DISPLAY_GAP = 1.1;
export const STAND = 0.1;

export interface ShelfSlot {
  readonly hero: ShelfHero;
  readonly lit: boolean;
  readonly pose: BoxPose;
  readonly size: BoxSize;
  /** On a stand on the display shelf. */
  readonly onDisplay: boolean;
  /** The box's middle, at rest on its shelf (or stand, or the box under it). */
  readonly at: THREE.Vector3;
}

export interface ShelfLayout {
  readonly look: ShelfLook;
  readonly slots: readonly ShelfSlot[];
  /** The board each shelf's boxes stand on (top surfaces), top shelf first; and the bookcase's top and bottom. */
  readonly floors: readonly number[];
  readonly top: number;
  readonly bottom: number;
}

const FACE = (box: typeof BOX): BoxSize => ({ across: box.across, tall: box.tall, deep: box.thick });
const FLAT: BoxSize = { across: BOX.tall, tall: BOX.thick, deep: BOX.across };

/** One shelf's worth: the heroes on it, in groups (a stack, or a run standing side by side). */
type Shelf = { readonly tall: number; readonly groups: readonly (readonly ShelfHero[])[] };

/** Cuts the heroes into shelves: a box (or stack) per step along each, as many as fit. */
function shelves(heroes: readonly ShelfHero[], look: ShelfLook, inner: number): Shelf[] {
  const groups: ShelfHero[][] = [];
  const size = look === "spines" ? STACK : 1;
  for (let i = 0; i < heroes.length; i += size) groups.push(heroes.slice(i, i + size));
  const width = look === "spines" ? FLAT.across : BOX.across;
  const gap = look === "spines" ? STACK_GAP : GAP;
  const perShelf = Math.max(1, Math.floor((inner + gap) / (width + gap)));
  const tall = look === "spines" ? STACK * FLAT.tall : BOX.tall;
  const out: Shelf[] = [];
  for (let i = 0; i < groups.length; i += perShelf) out.push({ tall, groups: groups.slice(i, i + perShelf) });
  return out;
}

/**
 * Lays every hero out. `lit` is the identity card ids of the heroes the table can deal. The bookcase's back stands at
 * x = `back` (the wall), its bottom at `bottom` (the bench top).
 */
export function layoutShelf(
  lit: ReadonlySet<string>,
  { back, bottom }: { back: number; bottom: number },
  look: ShelfLook = SHELF_LOOK,
): ShelfLayout {
  const inOrder = SHELF_RELEASES.flatMap((release) => SHELF_HEROES.filter((hero) => hero.release === release.id));
  const shown = inOrder.filter((hero) => lit.has(hero.code));
  const rest = inOrder.filter((hero) => !lit.has(hero.code));
  const inner = CASE_SPAN.width - 0.4;
  // Faces: the lit heroes on display on a shelf of their own. Spines: every box in the same stacks, the lit first.
  const display = look === "faces";
  const below = shelves(display ? rest : [...shown, ...rest], look, inner);

  const heights = [...(display ? [STAND + DISPLAY.tall + 0.15] : []), ...below.map((shelf) => shelf.tall)].map(
    (h) => h + HEADROOM,
  );
  const floors: number[] = [];
  let y = bottom + BOARD;
  for (let i = heights.length - 1; i >= 0; i--) {
    floors[i] = y;
    y += heights[i]! + BOARD;
  }
  const top = y - BOARD;

  const slots: ShelfSlot[] = [];
  const left = CASE_SPAN.z + CASE_SPAN.width / 2;
  const sit = (size: BoxSize) => back + 0.15 + size.deep / 2;

  if (display) {
    const face = FACE(DISPLAY);
    const width = shown.length * face.across + Math.max(0, shown.length - 1) * DISPLAY_GAP;
    let z = left - (CASE_SPAN.width - width) / 2;
    for (const hero of shown) {
      const at = new THREE.Vector3(sit(face) + 0.1, floors[0]! + STAND + face.tall / 2, z - face.across / 2);
      slots.push({ hero, lit: true, pose: "face", size: face, onDisplay: true, at });
      z -= face.across + DISPLAY_GAP;
    }
  }

  // The rest, each shelf's boxes (or stacks) spread evenly along it from the left.
  const pose: BoxPose = look === "spines" ? "flat" : "face";
  const size = pose === "flat" ? FLAT : FACE(BOX);
  const gap = pose === "flat" ? STACK_GAP : GAP;
  const full = Math.floor((inner + gap) / (size.across + gap));
  const run = full * size.across + (full - 1) * gap;
  below.forEach((shelf, i) => {
    const floor = floors[i + (display ? 1 : 0)]!;
    let z = left - (CASE_SPAN.width - run) / 2;
    shelf.groups.forEach((group, g) => {
      group.forEach((hero, k) => {
        // A stack: the first hero at the bottom, each box a touch askew, as stacks are.
        const nudge = pose === "flat" ? (((hero.code.charCodeAt(1) + k * 7 + g) % 5) - 2) * 0.03 : 0;
        const at = new THREE.Vector3(sit(size) + nudge, floor + size.tall * (k + 0.5), z - size.across / 2 + nudge);
        slots.push({ hero, lit: lit.has(hero.code), pose, size, onDisplay: false, at });
      });
      z -= size.across + gap;
    });
  });
  return { look, slots, floors, top, bottom };
}
