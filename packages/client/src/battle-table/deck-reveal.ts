/**
 * Effects that turn up the top of the player's deck and keep the matching cards for the hand (Black Cat's printed
 * [mental] resource, Nova's Aggression cards, SP//dr's SP//dr cards) say so on the table when none of the cards
 * matched, so the empty hand reads as the effect finding nothing, not as it being skipped.
 *
 * `rulesText` is the plain rules text of the card whose ability did the discarding (brackets already dropped:
 * "printed mental resource"). Null for a discard that keeps nothing by design (nothing to say when it keeps nothing).
 */
export function missLineOf(rulesText: string): string | null {
  const text = rulesText.replace(/\s+/g, " ");
  if (!/\bdiscard the top\b/i.test(text) || !/\bto your hand\b/i.test(text)) return null;
  const resource = /\bprinted (\w+) resource/i.exec(text);
  if (resource) return `No ${resource[1]!.toLowerCase()} resources`;
  const kind = /\badd each (.+?) cards? discarded this way\b/i.exec(text);
  if (kind) return `No ${kind[1]!.replace(/\s*\([^)]*\)/g, "").trim()} cards`;
  return "Nothing to add to your hand";
}
