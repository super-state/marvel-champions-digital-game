/**
 * The questions a reaction window asks, one card at a time ("Interrupt with Backflip?"), are asked once per card name,
 * whatever the card says: holding two copies of a card never puts the same question up twice in a row.
 *
 * - A no to one copy is a no to every copy in this window.
 * - A yes plays one copy. Whether a second copy could still do anything once it has resolved is the engine's call, not
 *   read from the card's words: it offers the window again with whatever is still worth playing (a second "reduce by
 *   1" is; a second Backflip after "prevent all of that damage", or a second Enhanced Spider-Sense once the treachery's
 *   "When Revealed" is cancelled, is not), and that new round asks about that card again.
 *
 * Returns the index of the next offer to ask about after the one at `index`: the first later offer whose card name has
 * not come up yet this round, or `names.length` when there is none.
 */
export function nextOfferIndex(names: readonly string[], index: number): number {
  const asked = new Set(names.slice(0, index + 1));
  let next = index + 1;
  while (next < names.length && asked.has(names[next]!)) next++;
  return next;
}
