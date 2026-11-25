/**
 * What the deck builder offers at the room's bench: only cards the 3D table has been checked with (room plan, "Deck
 * building"). The heroes come from the table's own list (`HEROES` in `model.ts`, read by `room/places/decks.ts`); the
 * aspects are this one short list, which each hero task adds to when its aspect's cards have been played on the table.
 * The builder's own page (`battle/decks.html`) keeps the whole Core Set pool, for checking.
 */
import type { CoreAspect } from "@mc/content";

/**
 * The aspects whose cards have been checked on the 3D table: Justice came with Spider-Man, Leadership with Captain
 * Marvel, Aggression with She-Hulk (`deck-audit-aggression.test.ts`) and Protection with Black Panther
 * (`deck-audit-protection.test.ts`): every aspect of the Core Set.
 */
export const TABLE_ASPECTS: readonly CoreAspect[] = ["aggression", "justice", "leadership", "protection"];
