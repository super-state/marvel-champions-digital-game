/**
 * Where every box stands on the scenario shelf (`scenario-shelf.ts` builds it): which shelf and how far along. Kept
 * apart from the building so it can be tested without a page.
 *
 * The boxes stand face-out, their fronts to the room (Adam, 2026-11-27: "fronts of the boxes are better", after a day
 * spine-out), in the order they came out, read left to right and top to bottom, as many to a shelf as fit: the Core
 * Set and the campaign boxes big, the scenario packs smaller, so a shelf is as tall as its tallest box. Sized so the
 * nineteen boxes fill three shelves. The bookcase stands against
 * the back wall, so it faces the room (+z) and the reader's left is -x.
 */
import * as THREE from "three";
import type { BoxSize, ShelfProduct } from "./scenario-catalogue.js";

/** The bookcase: its middle along the wall (x), the width inside, and how deep it is (z). */
export const SCENARIO_CASE = { x: 11.6, width: 11, depth: 1.5 };

export interface ProductMeasure {
  readonly across: number;
  readonly tall: number;
  readonly deep: number;
}

/** A big box (the Core Set, a campaign box) is square, about a quarter as deep as it is wide, as the real ones are; a
 * scenario pack is smaller and upright. */
export const PRODUCT_BOX: Record<BoxSize, ProductMeasure> = {
  big: { across: 1.58, tall: 1.58, deep: 0.45 },
  small: { across: 0.88, tall: 1.3, deep: 0.36 },
};

/** The Core Set's box stands upright and deeper than the campaign boxes, as the real one does. */
const CORE_BOX: ProductMeasure = { across: 1.55, tall: 1.8, deep: 0.61 };

/** A box's size on the shelf. */
export const measureOf = (product: ShelfProduct): ProductMeasure =>
  product.code === "core" ? CORE_BOX : PRODUCT_BOX[product.size];

export const BOARD = 0.16;
const HEADROOM = 0.45;
const GAP = 0.22;
const INNER = SCENARIO_CASE.width - 0.4;

/** What a box takes up on the shelf: standing face-out, its own size. */
const faceOut = (size: ProductMeasure): ProductMeasure => size;

export interface ProductSlot {
  readonly product: ShelfProduct;
  /** The box's own size (its front `across` by `tall`, `deep` front to back). */
  readonly size: ProductMeasure;
  /** What it takes up on the shelf, standing face-out: along the shelf, up, and back into it. */
  readonly foot: ProductMeasure;
  /** The box's middle, standing on its shelf. */
  readonly at: THREE.Vector3;
}

export interface ScenarioLayout {
  readonly slots: readonly ProductSlot[];
  /** The board each shelf's boxes stand on (top surfaces), top shelf first; and the bookcase's top and bottom. */
  readonly floors: readonly number[];
  readonly top: number;
  readonly bottom: number;
}

/** Stands every box. The bookcase's back is at z = `back` (the wall), its bottom at y = `bottom`. */
export function layoutScenarios(
  products: readonly ShelfProduct[],
  { back, bottom }: { back: number; bottom: number },
): ScenarioLayout {
  // Cut into shelves: as many boxes, in order, as fit across.
  const rows: ShelfProduct[][] = [];
  let width = Infinity;
  for (const product of products) {
    const across = faceOut(measureOf(product)).across;
    if (width + GAP + across > INNER) {
      rows.push([]);
      width = -GAP;
    }
    rows[rows.length - 1]!.push(product);
    width += GAP + across;
  }
  const heights = rows.map((row) => Math.max(...row.map((p) => measureOf(p).tall)) + HEADROOM);
  const floors: number[] = [];
  let y = bottom + BOARD;
  for (let i = rows.length - 1; i >= 0; i--) {
    floors[i] = y;
    y += heights[i]! + BOARD;
  }
  const top = y - BOARD;

  const slots: ProductSlot[] = [];
  rows.forEach((row, i) => {
    const run = row.reduce((sum, p) => sum + faceOut(measureOf(p)).across, 0) + GAP * (row.length - 1);
    let x = SCENARIO_CASE.x - run / 2;
    for (const product of row) {
      const size = measureOf(product);
      const foot = faceOut(size);
      const at = new THREE.Vector3(x + foot.across / 2, floors[i]! + foot.tall / 2, back + 0.15 + foot.deep / 2);
      slots.push({ product, size, foot, at });
      x += foot.across + GAP;
    }
  });
  return { slots, floors, top, bottom };
}
