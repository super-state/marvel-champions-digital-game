import type { IconName } from "./icons.js";
import type { BattleChoice } from "./model.js";

/**
 * What a question on the battle table points at. The table darkens around the cards that matter to it, glows the one
 * it is about (an attacker red, a scheme taking threat orange, the card that could answer gold) and pins an amount
 * about to land ("+1" threat) on its card. Plain data from the snapshot: main.ts draws it.
 */
export type GlowTone = "ability" | "attack" | "threat" | "target";

export interface Spot {
  glow: { id: string; tone: GlowTone }[];
  /** Every card left out of the shade: the glowing ones and any the question needs (defenders to pick). */
  cutouts: string[];
  /** An amount about to land on a card while the game waits on the player: threat on a scheme, damage on a hero. */
  mark?: { id: string; kind: "threat" | "damage" | "thwart"; amount: number } | null;
  /** Cards whose nameplate (their health) stays out of the shade too: asked to defend, the player weighs every hit point. */
  plates?: string[];
}

/** The parts of the snapshot a spotlight reads. */
export interface SpotTable {
  hero: { id: string };
  inPlay: readonly { id: string; hp?: number | null }[];
  enemyCards: readonly { id: string; attachedTo?: string | null }[];
  facedownBoosts: readonly { id: string; enemy: string }[];
}

type TriggerEventView = NonNullable<BattleChoice["event"]>;

/**
 * What an offered ability does, without the "Use <card>" its button already says: "Use Spider-Sense to draw 1 card"
 * reads "draw 1 card", and Great Responsibility's "to you take it as damage instead" reads "take it as damage
 * instead". A line given whole ("Use Backflip: Interrupt (defense): When you would take any amount of damage from an
 * attack, prevent all of that damage") loses its trigger and condition the same way: "prevent all of that damage".
 */
export function offerDoes(effect: string): string {
  const text = effect.replace(/\.$/, "");
  const to =
    /^Use [^:]+? to (?:you (?:may )?(?=(?:take|draw|gain|deal|heal|remove|place|discard|choose|look|search|ready|exhaust|return|put|reveal)\b))?(?=[a-z])/;
  if (to.test(text)) return text.replace(to, "");
  const whole =
    /^Use [^:]+:\s*(?:(?:Hero |Alter-Ego )?(?:Forced )?(?:Interrupt|Response)(?:\s*\([^)]*\))?\s*:\s*)?(?:(?:When|After|If)\b[^,]*,\s*)?(?:you (?:may )?(?=(?:take|draw|gain|deal|heal|remove|place|discard|choose|look|search|ready|exhaust|return|put|reveal)\b))?/;
  const rest = text.replace(whole, "");
  return rest && rest !== text ? rest : text;
}

/** How a reaction window's event reads: its symbol, and whether it threatens the hero (red), the plan (orange) or neither. */
export function eventLook(
  event: TriggerEventView,
  table: Pick<SpotTable, "hero" | "inPlay">,
): {
  icon: IconName | null;
  glow: GlowTone;
} {
  const ours = event.subject === table.hero.id || table.inPlay.some((card) => card.id === event.subject);
  switch (event.kind) {
    case "placeThreat":
      return { icon: "threat", glow: "threat" };
    case "enemyScheme":
      return { icon: "scheme", glow: "threat" };
    case "removeThreat":
      return { icon: "thwart", glow: "ability" };
    case "dealDamage":
      return { icon: "damage", glow: ours ? "attack" : "ability" };
    case "enemyAttack":
      return { icon: "attack", glow: "attack" };
    case "attack":
      return { icon: "attack", glow: ours ? "ability" : "attack" };
    case "cardRevealed":
    case "encounterCardRevealing":
    case "encounterCardBeingRevealed":
      return { icon: "forced", glow: "attack" };
    case "boostCardTurnedFaceup":
    case "boostCardTurningFaceup":
      return { icon: "boost", glow: "attack" };
    default:
      return { icon: null, glow: "ability" };
  }
}

/**
 * What a question spotlights. Asked to defend: the attacker, with its attachments and facedown boost cards, and the
 * hero it attacks (and the defenders once the player is choosing one). A reaction window: the card its event touches and the card that could
 * answer, with the amount an interrupt would change pinned on the first.
 */
export function spotOf(
  choice: BattleChoice | null,
  table: SpotTable,
  at: { offerIndex: number; choosingDefender: boolean; heldEncounter: string | null },
): Spot | null {
  if (!choice) return null;
  if (choice.defense) {
    const attacker = choice.defense.attackerId;
    const attachments = table.enemyCards.filter((card) => card.attachedTo === attacker).map((card) => card.id);
    const defenders = at.choosingDefender
      ? choice.options.flatMap((option) => (option.cardId ? [option.cardId] : []))
      : [];
    // The hero being attacked stands out too, under the target, so the question shows who is hit.
    const target = choice.defense.target;
    return {
      glow: [
        { id: attacker, tone: "attack" },
        { id: target, tone: "target" },
      ],
      cutouts: [...new Set([attacker, ...attachments, ...boostsOf(table, attacker), target, ...defenders])],
      // Whether to defend, and with whom, turns on how much health the hero and each ally has left: their nameplates
      // stay bright under the shade even before a defender is being picked.
      plates: [
        ...new Set([
          target,
          table.hero.id,
          ...choice.options.flatMap((option) => (option.cardId ? [option.cardId] : [])),
          ...table.inPlay.filter((card) => card.hp != null).map((card) => card.id),
        ]),
      ],
    };
  }
  // A revealed card's own question about cards on the table (Caught Off Guard: "Discard an upgrade or support you
  // control"): the cards it can take glow gold and stand out of the shade with it, like defenders to pick, and the
  // card asking glows red like an attacker. It steps aside so it covers none of them (`revealAside`).
  if (at.heldEncounter && !choice.offers?.length) {
    const held = at.heldEncounter;
    const onTable = new Set([
      table.hero.id,
      ...table.inPlay.map((card) => card.id),
      ...table.enemyCards.map((card) => card.id),
    ]);
    const picks = [
      ...new Set(
        choice.options.flatMap((option) =>
          option.cardId && option.cardId !== held && onTable.has(option.cardId) ? [option.cardId] : [],
        ),
      ),
    ];
    if (picks.length)
      return {
        glow: [{ id: held, tone: "attack" }, ...picks.map((id) => ({ id, tone: "target" as const }))],
        cutouts: [held, ...picks],
      };
  }
  const offer = choice.offers?.[at.offerIndex];
  if (!offer) return null;
  const event = choice.event;
  const glow: Spot["glow"] = [];
  if (event?.subject && event.subject !== offer.cardId)
    glow.push({ id: event.subject, tone: eventLook(event, table).glow });
  glow.push({ id: offer.cardId, tone: "ability" });
  // An attack's boost cards stand out with the attacker (Spider-Sense).
  const boosts =
    event?.subject && (event.kind === "enemyAttack" || event.kind === "enemyScheme")
      ? boostsOf(table, event.subject)
      : [];
  const kind =
    event?.kind === "placeThreat"
      ? "threat"
      : event?.kind === "removeThreat"
        ? "thwart"
        : event?.kind === "dealDamage"
          ? "damage"
          : null;
  const amount = event?.before ? (event.amount ?? 0) : 0;
  return {
    glow,
    cutouts: [...glow.map((item) => item.id), ...boosts, ...(at.heldEncounter ? [at.heldEncounter] : [])],
    mark: event?.subject && kind && amount > 0 ? { id: event.subject, kind, amount } : null,
  };
}

/**
 * Whether a question is answered only with the dock's own buttons (Nick Fury's "Choose one": Draw 3 cards, or Deal 4
 * damage to an enemy), so the table softens behind it the way it does for the mulligan: the game is waiting on that
 * answer, not on anything on the table. Not when something is picked on the table (a target, a defender, cards in
 * the hand), and not for attacks or reaction windows, which darken the table around the cards they are about instead.
 */
export function waitsOnDock(choice: BattleChoice | null, pickedOnTable: (cardId: string | null) => boolean): boolean {
  if (!choice || choice.mulligan || choice.discardFromHand || choice.defense || choice.offers?.length) return false;
  return choice.options.length > 0 && !choice.options.some((option) => pickedOnTable(option.cardId));
}

function boostsOf(table: SpotTable, enemy: string): string[] {
  return table.facedownBoosts.filter((boost) => boost.enemy === enemy).map((boost) => boost.id);
}
