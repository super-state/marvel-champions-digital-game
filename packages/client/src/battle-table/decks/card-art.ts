/**
 * The front scan of a Core Set card, as the dev server's `/card-art/` route serves it (`vite-card-art.ts`). The deck
 * builder's own few lines for the one face it shows, rather than an import of the old game's `art/art-source.ts`:
 * no promos, no other languages and no custom packs here, only the printed English front.
 */
import type { AnyCard } from "@mc/content";

export const CARD_ART_ROUTE = "/card-art/";

export function cardArtUrl(card: AnyCard): string {
  const local = "art" in card && typeof card.art === "string" ? `${card.art}.png` : undefined;
  const front = card.type === "hero_identity" ? (card.hero.image ?? card.images?.front) : card.images?.front;
  const path = String(local ?? front ?? "").replace(/^\/+/, "");
  return path ? `${CARD_ART_ROUTE}${path}` : "";
}

/** The shared player card back, shown while a scan loads or when it fails. */
export const PLAYER_BACK_URL = `${CARD_ART_ROUTE}bundles/cards/marvel-player-back.webp`;
