import type { BattleCard, BattleSnapshot } from "./model.js";

type Beat = BattleSnapshot["beats"][number];

/**
 * The hand to show once a beat has played out, while the rest of the beats are still to come: the final hand, less the
 * cards a later beat brings in (drawn or returned), plus the cards still showing that a later beat discards. Cards
 * that left some other way (the card just paid for, the resources spent on it) are gone, so their slots don't
 * reopen. Cards keep the order they show in.
 */
export function handBetweenBeats(
  showing: readonly BattleCard[],
  finalHand: readonly BattleCard[],
  later: readonly Beat[],
  staged: string | null,
): BattleCard[] {
  const arriving = new Set(later.flatMap((beat) => [...(beat.draw ?? []), ...(beat.returned ?? [])]));
  const leaving = new Set(later.flatMap((beat) => beat.handDiscard ?? []));
  const held = finalHand.filter((card) => !arriving.has(card.id) && card.id !== staged);
  const heldIds = new Set(held.map((card) => card.id));
  const kept = showing.filter((card) => heldIds.has(card.id) || leaving.has(card.id));
  const keptIds = new Set(kept.map((card) => card.id));
  // Arrivals go where the final hand has them: a drawn card on the left (the model puts the newest first), so it
  // doesn't land on the right and jump across when the beats end; one the final hand files later on the right.
  const firstKept = held.findIndex((card) => keptIds.has(card.id));
  const arrivals = held.filter((card) => !keptIds.has(card.id));
  const before = arrivals.filter((card) => firstKept < 0 || held.indexOf(card) < firstKept);
  return [...before, ...kept, ...arrivals.filter((card) => !before.includes(card))];
}
