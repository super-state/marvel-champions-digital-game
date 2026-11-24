import type { BattleChoice } from "./model.js";

/**
 * Where each picked option stands in an ordered question ("Order the enemies", "Order these effects"): 1 for the first
 * pick, 2 for the next, in the order they were picked. The picks go to the engine in that same order (`chooseMany`), so
 * the numbers on the cards are the order things happen in. Unpicking one closes the gap: the picks after it move up.
 * A question that doesn't order anything (a mulligan, "choose up to two") has no numbers.
 */
export function pickOrder(
  choice: Pick<BattleChoice, "ordered" | "options"> | null | undefined,
  picks: Iterable<string>,
): Map<string, number> {
  const order = new Map<string, number>();
  if (!choice?.ordered) return order;
  for (const id of picks) if (choice.options.some((option) => option.id === id)) order.set(id, order.size + 1);
  return order;
}

/**
 * The same places by card, for the numbers worn on the table. Only a card that is one option of the question wears
 * one: a card the question asks about more than once (a minion's Quickstrike and Teamwork, a treachery's When Revealed
 * and Surge) can't say which of its picks a single number means, so those are numbered in the turn bar's list instead.
 */
export function cardPlaces(
  choice: Pick<BattleChoice, "ordered" | "options"> | null | undefined,
  picks: Iterable<string>,
): Map<string, number> {
  const places = new Map<string, number>();
  if (!choice) return places;
  const optionsOf = new Map<string, number>();
  for (const option of choice.options)
    if (option.cardId) optionsOf.set(option.cardId, (optionsOf.get(option.cardId) ?? 0) + 1);
  for (const [id, place] of pickOrder(choice, picks)) {
    const cardId = choice.options.find((option) => option.id === id)?.cardId;
    if (cardId && optionsOf.get(cardId) === 1) places.set(cardId, place);
  }
  return places;
}
