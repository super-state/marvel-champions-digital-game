/**
 * What the search panel says over the cards found in a deck: the one thing to do, short and bold ("Choose a Masters
 * of Evil minion"), and at most one plain line on what happens to the card ("It comes into play engaged with you.").
 * The searching, the piles searched and the shuffle after are the game's work, not the player's, so they are left out
 * (Adam, 2026-11-25: "They don't need to search encounter or discard. That's not relevant").
 *
 * `prompt` is the question as the model words it, often the card's own sentence ("Search the encounter deck and
 * discard pile for a Masters of Evil minion and put it into play engaged with you, then shuffle the encounter deck").
 */
export function searchQuestion(prompt: string, max: number): { title: string; help: string | null } {
  const text = prompt.replace(/\s+/g, " ").trim();
  const search = /^search\b.+? for (an? |up to \w+ |\d+ )?(.+?)(?: and (.+?))?(?:,? then .+)?\.?$/i.exec(text);
  if (search) {
    const what = search[2]!.trim();
    const count = search[1]?.trim().toLowerCase() ?? "";
    // "a"/"an" fitted to the words; "up to 2", "3" kept; a card named without one ("for Defense Network") as it is.
    const article = /^an?$/.test(count) ? (/^[aeiou]/i.test(what) ? "an " : "a ") : count ? `${count} ` : "";
    return { title: `Choose ${article}${what}`, help: search[3] ? afterwards(search[3].trim()) : null };
  }
  // Anything else short enough to read at a glance stays as it is; a long sentence becomes the plain ask.
  if (text.length <= 48) return { title: text, help: null };
  return { title: max > 1 ? "Choose cards" : "Choose a card", help: null };
}

/** "put it into play engaged with you" → "It comes into play engaged with you." */
function afterwards(rest: string): string {
  const into = /^put (?:it|them) into play(.*)$/i.exec(rest);
  if (into) return `It comes into play${into[1]}.`;
  if (/^add (?:it|them) to your hand$/i.test(rest)) return "It goes into your hand.";
  if (/^reveal (?:it|them)$/i.test(rest)) return "It is revealed.";
  const attach = /^attach (?:it|them) to (.+)$/i.exec(rest);
  if (attach) return `It is attached to ${attach[1]}.`;
  return `${rest[0]!.toUpperCase()}${rest.slice(1)}.`;
}
