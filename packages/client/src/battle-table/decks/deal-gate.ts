/**
 * Whether a saved deck can be dealt on the 3D table now, and if not, why, in a few plain words. The one gate between a
 * saved deck and the deal: the bench and Free Play's deck slot show every saved deck, and only one that passes here
 * goes to the deal (`DealOptions.deck` in `model.ts`, then `coreScenario`, which would refuse an illegal one).
 *
 * The rules are the engine's (`legalityOf`, which is `validateDeck`); the only thing decided here is what the table
 * has been checked with (`TABLE_ASPECTS`).
 */
import type { CoreAspect } from "@mc/content";
import { ASPECT_NAMES, isBuilderHero, legalityOf } from "./deck-model.js";
import type { SavedDeck } from "./deck-store.js";
import { TABLE_ASPECTS } from "./table-pool.js";

/** A deck as the deal takes it (the shape of `BuiltDeck` in `model.ts`): one card id per copy. */
export interface DealableDeck {
  readonly id: string;
  readonly name: string;
  readonly identityCardId: string;
  readonly aspects: readonly CoreAspect[];
  readonly cards: readonly string[];
}

export type DealVerdict =
  | { readonly ok: true; readonly deck: DealableDeck }
  | { readonly ok: false; readonly reason: string };

export function dealVerdict(saved: SavedDeck, aspects: readonly CoreAspect[] = TABLE_ASPECTS): DealVerdict {
  if (!isBuilderHero(saved.identityCardId)) return { ok: false, reason: "This deck's hero isn't on the 3D table yet." };
  const closed = saved.aspects.find((aspect) => !aspects.includes(aspect));
  if (closed) return { ok: false, reason: `${ASPECT_NAMES[closed]} cards aren't on the 3D table yet.` };
  const legality = legalityOf(saved);
  if (!legality.legal) return { ok: false, reason: `Not legal yet: ${legality.line}` };
  return {
    ok: true,
    deck: {
      id: saved.id,
      name: saved.name,
      identityCardId: saved.identityCardId,
      aspects: saved.aspects,
      cards: saved.cards.flatMap((line) => Array.from({ length: line.quantity }, () => line.cardId as string)),
    },
  };
}
