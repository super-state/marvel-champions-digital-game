/**
 * Where every deck box stands on the hero shelf (`hero-shelf.ts` builds it): which shelf, how far along, face-out or
 * side-on, and the release names under them. Kept apart from the building so it can be tested without a page.
 *
 * Two looks, while Adam picks one (`?shelf=` on the page's address):
 *   spines (the default)  every box side-on, its spine to the room, as on a real shelf; the lit ones turned face-out
 *   faces                 every box face-out, its hero's card showing: a taller wall of smaller boxes
 *
 * Read top-left to bottom-right, as a bookcase is: the room's camera at the bench looks at the left wall (towards -x),
 * so the reader's left is +z.
 */
import * as THREE from "three";
import { SHELF_HEROES, SHELF_RELEASES, type ShelfHero } from "./hero-catalogue.js";
export type ShelfLook = "spines" | "faces";

export const SHELF_LOOK: ShelfLook = (() => {
  try {
    return new URLSearchParams(location.search).get("shelf") === "faces" ? "faces" : "spines";
  } catch {
    return "spines";
  }
})();

/** The bookcase: its middle along the wall (z), the width inside, and how deep it is (x). */
export const CASE_SPAN = { z: -0.6, width: 13.9, depth: 1.75 };

/** A box's size, (`face`) face-out or side-on: across (z), tall, and deep (x, into the shelf). */
export interface BoxSize {
  readonly across: number;
  readonly tall: number;
  readonly deep: number;
}

interface Look {
  readonly face: BoxSize;
  readonly spine: BoxSize;
  /** Space between two boxes, and between two releases. */
  readonly gap: number;
  readonly releaseGap: number;
  /** Whether a release may run on to the next shelf (otherwise it starts a new shelf when it doesn't fit). */
  readonly split: boolean;
  /** Turned face-out: every box, or only the lit ones. */
  readonly faceOut: "all" | "lit";
}

const LOOKS: Record<ShelfLook, Look> = {
  spines: {
    face: { across: 1.4, tall: 1.96, deep: 0.7 },
    spine: { across: 0.66, tall: 1.96, deep: 1.4 },
    gap: 0.03,
    releaseGap: 0.45,
    split: false,
    faceOut: "lit",
  },
  faces: {
    face: { across: 1.0, tall: 1.4, deep: 0.5 },
    spine: { across: 0.5, tall: 1.4, deep: 1.0 },
    gap: 0.08,
    releaseGap: 0.35,
    split: true,
    faceOut: "all",
  },
};

/** How far apart two shelves are, above a box's height (the board and some room over the boxes). */
const HEADROOM = 0.62;
export const BOARD = 0.16;

export interface ShelfSlot {
  readonly hero: ShelfHero;
  readonly faceOut: boolean;
  readonly size: BoxSize;
  /** The box's middle, standing on its shelf at the back. */
  readonly at: THREE.Vector3;
}

export interface ShelfLabel {
  readonly text: string;
  /** Where the release's boxes run along the shelf (z, from the reader's left to right), and that shelf's height. */
  readonly from: number;
  readonly to: number;
  readonly y: number;
}

export interface ShelfLayout {
  readonly slots: readonly ShelfSlot[];
  readonly labels: readonly ShelfLabel[];
  readonly shelves: number;
  /** The board each shelf's boxes stand on (top surfaces), top shelf first; and the bookcase's top. */
  readonly floors: readonly number[];
  readonly top: number;
  readonly bottom: number;
}

/**
 * Lays every hero out: releases in order, a release's boxes together, onto as many shelves as they need. `lit` is the
 * identity card ids of the heroes the table can deal. The bookcase's back stands at x = `back` (the wall), its bottom
 * at `bottom` (the bench top).
 */
export function layoutShelf(
  lit: ReadonlySet<string>,
  { back, bottom }: { back: number; bottom: number },
  look: ShelfLook = SHELF_LOOK,
): ShelfLayout {
  const spec = LOOKS[look];
  const faceOut = (hero: ShelfHero) => spec.faceOut === "all" || lit.has(hero.code);
  const sizeOf = (hero: ShelfHero) => (faceOut(hero) ? spec.face : spec.spine);
  const tall = Math.max(spec.face.tall, spec.spine.tall);
  const inner = CASE_SPAN.width - 0.5;

  // Each shelf: the runs of boxes on it, a run being one release's boxes (or part of one, where a release may split).
  type Run = { release: string; heroes: ShelfHero[] };
  const shelves: Run[][] = [[]];
  let used = 0;
  for (const release of SHELF_RELEASES) {
    const heroes = SHELF_HEROES.filter((hero) => hero.release === release.id);
    const span = (list: readonly ShelfHero[]) => list.reduce((sum, hero) => sum + sizeOf(hero).across + spec.gap, 0);
    const opening = () => (shelves.at(-1)!.length ? spec.releaseGap : 0);
    if (!spec.split) {
      if (used && used + opening() + span(heroes) > inner) {
        shelves.push([]);
        used = 0;
      }
      used += opening() + span(heroes);
      shelves.at(-1)!.push({ release: release.id, heroes });
      continue;
    }
    let run: Run | null = null;
    for (const hero of heroes) {
      const width = sizeOf(hero).across + spec.gap;
      const lead = run ? 0 : opening();
      if (used + lead + width > inner) {
        shelves.push([]);
        used = 0;
        run = null;
      }
      if (!run) {
        used += shelves.at(-1)!.length ? spec.releaseGap : 0;
        run = { release: release.id, heroes: [] };
        shelves.at(-1)!.push(run);
      }
      run.heroes.push(hero);
      used += width;
    }
  }

  const pitch = tall + HEADROOM;
  const count = shelves.length;
  const floors = shelves.map((_, i) => bottom + BOARD + (count - 1 - i) * pitch);
  const slots: ShelfSlot[] = [];
  const labels: ShelfLabel[] = [];
  const left = CASE_SPAN.z + CASE_SPAN.width / 2;
  shelves.forEach((runs, row) => {
    // Centre each shelf's boxes along it.
    const width =
      runs.reduce((sum, run) => sum + run.heroes.reduce((s, hero) => s + sizeOf(hero).across + spec.gap, 0), 0) +
      (runs.length - 1) * spec.releaseGap -
      spec.gap;
    let z = left - (CASE_SPAN.width - width) / 2;
    runs.forEach((run, i) => {
      if (i) z -= spec.releaseGap;
      const from = z;
      for (const hero of run.heroes) {
        const size = sizeOf(hero);
        const x = back + 0.12 + size.deep / 2;
        const at = new THREE.Vector3(x, floors[row]! + size.tall / 2, z - size.across / 2);
        slots.push({ hero, faceOut: faceOut(hero), size, at });
        z -= size.across + spec.gap;
      }
      const name = SHELF_RELEASES.find((release) => release.id === run.release)!.name;
      labels.push({ text: name, from, to: z + spec.gap, y: floors[row]! });
    });
  });
  return { slots, labels, shelves: count, floors, top: bottom + BOARD + count * pitch, bottom };
}
