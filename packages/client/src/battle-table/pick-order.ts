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
