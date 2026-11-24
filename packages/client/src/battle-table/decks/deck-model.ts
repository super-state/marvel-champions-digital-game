/**
 * The deck builder's model (room plan step 0.9.0, `docs/project/room-plan.md` "Deck building"): the Core Set pool, a
 * hero, one aspect, copies in and out, and what the engine says about the result. Pure and DOM-free, so the screen
 * (`decks-page.ts`) only draws what this returns.
 *
 * The builder never decides a rule itself. Whether a card may go in is `cardOfferedToDeck` (the aspect, the identity
 * set) and `copiesUpToLimit` (three by title, a card's own "Max X per deck", one of a unique card); whether the deck is
 * legal is `validateDeck`, and its first problem is the line the screen shows, word for word. There is no 50-card stop
 * here: a 51st card goes in and the engine says the deck is too big.
 *
 * A draft is the engine's own `DeckContents` (identity, chosen aspects, card lines with quantities, the hero's own
 * cards included), so it goes to `validateDeck` untouched and is what the saved-deck store keeps.
 */
import { CORE_CARDS, CORE_STARTER_DECKS } from "@mc/content";
import type {
  AnyCard,
  CardId,
  CoreAspect,
  DeckCardEntry,
  DeckContents,
  HeroIdentityCard,
  PlayerCard,
} from "@mc/content";
import {
  CHOOSABLE_ASPECTS,
  DECK_MAX_CARDS,
  DECK_MIN_CARDS,
  cardOfferedToDeck,
  copiesUpToLimit,
  printedResources,
  requiredIdentitySet,
  uniqueLabel,
  validateDeck,
  type DeckProblem,
} from "@mc/engine";
import type { CorePlayer } from "@mc/cards";

export { DECK_MAX_CARDS, DECK_MIN_CARDS };

/** The card pool the builder offers: the Core Set only, for now (room plan 0.9.0). */
export const BUILDER_POOL: readonly AnyCard[] = CORE_CARDS;

const byId = new Map<string, AnyCard>(BUILDER_POOL.map((card) => [card.id as string, card]));

export const cardById = (cardId: string): AnyCard | undefined => byId.get(cardId);

/** RRG 1.8 "Player Deck" (p. 33) card types, in the order the tray lists them. */
export const DECK_KINDS = ["ally", "event", "support", "upgrade", "resource"] as const;
export type DeckKind = (typeof DECK_KINDS)[number];
export const KIND_NAMES: Readonly<Record<DeckKind, string>> = {
  ally: "Allies",
  event: "Events",
  support: "Supports",
  upgrade: "Upgrades",
  resource: "Resources",
};

export const ASPECT_NAMES: Readonly<Record<CoreAspect, string>> = {
  aggression: "Aggression",
  justice: "Justice",
  leadership: "Leadership",
  protection: "Protection",
  pool: "'Pool",
  basic: "Basic",
};

const isDeckCard = (card: AnyCard | undefined): card is PlayerCard =>
  card !== undefined && (DECK_KINDS as readonly string[]).includes(card.type);

/**
 * The aspects a deck here can choose: the engine's choosable aspects that the pool has cards of. 'Pool is choosable by
 * the rules but has no Core Set cards, so it is not offered.
 */
export const BUILDER_ASPECTS: readonly CoreAspect[] = CHOOSABLE_ASPECTS.filter((aspect) =>
  BUILDER_POOL.some((card) => isDeckCard(card) && card.aspect === aspect),
);

export interface HeroChoice {
  readonly identityCardId: string;
  /** The hero face's name ("Spider-Man"). */
  readonly name: string;
  readonly alterEgo: string;
  readonly starterDeckId: string;
  readonly starterAspect: CoreAspect;
  readonly identity: HeroIdentityCard;
}

/** The pool's heroes, each with their starter deck, in the order the Core Set numbers them. */
export const BUILDER_HEROES: readonly HeroChoice[] = BUILDER_POOL.filter(
  (card): card is HeroIdentityCard => card.type === "hero_identity",
)
  .flatMap((identity) => {
    // Captain Marvel also has the Learn to Play tutorial deck (Aggression); her starter is the Leadership one.
    const starter = CORE_STARTER_DECKS.find(
      (deck) => deck.identityCardId === identity.id && !(deck.id as string).endsWith("-tutorial"),
    );
    if (!starter || starter.aspects.length !== 1) return [];
    return [
      {
        identityCardId: identity.id as string,
        name: identity.hero.faceName,
        alterEgo: identity.alterEgo.faceName,
        starterDeckId: starter.id as string,
        starterAspect: starter.aspects[0]!,
        identity,
      },
    ];
  })
  .sort((a, b) => a.identityCardId.localeCompare(b.identityCardId));

export function heroOf(identityCardId: string): HeroChoice {
  const hero = BUILDER_HEROES.find((h) => h.identityCardId === identityCardId);
  if (!hero) throw new Error(`no hero ${identityCardId} in the builder's pool`);
  return hero;
}

export type Draft = DeckContents;

/** The hero's starter deck, exactly as printed. */
export function starterDraft(identityCardId: string): Draft {
  const hero = heroOf(identityCardId);
  const starter = CORE_STARTER_DECKS.find((deck) => deck.id === hero.starterDeckId)!;
  return { identityCardId: starter.identityCardId, aspects: [...starter.aspects], cards: sortLines(starter.cards) };
}

/** Just the hero's own cards, at their set quantities (`requiredIdentitySet`), with no aspect chosen yet. */
export function ownCardsDraft(identityCardId: string): Draft {
  const hero = heroOf(identityCardId);
  return {
    identityCardId: hero.identity.id,
    aspects: [],
    cards: sortLines(requiredIdentitySet(hero.identity, BUILDER_POOL)),
  };
}

const sortLines = (lines: readonly DeckCardEntry[]): readonly DeckCardEntry[] =>
  [...lines].sort((a, b) => (a.cardId as string).localeCompare(b.cardId as string));

export const quantityOf = (draft: Draft, cardId: string): number =>
  draft.cards.find((line) => line.cardId === cardId)?.quantity ?? 0;

/** Whether a card is one of the hero's own (identity set): shown in the binder, fixed in the deck. */
export function isOwnCard(draft: Draft, card: AnyCard): boolean {
  return isDeckCard(card) && card.aspect === `hero:${draft.identityCardId}`;
}

/** How many more copies of `cardId` the engine lets this deck take: 0 when it may not go in at all. */
export function copiesLeft(draft: Draft, cardId: string): number {
  const card = byId.get(cardId);
  const hero = heroOf(draft.identityCardId);
  if (!card || isOwnCard(draft, card)) return 0;
  if (!cardOfferedToDeck(card, hero.identity, draft.aspects).offered) return 0;
  return copiesUpToLimit(draft.cards, cardId, hero.identity, BUILDER_POOL);
}

/** One more copy, when the engine allows it; otherwise the same draft back. */
export function addCopy(draft: Draft, cardId: string): Draft {
  if (copiesLeft(draft, cardId) <= 0) return draft;
  const held = quantityOf(draft, cardId);
  const cards =
    held === 0
      ? sortLines([...draft.cards, { cardId: cardId as CardId, quantity: 1 }])
      : draft.cards.map((line) => (line.cardId === cardId ? { ...line, quantity: line.quantity + 1 } : line));
  return { ...draft, cards };
}

/** One copy out; the hero's own cards stay (the identity set is fixed, RRG 1.8 Appendix I p. 50). */
export function removeCopy(draft: Draft, cardId: string): Draft {
  // A line whose card is not in the pool (a deck saved from a bigger pool) can be taken out, so the deck can be fixed.
  const card = byId.get(cardId);
  if ((card && isOwnCard(draft, card)) || quantityOf(draft, cardId) === 0) return draft;
  const cards = draft.cards
    .map((line) => (line.cardId === cardId ? { ...line, quantity: line.quantity - 1 } : line))
    .filter((line) => line.quantity > 0);
  return { ...draft, cards };
}

export function canRemove(draft: Draft, cardId: string): boolean {
  const card = byId.get(cardId);
  return !(card && isOwnCard(draft, card)) && quantityOf(draft, cardId) > 0;
}

/** Whether the builder can open a deck for this identity: one of the pool's heroes. */
export const isBuilderHero = (identityCardId: string): boolean =>
  BUILDER_HEROES.some((hero) => hero.identityCardId === identityCardId);

/**
 * Choose the deck's one aspect. Whatever the engine no longer offers under it (the old aspect's cards) comes out, and
 * `removed` says how many copies went, so the screen can say so.
 */
export function chooseAspect(draft: Draft, aspect: CoreAspect): { readonly draft: Draft; readonly removed: number } {
  // Only an aspect the builder offers: Basic is not an aspect, and 'Pool has no cards here.
  if (!BUILDER_ASPECTS.includes(aspect)) return { draft, removed: 0 };
  if (draft.aspects.length === 1 && draft.aspects[0] === aspect) return { draft, removed: 0 };
  const hero = heroOf(draft.identityCardId);
  const aspects = [aspect];
  let removed = 0;
  const cards = draft.cards.filter((line) => {
    const card = byId.get(line.cardId);
    const keep = card !== undefined && cardOfferedToDeck(card, hero.identity, aspects).offered;
    if (!keep) removed += line.quantity;
    return keep;
  });
  return { draft: { ...draft, aspects, cards }, removed };
}

export type BinderTab = "hero" | "aspect" | "basic";
export const BINDER_TABS: readonly BinderTab[] = ["hero", "aspect", "basic"];

export interface BinderCard {
  readonly cardId: string;
  readonly card: PlayerCard;
  readonly name: string;
  /** Copies of this card in the deck now. */
  readonly inDeck: number;
  /** One of the hero's own cards: shown, never added or taken out. */
  readonly fixed: boolean;
  readonly canAdd: boolean;
  readonly canRemove: boolean;
}

/**
 * The cards on one tab of the binder. The aspect tab shows `aspect` (the deck's chosen aspect, or the one being looked
 * at before choosing); with neither it is empty. Each card says whether the engine lets one more copy in.
 */
export function binderPage(draft: Draft, tab: BinderTab, aspect?: CoreAspect): readonly BinderCard[] {
  const shown = (card: PlayerCard): boolean => {
    if (tab === "hero") return isOwnCard(draft, card);
    if (tab === "basic") return card.aspect === "basic";
    const wanted = aspect ?? draft.aspects[0];
    return wanted !== undefined && card.aspect === wanted;
  };
  const cards = BUILDER_POOL.filter(isDeckCard).filter(shown);
  return cards
    .sort((a, b) => kindOrder(a) - kindOrder(b) || costOf(a) - costOf(b) || a.name.localeCompare(b.name))
    .map((card) => {
      const cardId = card.id as string;
      const fixed = tab === "hero";
      return {
        cardId,
        card,
        name: uniqueLabel(card),
        inDeck: quantityOf(draft, cardId),
        fixed,
        canAdd: !fixed && copiesLeft(draft, cardId) > 0,
        canRemove: !fixed && canRemove(draft, cardId),
      };
    });
}

const kindOrder = (card: AnyCard): number => (DECK_KINDS as readonly string[]).indexOf(card.type);

/** The printed cost, or -1 for a card with none (resources). X costs are not in the Core Set. */
export const costOf = (card: AnyCard): number => ("cost" in card && typeof card.cost === "number" ? card.cost : -1);

export interface Legality {
  readonly legal: boolean;
  /** The line along the bottom of the screen: the engine's own words for the first thing to fix, or that it is legal. */
  readonly line: string;
  /** How many more problems the engine found after the first. */
  readonly more: number;
  readonly problems: readonly DeckProblem[];
}

/** What the engine says about the deck, as the one line the screen shows. */
export function legalityOf(draft: Draft): Legality {
  const verdict = validateDeck(draft, BUILDER_POOL);
  if (verdict.ok) {
    return { legal: true, line: `Legal deck: ${cardCount(draft)} cards.`, more: 0, problems: [] };
  }
  const [first, ...rest] = verdict.problems;
  return { legal: false, line: first!.message, more: rest.length, problems: verdict.problems };
}

/** Cards in the deck (every card in the Core Set counts toward deck size: none is permanent). */
export const cardCount = (draft: Draft): number => draft.cards.reduce((n, line) => n + line.quantity, 0);

export interface TrayLine {
  readonly cardId: string;
  readonly name: string;
  readonly quantity: number;
  readonly fixed: boolean;
  readonly cost: number;
}

export interface TrayGroup {
  readonly kind: DeckKind;
  readonly name: string;
  readonly count: number;
  readonly lines: readonly TrayLine[];
}

/** The deck grouped by kind, with a count each, for the tray. Empty kinds are left out. */
export function trayGroups(draft: Draft): readonly TrayGroup[] {
  return DECK_KINDS.flatMap((kind) => {
    const lines = draft.cards
      .map((line) => ({ line, card: byId.get(line.cardId) }))
      .filter((entry): entry is { line: DeckCardEntry; card: PlayerCard } => entry.card?.type === kind)
      .map(({ line, card }) => ({
        cardId: line.cardId as string,
        name: uniqueLabel(card),
        quantity: line.quantity,
        fixed: isOwnCard(draft, card),
        cost: costOf(card),
      }))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    if (lines.length === 0) return [];
    return [{ kind, name: KIND_NAMES[kind], count: lines.reduce((n, l) => n + l.quantity, 0), lines }];
  });
}

/** Cost buckets for the chart: 0, 1, 2, 3, 4 and 5+ (resources, which have no cost, are not in it). */
export const COST_BUCKETS = ["0", "1", "2", "3", "4", "5+"] as const;

export interface DeckChart {
  /** Copies at each cost, in `COST_BUCKETS` order. */
  readonly costs: readonly number[];
  /** Printed resource icons across the deck (`printedResources`), copies counted. */
  readonly resources: {
    readonly physical: number;
    readonly mental: number;
    readonly energy: number;
    readonly wild: number;
  };
}

export function deckChart(draft: Draft): DeckChart {
  const costs = COST_BUCKETS.map(() => 0);
  const resources = { physical: 0, mental: 0, energy: 0, wild: 0 };
  for (const line of draft.cards) {
    const card = byId.get(line.cardId);
    if (!card) continue;
    const cost = costOf(card);
    if (cost >= 0) costs[Math.min(cost, COST_BUCKETS.length - 1)]! += line.quantity;
    const printed = printedResources(card);
    resources.physical += printed.physical * line.quantity;
    resources.mental += printed.mental * line.quantity;
    resources.energy += printed.energy * line.quantity;
    resources.wild += printed.wild * line.quantity;
  }
  return { costs, resources };
}

/**
 * The seat `coreScenario` takes for this deck: the identity, the cards one entry per copy, and the chosen aspects.
 * Null when the engine says the deck is not legal, because `coreScenario`'s games require legal decks.
 */
export function corePlayerOf(draft: Draft, saved?: { readonly id: string; readonly name: string }): CorePlayer | null {
  if (!validateDeck(draft, BUILDER_POOL).ok) return null;
  return {
    identityCardId: draft.identityCardId,
    deck: draft.cards.flatMap((line) => Array.from({ length: line.quantity }, () => line.cardId as string)),
    aspects: draft.aspects,
    ...(saved ? { deckId: saved.id, deckName: saved.name } : {}),
  };
}

/** Whether two drafts hold the same deck (the screen asks before leaving unsaved changes). */
export function sameDeck(a: Draft, b: Draft): boolean {
  if (a.identityCardId !== b.identityCardId || a.aspects.join() !== b.aspects.join()) return false;
  const lines = (d: Draft): string =>
    sortLines(d.cards)
      .map((l) => `${l.cardId}x${l.quantity}`)
      .join();
  return lines(a) === lines(b);
}
