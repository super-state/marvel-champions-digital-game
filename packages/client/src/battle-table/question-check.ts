/**
 * The question tripwire (Adam, 2026-11-25: Masters of Mayhem's search showed only names, and nobody had designed it;
 * "How do we find out if there are other mechanics like that?"). Every question the rules engine can ask is one of a
 * fixed set of kinds (`ChoicePrompt` in packages/engine/src/choices.ts). This says, for the question on the table
 * now, whether the table has a designed way to show it, or whether it falls back to the plain turn bar: a heading and
 * buttons, with no picture for a card that is not on the table.
 *
 * Used twice: the dev table wears a "No designed screen" tag while such a question is up (main.ts), and every driven
 * game in the tests (the fuzz, the deck audits) fails on one that is not in `KNOWN_PLAIN` (question-watch.ts).
 * The map of every kind, and the cards that raise each: https://claude.ai/artifact/KuRruTjfX6Jc5HwzpJNEFg
 */
import type { ChoicePrompt, GameState } from "@mc/engine";
import type { BattleSnapshot } from "./model.js";

/**
 * How the table shows each kind of question. "designed": a screen or table interaction made for it. "dock": the
 * plain turn bar, which is fine only while every option is a card on the table (picked there, with a glow) or the
 * search panel shows it. "unhandled": nothing shows it properly; reaching one is always a failure.
 * Typed off the engine's own list, so a new kind of question fails the type check until it is placed here.
 */
export const QUESTION_HANDLING: Record<ChoicePrompt["kind"], "designed" | "dock" | "unhandled"> = {
  declareDefender: "designed", // Defend / Don't defend, the attacker aiming at its target
  discardDownToHandSize: "designed", // cards picked in the hand
  mulligan: "designed", // cards picked in the hand
  orderEnemies: "designed", // order badges on the enemies
  orderTriggers: "designed", // order badges
  orderWhenRevealed: "designed", // the revealed card's steps as buttons naming each step
  chooseTriggers: "designed", // "Respond with X?" offers, one card at a time
  chooseAttachmentTarget: "designed", // hosts glow on the table
  payForCard: "designed", // the payment screen
  payForAbility: "designed", // the payment screen
  takeStartingCard: "dock",
  chooseMinionToActivate: "dock",
  orderPlayers: "dock",
  orderCards: "dock",
  chooseBottomCards: "dock",
  chooseTarget: "dock",
  chooseCards: "dock",
  rearrange: "dock",
  chooseOption: "dock",
  choosePlayer: "dock",
  chooseBasicPower: "dock",
  chooseBasicPowerTarget: "dock",
  orderSpecials: "dock",
  chooseCostCards: "dock",
  chooseCostCounters: "dock",
  chooseCounters: "dock",
  spendResources: "dock",
  declareWildTypes: "dock",
  choosePaidResources: "dock",
  chooseNumber: "dock",
  chooseFromList: "dock",
  searchCollection: "dock",
  accuse: "dock",
  reportFact: "dock",
  discardOverAllyLimit: "dock",
  discardOverPlayerSideSchemeLimit: "dock",
  discardRestricted: "dock",
  divideEvenlyRemainder: "dock",
  // Several options point at one card, or the question takes no picks at all: the bar would sit empty or stuck.
  orderKeywords: "unhandled",
  orderLoopKeywords: "unhandled",
  lookAt: "unhandled",
  pairCards: "unhandled",
  assignIndirectDamage: "unhandled",
  divide: "unhandled",
};

/**
 * Plain questions the driven games meet today. "accepted": Adam has said the plain version is fine, so the dev table
 * wears no tag for it either. "needs design": the test lets it through, but the dev table keeps its tag until it is
 * designed. Never add a key without designing the question or Adam's say; an "unhandled" kind can never go here.
 */
export const KNOWN_PLAIN: Readonly<Record<string, { status: "accepted" | "needs design"; note: string }>> = {
  // Adam, 2026-11-25, shown Hydra Bomber, Eviction Notice and Nick Fury: "these are fine, I've seen them lots. This is
  // the standard choose an option, this is fine for now." Each button carries that half's own words and icon.
  "chooseOption: buttons only": { status: "accepted", note: "the standard choose-one: buttons of each option's words" },
  // On the question map (2026-11-25): Wakanda Forever! orders the Special upgrades as buttons of their names, though
  // the cards are on the table to point at.
  "orderSpecials: cards as name buttons": { status: "needs design", note: "Wakanda Forever!'s order" },
};

/** Whether the dev table tags this question: every plain one, unless Adam has accepted it. */
export function tagsQuestion(found: PlainQuestion | null): found is PlainQuestion {
  return !!found && KNOWN_PLAIN[found.key]?.status !== "accepted";
}

export interface PlainQuestion {
  /** Kind and why, e.g. "orderSpecials: names of cards not on the table". The test's key. */
  key: string;
  kind: string;
  why: "unhandled" | "cards off the table" | "cards as name buttons" | "buttons only" | "boost card unnamed";
  /** The card asking, as the turn bar names it, for the failure message. */
  asker: string;
}

/**
 * The question up now, if the table shows it plainly; null when there is none, it is designed, or it is the table's
 * own pick (a basic attack's target, a cost's discard, the payment screen).
 */
export function plainQuestion(snapshot: BattleSnapshot, game: GameState): PlainQuestion | null {
  const choice = snapshot.choice;
  const pending = game.pendingChoice;
  // The table's own picks have no engine question behind them, or can be cancelled back out of.
  if (!choice || !pending || choice.canCancel || snapshot.payment) return null;
  const kind = pending.prompt.kind;
  const handling = QUESTION_HANDLING[kind];
  const asker = choice.sourceTitle ?? choice.prompt;
  if (handling === "unhandled") return { key: `${kind}: unhandled`, kind, why: "unhandled", asker };
  // A boost card asking (Android Efficiency's spend or a Drone): the question names it, which is what keeps the card up
  // and in focus until it is answered (reveal-hold.ts). Unnamed, the card went to the discard pile while the turn bar
  // asked "Villain phase" (Adam, 2026-11-25).
  const source = snapshot.choiceSource;
  if (
    source &&
    !choice.sourceTitle &&
    Object.values(game.instances).some((instance) => instance?.boostCards.includes(source as never))
  )
    return { key: `${kind}: boost card unnamed`, kind, why: "boost card unnamed", asker };
  if (handling === "designed") return null;
  // Asked in a designed way whatever its kind: defending, reaction offers, a search panel, picks in the hand, Guard.
  if (choice.defense || choice.offers?.length || choice.mulligan || choice.discardFromHand || choice.guard) return null;
  const shown = new Set<string>([
    snapshot.hero.id,
    snapshot.villain.id,
    ...snapshot.enemyCards.map((card) => card.id),
    ...snapshot.inPlay.map((card) => card.id),
    ...snapshot.hand.map((card) => card.id),
    ...(choice.searched ?? []).map((found) => found.card.id),
  ]);
  // What the table draws for each option: a card to pick on the table (it has a cardId) or a button.
  const drawn = new Map(choice.options.map((option) => [option.id, option.cardId]));
  let cards = 0;
  for (const option of pending.options) {
    const ref = option.ref;
    if (ref.kind === "card" || ref.kind === "ability") {
      if (!shown.has(ref.instanceId))
        return { key: `${kind}: cards off the table`, kind, why: "cards off the table", asker };
      // A card the table could point at, drawn as a button with its name instead (Wakanda Forever!'s order).
      if (!drawn.get(option.optionId))
        return { key: `${kind}: cards as name buttons`, kind, why: "cards as name buttons", asker };
      cards++;
    } else if (ref.kind === "cardDefinition" || ref.kind === "facedownCard") {
      return { key: `${kind}: cards off the table`, kind, why: "cards off the table", asker };
    }
  }
  // The cards offered are all ones the player can see and pick on the table (any other option is a plain answer
  // beside them, like declining): that is the table's own way of asking.
  if (cards > 0) return null;
  // An either-or spend says both halves on its buttons (Sonic Boom): designed for that.
  if (kind === "spendResources" && /^Spend .+, or .+\?$/.test(choice.prompt)) return null;
  return { key: `${kind}: buttons only`, kind, why: "buttons only", asker };
}

/** The engine's own catch-all headings: a question showing one says nothing about what it is for. Report only. */
export const ENGINE_HEADINGS: ReadonlySet<string> = new Set([
  "Choose",
  "Choose one",
  "Choose a card",
  "Choose cards",
  "Choose a target",
]);
