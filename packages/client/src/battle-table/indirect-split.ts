import type { BattleChoice } from "./model.js";

/**
 * Dividing indirect damage (RRG 1.8 "Indirect Damage", p. 24: Green Goblin's "Deal 3 indirect damage to each player",
 * Pumpkin Bombs' "take 2 indirect damage"). The engine offers each character once per hit point it can still lose
 * (`<card>#1`, `<card>#2`, ...) and wants exactly `amount` picks. On the table the player clicks a character to put
 * 1 more damage on it; a click on one that can take no more (it is at its limit, or all the damage is placed) takes
 * its damage back off. Each character wears the damage placed on it so far.
 */
type Split = Pick<BattleChoice, "options" | "indirect">;

/** The damage placed on each character so far, by card. */
export function indirectShares(choice: Split | null | undefined, picks: Iterable<string>): Map<string, number> {
  const shares = new Map<string, number>();
  if (!choice?.indirect) return shares;
  for (const id of picks) {
    const cardId = choice.options.find((option) => option.id === id)?.cardId;
    if (cardId) shares.set(cardId, (shares.get(cardId) ?? 0) + 1);
  }
  return shares;
}

/**
 * A click on a character while damage is being divided: the picks after it, and what it did ("add" 1 damage, "clear"
 * this character's damage, or "none" when the card takes no damage here).
 */
export function indirectClick(
  choice: Split,
  picks: ReadonlySet<string>,
  cardId: string,
): { picks: Set<string>; did: "add" | "clear" | "none" } {
  const amount = choice.indirect?.amount ?? 0;
  const own = choice.options.filter((option) => option.cardId === cardId);
  const next = new Set(picks);
  const free = own.find((option) => !picks.has(option.id));
  if (free && picks.size < amount) {
    next.add(free.id);
    return { picks: next, did: "add" };
  }
  const placed = own.filter((option) => picks.has(option.id));
  if (!placed.length) return { picks: next, did: "none" };
  for (const option of placed) next.delete(option.id);
  return { picks: next, did: "clear" };
}
