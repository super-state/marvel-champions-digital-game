/**
 * Where every deck box stands on the hero shelf (`hero-shelf.ts` builds it), and in what order. Kept apart from the
 * building so it can be tested without a page.
 *
 * A collector's shelf, not a catalogue: every hero in the game in one continuous run, top-left to bottom-right, the
 * heroes the table deals today among the rest and no different from them except that the others are faded (Adam,
 * 2026-11-26: "continuous and non different from any other heroes"). The run can be searched, cut to the playable
 * heroes, and sorted by release, by name, favourites first, or the last played first (`orderHeroes`); the boxes then
 * move to their new places (`decks.ts`).
 *
 * One way round for every box ("we can't do half and half"), so two looks to compare (`?shelf=` on the page's address):
 *   faces (the default)  every box face-out, its hero's card showing
 *   spines               every box lying flat in stacks, its spine out, so the names read straight across
 * The bookcase is built tall enough for every hero; it can be taller than the screen, and the bench scrolls down it.
 *
 * The room's camera at the bench looks at the left wall (towards -x), so the reader's left is +z.
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
/** Face-out, the boxes stand bigger: eight to a shelf, so each hero's card reads (Adam, 2026-11-26: "like 8"). */
const FACE_BOX = { across: 2.0, tall: 2.8, thick: 0.94 };

/** Its size as it stands: along the shelf (z), tall (y), and deep into the shelf (x). */
export interface BoxSize {
  readonly across: number;
  readonly tall: number;
  readonly deep: number;
}

/** Every box the same way round: face-out, or lying flat with its spine out. */
export const boxSize = (look: ShelfLook): BoxSize =>
  look === "spines"
    ? { across: BOX.tall, tall: BOX.thick, deep: BOX.across }
    : { across: FACE_BOX.across, tall: FACE_BOX.tall, deep: FACE_BOX.thick };

export const BOARD = 0.16;
/** Room over the tallest thing on a shelf. */
const HEADROOM = 0.5;
/** Space between two boxes standing side by side, and between two stacks. */
const GAP = 0.14;
const STACK_GAP = 0.24;
/** How many boxes high a stack is. */
const STACK = 4;
/** The room inside the bookcase's sides. */
const INNER = CASE_SPAN.width - 0.4;

// ── The order ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type ShelfSort = "release" | "name" | "favourites" | "played";

export const SHELF_SORTS: readonly { readonly id: ShelfSort; readonly label: string }[] = [
  { id: "release", label: "Release" },
  { id: "name", label: "A–Z" },
  { id: "favourites", label: "Favourites" },
  { id: "played", label: "Last played" },
];

export interface ShelfOrder {
  readonly sort: ShelfSort;
  /** Words to find in a hero's name or alter ego; empty for every hero. */
  readonly search: string;
  /** Only the heroes the table deals. */
  readonly playableOnly: boolean;
  /** The identity card ids of the heroes the table deals. */
  readonly lit: ReadonlySet<string>;
  readonly favourites: ReadonlySet<string>;
  /** When each hero (identity card id) was last played, as a time. */
  readonly lastPlayed: ReadonlyMap<string, number>;
}

const RELEASE_ORDER = new Map(SHELF_RELEASES.map((release, i) => [release.id, i]));
const CATALOGUE_ORDER = new Map(SHELF_HEROES.map((hero, i) => [hero.code, i]));
/** Release order: the releases as they came out, and the catalogue's order within each. */
const byRelease = (a: ShelfHero, b: ShelfHero) =>
  (RELEASE_ORDER.get(a.release) ?? 99) - (RELEASE_ORDER.get(b.release) ?? 99) ||
  CATALOGUE_ORDER.get(a.code)! - CATALOGUE_ORDER.get(b.code)!;

/** Lower case, letters and digits only: "spiderman" finds Spider-Man, "drstrange" Doctor Strange's "Dr." alike. */
const plain = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Every word typed is somewhere in the hero's name or alter ego. */
export function matches(hero: ShelfHero, search: string): boolean {
  const words = search.split(/\s+/).map(plain).filter(Boolean);
  const hay = plain(hero.name) + " " + plain(hero.alterEgo);
  return words.every((word) => hay.includes(word));
}

/** The heroes on the shelf, in the order they stand: the search and the playable cut, then the sort. */
export function orderHeroes(order: ShelfOrder, heroes: readonly ShelfHero[] = SHELF_HEROES): ShelfHero[] {
  const { sort, search, playableOnly, lit, favourites, lastPlayed } = order;
  const shown = heroes.filter((hero) => (!playableOnly || lit.has(hero.code)) && matches(hero, search));
  const compare: Record<ShelfSort, (a: ShelfHero, b: ShelfHero) => number> = {
    release: byRelease,
    name: (a, b) => a.name.localeCompare(b.name) || a.alterEgo.localeCompare(b.alterEgo) || byRelease(a, b),
    favourites: (a, b) => Number(favourites.has(b.code)) - Number(favourites.has(a.code)) || byRelease(a, b),
    played: (a, b) => (lastPlayed.get(b.code) ?? -1) - (lastPlayed.get(a.code) ?? -1) || byRelease(a, b),
  };
  return shown.sort(compare[sort]);
}

// ── The bookcase and the places on it ─────────────────────────────────────────────────────────────────────────────

export interface ShelfFrame {
  readonly look: ShelfLook;
  readonly size: BoxSize;
  /** Boxes (or stacks) side by side on a shelf, and boxes in a stack (1 face-out). */
  readonly across: number;
  readonly stack: number;
  /** The board each shelf's boxes stand on (top surfaces), top shelf first; and the bookcase's top and bottom. */
  readonly floors: readonly number[];
  readonly top: number;
  readonly bottom: number;
}

/** The bookcase, tall enough for every hero in the game. Its bottom stands at `bottom` (the bench top). */
export function shelfFrame(bottom: number, look: ShelfLook = SHELF_LOOK, count = SHELF_HEROES.length): ShelfFrame {
  const size = boxSize(look);
  const stack = look === "spines" ? STACK : 1;
  const gap = look === "spines" ? STACK_GAP : GAP;
  const across = Math.max(1, Math.floor((INNER + gap) / (size.across + gap)));
  const shelves = Math.ceil(Math.ceil(count / stack) / across);
  const height = stack * size.tall + HEADROOM;
  const floors: number[] = [];
  let y = bottom + BOARD;
  for (let i = shelves - 1; i >= 0; i--) {
    floors[i] = y;
    y += height + BOARD;
  }
  return { look, size, across, stack, floors, top: y - BOARD, bottom };
}

/** Which shelf (from the top) the box in the `index`th place stands on. */
export const shelfOf = (frame: ShelfFrame, index: number) => Math.floor(index / frame.stack / frame.across);

/**
 * Where the box in the `index`th of `count` places stands (its middle): each shelf's boxes, or stacks, spread from the
 * left; a stack reads from its top down, each box a touch askew, as stacks are. The bookcase's back stands at x = `back`.
 */
export function spotOf(
  frame: ShelfFrame,
  index: number,
  count: number,
  back: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const { size, across, stack } = frame;
  const gap = stack > 1 ? STACK_GAP : GAP;
  const run = across * size.across + (across - 1) * gap;
  const group = Math.floor(index / stack);
  const inStack = Math.min(stack, count - group * stack);
  const k = inStack - 1 - (index % stack);
  const along = group % across;
  const floor = frame.floors[shelfOf(frame, index)]!;
  const nudge = stack > 1 ? (((group * 3 + k * 7) % 5) - 2) * 0.03 : 0;
  const left = CASE_SPAN.z + CASE_SPAN.width / 2 - (CASE_SPAN.width - run) / 2;
  return out.set(
    back + 0.15 + size.deep / 2 + nudge,
    floor + size.tall * (k + 0.5),
    left - along * (size.across + gap) - size.across / 2 + nudge,
  );
}
