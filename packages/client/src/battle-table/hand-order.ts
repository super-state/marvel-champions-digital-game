/**
 * The player's own order for the hand: drag a card along the hand and let go low to file it in a new slot, the way a
 * hand is tidied in Magic Arena (a friend's ask, 2026-11-25). It is only how the hand is shown: the engine's hand
 * order never changes, and nothing in the rules reads it.
 */

interface Identified {
  readonly id: string;
}

/**
 * The hand as it arrives, put in the player's order: the cards the player has already arranged keep their order among
 * themselves, filling the slots those cards have in the arriving hand; a card new to the hand (drawn, returned) stays
 * where the game put it. With no order of the player's yet, the hand is unchanged.
 */
export function arrangeHand<T extends Identified>(hand: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const known = hand.filter((card) => rank.has(card.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  let next = 0;
  return hand.map((card) => (rank.has(card.id) ? known[next++]! : card));
}

/** The hand with the card `id` taken out and put back at `slot` (0 is the left end). */
export function moveInHand<T extends Identified>(hand: readonly T[], id: string, slot: number): T[] {
  const card = hand.find((item) => item.id === id);
  if (!card) return [...hand];
  const rest = hand.filter((item) => item.id !== id);
  rest.splice(Math.max(0, Math.min(slot, rest.length)), 0, card);
  return rest;
}

/** Where the hand's slots stand on screen: the middle slot's x, the slot count and the step between slots (pixels). */
export interface HandSlots {
  readonly center: number;
  readonly count: number;
  readonly step: number;
}

/** The slot nearest the pointer's x: past either end, the end slot. */
export function slotAt(x: number, slots: HandSlots): number {
  if (slots.count <= 1 || slots.step <= 0) return 0;
  const slot = Math.round((x - slots.center) / slots.step + (slots.count - 1) / 2);
  return Math.max(0, Math.min(slots.count - 1, slot));
}
