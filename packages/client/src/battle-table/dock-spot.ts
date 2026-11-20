/** Sizes in the playfield's pixels, for `dockSpot`. */
export interface DockSpotInput {
  /** The playfield the bar floats in. */
  readonly field: { readonly width: number; readonly height: number };
  /** The table's stage, placed within the playfield (it scrolls on a small screen). */
  readonly stage: { readonly left: number; readonly top: number; readonly width: number };
  /** The bar's own layout size. */
  readonly bar: { readonly width: number; readonly height: number };
  /** The top of the hand, in stage pixels (`BattleTable.handTop`). */
  readonly hand: { readonly resting: number; readonly hovered: number | null };
  /** The bar asks something (a payment, a reaction, a card to pick), rather than telling what is happening. */
  readonly asking: boolean;
  /** The answer is in the hand (paying, a mulligan, the hand limit): the hand is raised whole and stays in view. */
  readonly aboutHand: boolean;
  /** The hand stands whole above the turn corners (a narrow table), so there is no strip along the bottom. */
  readonly handOverCorner: boolean;
  /** Widths the bottom corners keep: Undo on the left, End Turn on the right, each with its inset and a gap. */
  readonly corners: { readonly left: number; readonly right: number };
}

/**
 * Where the turn bar floats on a wider screen: always centred across the table and low down by the hand, never up
 * by the villain. A question answered from the hand (paying, a mulligan, the hand limit) floats just above the hand,
 * which is raised whole while the table makes room, so every card that could answer stays in view. Anything else (a
 * reaction, a defence, what the villain is doing) sits over the hand: along the bottom, level with the corners, or
 * over the top of the hand where that strip would run into a corner. A hand card lifted to be read goes in front of
 * the bar: `ducked`.
 */
export function dockSpot(input: DockSpotInput): { left: number; top: number; ducked: boolean } {
  const { field, stage, bar, hand, corners } = input;
  // Kept on the playfield; a bar wider than the playfield starts at its left edge.
  const left = Math.max(8, Math.min(stage.left + stage.width / 2 - bar.width / 2, field.width - bar.width - 8));
  const clearOfCorners = left >= corners.left && left + bar.width <= field.width - corners.right;
  const spot =
    input.asking && input.aboutHand
      ? stage.top + hand.resting - bar.height - 12
      : clearOfCorners && !input.handOverCorner
        ? field.height - bar.height - 16
        : stage.top + hand.resting + 10;
  const top = Math.min(Math.max(8, spot), field.height - bar.height - 8);
  const ducked = hand.hovered !== null && stage.top + hand.hovered < top + bar.height;
  return { left, top, ducked };
}

/**
 * Where a hovered table card's full-size picture goes: right beside the card, on its right, or on its left when the
 * right has no room, level with the card's middle and always on the playfield, so the player can always see what
 * they are pointing at.
 */
export function besideSpot(
  card: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  size: { readonly width: number; readonly height: number },
  field: { readonly width: number; readonly height: number },
): { left: number; top: number } {
  const gap = 28;
  let left = card.right + gap;
  if (left + size.width > field.width - 8) left = card.left - gap - size.width;
  left = Math.max(8, Math.min(left, field.width - size.width - 8));
  const top = Math.max(8, Math.min((card.top + card.bottom) / 2 - size.height / 2, field.height - size.height - 8));
  return { left, top };
}
