/**
 * Which deck each hero plays: their starter deck, or one of their saved decks, chosen at the bench or in Free Play's
 * deck slot and remembered on this device (`battle-deck:<hero>`, beside `battle-hero`, the chosen hero). A choice
 * whose deck has since been deleted reads as the starter deck.
 */
import type { DeckStorage } from "./deck-store.js";

export const STARTER = "starter";

const keyOf = (hero: string): string => `battle-deck:${hero}`;

function safeStorage(): DeckStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The chosen deck for a hero (the table's hero id): `STARTER` or a saved deck's id. */
export function chosenDeck(hero: string, storage: DeckStorage | null = safeStorage()): string {
  try {
    return storage?.getItem(keyOf(hero)) || STARTER;
  } catch {
    return STARTER;
  }
}

export function chooseDeck(hero: string, deck: string, storage: DeckStorage | null = safeStorage()): void {
  try {
    storage?.setItem(keyOf(hero), deck);
  } catch {
    // A private window: the choice lasts this visit only as long as the screen remembers it.
  }
}
