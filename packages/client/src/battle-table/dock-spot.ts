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
): { left: number; top: number } {
  const start = field.left ?? 0;
  const end = start + field.width;
  const gap = 64;
  let left = card.right + gap;
  if (left + size.width > end - 8) left = card.left - gap - size.width;
  left = Math.max(start + 8, Math.min(left, end - size.width - 8));
  const top = Math.max(8, Math.min((card.top + card.bottom) / 2 - size.height / 2, field.height - size.height - 8));
  return { left, top };
}
