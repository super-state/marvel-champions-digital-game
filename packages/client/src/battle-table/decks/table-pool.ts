/**
 * What the deck builder offers at the room's bench: only cards the 3D table has been checked with (room plan, "Deck
 * building"). The heroes come from the table's own list (`HEROES` in `model.ts`, read by `room/places/decks.ts`); the
 * aspects are this one short list, which each hero task adds to when its aspect's cards have been played on the table.
 * The builder's own page (`battle/decks.html`) keeps the whole Core Set pool, for checking.
 */
import type { CoreAspect } from "@mc/content";

/**
 * The aspects whose cards have been checked on the 3D table. Justice came with Spider-Man and Leadership with Captain
 * Marvel; Aggression arrives with She-Hulk and Protection with Black Panther (their tasks add them here).
 */
export const TABLE_ASPECTS: readonly CoreAspect[] = ["justice", "leadership"];
