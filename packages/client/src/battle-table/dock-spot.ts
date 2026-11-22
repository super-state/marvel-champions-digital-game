/** Sizes in the playfield's pixels, for `dockSpot`. */
export interface DockSpotInput {
  /** The playfield the bar floats in. */
  readonly field: { readonly width: number; readonly height: number };
  /** The table's stage, placed within the playfield (it scrolls on a small screen). */
  readonly stage: { readonly left: number; readonly top: number; readonly width: number };
  /** The bar's own layout size. */
  readonly bar: { readonly width: number; readonly height: number };
  /** The top of the hand in stage pixels, a hovered card's small lift included (`BattleTable.handTop.resting`). */
  readonly handTop: number;
  /** The bottom of a card standing just above the bar (a revealed encounter card), in stage pixels, to keep clear of. */
  readonly below?: number | undefined;
}

/**
 * Where the turn bar floats on a wider screen: centred across the table, just above the hand, never up by the
 * villain. The table makes room for it there while it shows (`BattleTable.setQuestion`), and hand cards only lift a
 * small step under it, so nothing in the hand ever comes up over the buttons.
 */
export function dockSpot(input: DockSpotInput): { left: number; top: number } {
  const { field, stage, bar } = input;
  // Kept on the playfield; a bar wider than the playfield starts at its left edge.
  const left = Math.max(8, Math.min(stage.left + stage.width / 2 - bar.width / 2, field.width - bar.width - 8));
  let top = stage.top + input.handTop - bar.height - 12;
  // Clear of a card standing above it, as far down as the top of the hand allows.
  if (input.below !== undefined)
    top = Math.max(top, Math.min(stage.top + input.below + 18, stage.top + input.handTop - bar.height));
  top = Math.min(Math.max(8, top), field.height - bar.height - 8);
  return { left, top };
}

/**
 * Where a hovered table card's full-size picture goes: right beside the card, on its right, or on its left when the
 * right has no room, level with the card's middle and always on the playfield, so the player can always see what
 * they are pointing at. `field.left` narrows the room from the left (a card pinned on that side).
 */
export function besideSpot(
  card: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  size: { readonly width: number; readonly height: number },
  field: { readonly left?: number; readonly width: number; readonly height: number },
  prefer: "right" | "left" = "right",
): { left: number; top: number } {
  const start = field.left ?? 0;
  const end = start + field.width;
  const gap = 64;
  const onLeft = card.left - gap - size.width;
  let left = card.right + gap;
  if (prefer === "left" && onLeft >= start + 8) left = onLeft;
  else if (left + size.width > end - 8) left = onLeft;
  left = Math.max(start + 8, Math.min(left, end - size.width - 8));
  const top = Math.max(8, Math.min((card.top + card.bottom) / 2 - size.height / 2, field.height - size.height - 8));
  return { left, top };
}

/** A card's box on screen, in the table's pixels. */
export interface ScreenBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where a revealed card held up in the middle stands while its own question asks the player to pick cards on the
 * table (Caught Off Guard: "Discard an upgrade or support you control"). Adam, 2026-11-21: the card stood over the very
 * supports it asked for, so nothing could be seen or picked. Covering none of them, it stays put. Otherwise it slides
 * sideways, level with where it was, just far enough to clear them, into the gap between them (or beside them) nearest
 * to it; with no gap wide enough (a phone) it takes the widest one and shrinks to fit, never below half its size.
 * `x` is its new centre, `scale` its size against the old.
 */
export function revealAside(
  card: ScreenBox,
  picks: readonly ScreenBox[],
  width: number,
  margin = 16,
): { x: number; scale: number } {
  const x = (card.left + card.right) / 2;
  const size = card.right - card.left;
  // Only the picks level with the card can be covered by it, wherever it slides.
  const level = picks
    .filter((pick) => pick.bottom > card.top - margin && pick.top < card.bottom + margin)
    .map((pick) => [pick.left - margin, pick.right + margin] as const)
    .sort((a, b) => a[0] - b[0]);
  if (!level.some(([left, right]) => right > card.left && left < card.right)) return { x, scale: 1 };
  // The open stretches of the screen between and beside the picks.
  const gaps: [number, number][] = [];
  let from = margin;
  for (const [left, right] of level) {
    if (left > from) gaps.push([from, left]);
    from = Math.max(from, right);
  }
  if (width - margin > from) gaps.push([from, width - margin]);
  const fitting = gaps
    .filter(([start, end]) => end - start >= size)
    .map(([start, end]) => Math.min(Math.max(x, start + size / 2), end - size / 2))
    .sort((a, b) => Math.abs(a - x) - Math.abs(b - x));
  if (fitting.length) return { x: fitting[0]!, scale: 1 };
  const widest = gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0];
  if (!widest) return { x, scale: 0.5 };
  return { x: (widest[0] + widest[1]) / 2, scale: Math.max(0.5, (widest[1] - widest[0]) / size) };
}
