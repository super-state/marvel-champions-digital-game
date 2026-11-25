import { CORE_DEPS, coreScenario } from "@mc/cards";
import {
  RESOURCE_TYPES,
  applyCommand,
  activeEncounterDeck,
  activeAbilityRefs,
  cardOf,
  characterProfile,
  createGame,
  getInstance,
  handDiscardCandidates,
  handSize,
  legalActions,
  locateCard,
  paymentOptionsPool,
  readsOverpaid,
  playCostOf,
  remainingHitPoints,
  threatCannotBeRemoved,
  type Command,
  type GameEvent,
  type GameState,
  type InstanceId,
  type LegalAction,
  type LegalActions,
  type ResourceType,
  type TriggerEvent,
} from "@mc/engine";
import { artFor, CARD_BACKS, standInArt } from "../art/art-source.js";
import { abilityLabelOf, abilityShortLabelOf } from "../view/ability-label.js";
import {
  countersOf,
  faceOf,
  isLandscapeType,
  printedStatsOf,
  profileStatTiles,
  schemePanel,
} from "../view/board-model.js";
import { answeredEventsOf, triggerEffectOf, triggerWindowContextOf } from "../view/trigger-window-context.js";
import { plainRulesTextOf } from "../view/card-search-document.js";
import { missLineOf } from "./deck-reveal.js";
import { choiceSourcePanelOf } from "../view/choice-source-panel.js";
import { choiceSourceOf, promptTitleOf } from "../view/choice-source.js";
import {
  faceUpName as printedNameOf,
  optionLabelOf as printedOptionLabelOf,
  shortIdentityNameOf,
} from "../view/names.js";
import { beginPayment, paymentView, togglePayment, type PaymentState } from "../view/payment-model.js";

import { paymentSheetView } from "../view/payment-sheet.js";

/**
 * A player's card in play facedown as a minion: an Ultron Drone ("put the top card of your deck into play facedown,
 * engaged with you as a Drone minion", Ultron Drones 01140). The table shows a Drone and never the card underneath: no
 * name, type, text, cost or picture of it reaches a snapshot, a beat or a label while it is facedown.
 * Engine interpretation (no official source): a facedown Drone's face is hidden from every player, its owner included;
 * RRG 1.8 "Look, Looked-At" p. 27; ruling 29 Nov 2023 #118 ("you could look at the drones you defeated").
 */
export function isFacedownMinion(state: GameState, id: InstanceId): boolean {
  return getInstance(state, id)?.facedownAs?.kind === "minion";
}

/** What a facedown minion is called on the table. */
export const DRONE_NAME = "Drone";
/** A facedown Drone's base stats while Ultron Drones is in play (01140): what the Drone picture prints. */
const DRONE_BASE = { sch: 1, atk: 1, hp: 1 } as const;
/** What the play hook reads on a Drone in place of the hidden card's text. */
const DRONE_FACTS =
  "A card from your deck, facedown: nobody may look at it. No text and no keywords of its own. " +
  "When it is defeated, the card goes faceup to your discard pile.";

/** A Drone as it comes into play: the Drone picture, 1 hit point, nothing on it yet. */
function droneCard(id: string): BattleCard {
  return {
    id,
    attachedTo: null,
    showAsFullCard: false,
    markers: [],
    name: DRONE_NAME,
    hp: DRONE_BASE.hp,
    reverseArt: null,
    threatTarget: null,
    threat: null,
    exhausted: false,
    landscape: false,
    art: standInArt({ kind: "ultronDrone", atk: DRONE_BASE.atk }).url,
    type: "minion",
    playable: false,
    requiresHeroForm: false,
    cost: null,
    reason: null,
    drone: true,
  };
}

/** The type a card in play shows as: a facedown Drone is a minion, whatever the card underneath is. */
function shownType(state: GameState, id: InstanceId): string | undefined {
  return isFacedownMinion(state, id) ? "minion" : cardOf(state, id)?.type;
}

function faceUpName(state: GameState, id: InstanceId): string {
  return isFacedownMinion(state, id) ? DRONE_NAME : printedNameOf(state, id);
}

const optionLabelOf: typeof printedOptionLabelOf = (state, option) =>
  state && option.ref.kind === "card" && option.ref.instanceId && isFacedownMinion(state, option.ref.instanceId)
    ? DRONE_NAME
    : printedOptionLabelOf(state, option);

export interface BattleCard {
  attachedTo?: string | null;
  id: string;
  name: string;
  art: string;
  landscape: boolean;
  exhausted: boolean;
  hp?: number;
  showAsFullCard?: boolean;
  reverseArt: string | null;
  threat: number | null;
  threatTarget: number | null;
  markers: { name: string; count: number }[];
  type: string;
  playable: boolean;
  requiresHeroForm: boolean;
  cost: number | null;
  reason: string | null;
  /** A card lying facedown under another (Highway Robbery's stolen card): that card. */
  under?: string;
  /** A player's card in play facedown as a Drone minion: shown by the Drone picture, never by its own face. */
  drone?: true;
  /**
   * On a scheme: why the player can't take threat off it right now, in the table's words ("Threat cannot be removed
   * from this scheme", Countdown to Oblivion; a crisis icon in play, for the main scheme). The threat pill wears a
   * lock, and a thwart never offers it.
   */
  threatLock?: string;
}

export interface BattlePayment {
  ability: boolean;
  /** The log's line once it is paid, for a hero's own named ability: "Captain Marvel uses Rechannel". */
  used?: string;
  /** "Spend X [energy] resources" (Energy Channel): the type of resource X counts. The amount is what is paid. */
  spendX?: string;
  outstanding?: readonly string[];
  subject: BattleCard;
  required: number;
  paid: number;
  canPay: boolean;
  /** Hand instances in the order their payment discards will land. */
  discards: string[];
  sources: {
    id: string;
    cardId: string;
    label: string;
    icons: ResourceType[];
    selected: boolean;
    available: boolean;
    kind: "handCard" | "resourceAbility";
  }[];
}

/** The card a reaction window is about and the amount at stake, so the table can point at it before asking. */
function triggerSubjectOf(event: TriggerEvent, before: boolean): NonNullable<BattleChoice["event"]> {
  const about = (subject: string | null, amount: number | null = null) => ({
    kind: event.kind,
    subject,
    amount,
    before,
  });
  switch (event.kind) {
    case "placeThreat":
    case "removeThreat":
      return about(event.schemeInstanceId, event.amount);
    case "dealDamage":
      return about(event.targetInstanceId, before ? event.amount : (event.taken ?? event.amount));
    case "enemyAttack":
    case "enemyScheme":
      return about(event.enemyInstanceId);
    case "attack":
      return about(event.attackerInstanceId);
    case "thwart":
      return about(event.thwarterInstanceId);
    case "boostCardTurnedFaceup":
    case "boostCardTurningFaceup":
      return about(event.boostInstanceId);
    case "cardRevealed":
    case "encounterCardRevealing":
    case "encounterCardBeingRevealed":
    case "cardEntersPlay":
    case "characterDefeated":
    case "cardPlayed":
    case "cardBeingPlayed":
      return about(event.instanceId);
    default:
      return about(null);
  }
}

export interface BattleChoice {
  /** Which question this is: the engine's choice id, or the target pick's action. Stable while it is asked. */
  id: string;
  prompt: string;
  explanation?: string;
  sourceTitle?: string;
  offers?: { id: string; cardId: string; question: string; effect: string | null }[];
  /** What a reaction window is about: the card it touches and the amount at stake, before (interrupt) or after. */
  event?: { kind: string; subject: string | null; amount: number | null; before: boolean };
  defense?: { attacker: string; attackerId: string; target: string };
  decline?: string;
  options: { id: string; label: string; cardId: string | null }[];
  canSkip: boolean;
  canCancel: boolean;
  min: number;
  max: number;
  discardFromHand: boolean;
  /** The opening-hand mulligan: pick any cards to discard, then draw back up to hand size. */
  mulligan: boolean;
  /**
   * The picks are an order (Masters of Mayhem's "Order the enemies", "Order these effects"): the first one picked goes
   * first. The table numbers the picked cards as they are picked (`pick-order.ts`).
   */
  ordered?: boolean;
}

export interface BattleBeat {
  text: string;
  enemy: boolean;
  activity?: string;
  statusChange?: { id: string; name: string; delta: number };
  enemyActivation?: string;
  /** The enemy activating is scheming (not attacking): the table stamps "Schemes" on it. */
  scheming?: string;
  discardEvent?: string;
  interrupt?: string;
  deflection?: { card: string; amount: number };
  modifier?: { id: string; name: string; count: number };
  attackAim?: { source: string; target: string };
  /** A stunned enemy straining to attack; the stun is discarded instead (the next beat). */
  stunnedAttempt?: string;
  turned?: { id: string; exhausted: boolean };
  draw?: string[];
  encounterDeal?: string;
  villainStage?: number;
  villainFlip?: boolean;
  /**
   * The main scheme's stage was completed and it turned over to its next one (Klaw's Underground Distribution to
   * Secret Rendezvous): `from` and `to` are the stage names, `threat` and `target` the new stage's threat and goal.
   */
  schemeAdvance?: { scheme: string; from: string; to: string; stage: number; threat: number; target: number | null };
  /**
   * An encounter card put into play without being revealed (Klaw's main scheme discarding cards until a minion, then
   * putting that minion into play): it comes onto the table on its own beat.
   */
  entersPlay?: string;
  /**
   * A card off the top of the player's deck (or their discard pile) put into play facedown as a Drone minion: it
   * leaves that pile on its own beat, with the card whose ability did it when one did (Ultron, a main scheme stage,
   * Android Efficiency). `deckCount`: the cards left in the deck once it has gone.
   */
  droneIn?: { card: BattleCard; from: "deck" | "discard"; source: string | null; deckCount: number };
  defeat?: string;
  defeatedCard?: string;
  /**
   * With `defeatedCard`: it was a facedown Drone, and this is the card it turns out to be as it goes faceup to its
   * owner's discard pile (RRG 1.8 "Discard" p. 16; ruling 26 Jan 2026 #5: the facedown side is not in play).
   */
  droneWas?: string;
  /** A card in play discarded without being defeated: an attachment used up, a support Caught Off Guard took. */
  leftPlay?: string;
  /** With `leftPlay`: the card is removed from the game, so it evaporates off the table instead of going to a pile. */
  removedFromGame?: boolean;
  /** Cards an effect discarded from the hand (Eviction Notice's random discard), in the order they went. */
  handDiscard?: string[];
  /** Cards an effect put back in the hand from elsewhere (Highway Robbery returning what it stole). */
  returned?: string[];
  /** Cards discarded from the top of the player's deck (Black Cat). */
  milled?: string[];
  /**
   * Cards discarded from the top of the encounter deck, in the order they went (Masterplan's "until a side scheme is
   * discarded", Secret Rendezvous's "until a minion"): turned up off the encounter deck, then to its discard pile.
   */
  encounterMilled?: string[];
  /** Cards from the hand put facedown under a card (Highway Robbery's When Revealed), and that card. */
  tucked?: { ids: string[]; host: string; count: number };
  /** The cards this beat moves out of the hand (`tucked`, `handDiscard`) were picked at random. */
  random?: true;
  /** An encounter card dealt as the price of a player deck that ran out (RRG "Player Deck"). */
  penalty?: boolean;
  /** Where `returned` cards were lying facedown before (the card they were under: Highway Robbery). */
  returnedFrom?: string;
  /** The player's deck ran out: the discard pile is shuffled into a new deck (a facedown encounter card follows). */
  deckReset?: number;
  /** Set-aside cards shuffled into the encounter deck (Shadow of the Past: the rest of the nemesis set). */
  intoEncounterDeck?: BattleCard[];
  /** Every card in `intoEncounterDeck` belongs to a nemesis set. */
  nemesis?: true;
  /** The encounter deck ran out: its discard pile shuffled back in, `count` cards. */
  encounterReset?: number;
  /** Acceleration tokens on the main scheme after one was added. */
  acceleration?: number;
  /** Overkill: damage past a defeated minion spilling onto `to`. */
  overkill?: { to: string; amount: number };
  /** A cost discount waiting for the next card played (Helicarrier), from `source` when a card's ability gave it. */
  discount?: { amount: number; source: string | null };
  /** An effect that needed something to choose and found nothing (Spider-Tracer with no scheme in play). */
  nothingFound?: { slot: string; source: string | null };
  /**
   * The card whose ability discarded `milled` (Black Cat), when one did, and what kind of ability it was. `miss`: what
   * the table says when none of the cards is one the effect keeps for the hand ("No mental resources").
   */
  millSource?: { card: string; label: string; miss?: string };
  /** On a facedown deal: the enemy the card goes to as its boost card. */
  boostFor?: string;
  /** The encounter card whose surge deals the player another encounter card (the deal beat follows). */
  surge?: string;
  reveal?: {
    id: string;
    name: string;
    art: string;
    landscape: boolean;
    boost: { icons: number; enemy: string } | null;
    /** A minion: it takes its place without waiting for Continue (its When Revealed then plays out on the table). */
    quick: boolean;
    /** The card has a When Revealed, which fires with a flash before its effect lands. */
    whenRevealed: boolean;
    /**
     * A card with a When Revealed for each form (Assault): the one that applies to the hero's form right now, so the
     * player is told which half of the card is about to happen.
     */
    applies?: { form: "Hero" | "Alter-Ego"; text: string };
    /**
     * Its When Revealed hits "each hero" while the player is in alter-ego form, so it fires on no one (Shocker). An
     * alter-ego is not a hero (Rules Reference v1.8, "Hero"), and the table says so rather than flashing for nothing.
     */
    noHeroes?: true;
    /** The card whose ability revealed it, when it was not dealt (Shadow of the Past bringing in Vulture). */
    broughtBy?: string;
    /** It belongs to a nemesis set. */
    nemesis?: true;
  };
  /** A revealed encounter card that has fully resolved going to the encounter discard pile (Assault, after its attack). */
  encounterResolved?: string;
  actor?: string | null;
  phase?: "hero" | "villain";
  /** With `phase`: the round it belongs to (the final state may already be a round on, after a whole villain phase). */
  round?: number;
  gameEnded?: true;
  activate?: { card: string; hero: string };
  threat?: { scheme: string; delta: number };
  hit?: { source: string | null; target: string; amount: number; tough?: boolean };
}

export interface BattleSnapshot {
  beats: readonly BattleBeat[];
  enemyCards: BattleCard[];
  /** Cards lying facedown under an enemy card (Highway Robbery's), shown by their backs: `under` names the card. */
  under: BattleCard[];
  hand: BattleCard[];
  deckCount: number;
  encounterCount: number;
  encounterDiscard: BattleCard[];
  facedownEncounters: readonly string[];
  /** The facedown boost cards waiting beside their enemies, until an activation turns them up. */
  facedownBoosts: readonly { id: string; enemy: string }[];
  choiceSource: string | null;
  drawn: readonly string[];
  hero: BattleCard;
  villain: BattleCard;
  /** The hero's powers and its own Action abilities (an ability says whether it exhausts the hero). */
  heroActions: { kind: string; label: string; exhausts?: boolean }[];
  heroHp: number;
  villainHp: number;
  inPlay: BattleCard[];
  /** Bottom to top, so each paid card is placed on its predecessor. */
  discard: BattleCard[];
  payment: BattlePayment | null;
  choice: BattleChoice | null;
  turn: "player" | "ending" | "enemy" | "finished";
  round: number;
  outcome: GameState["outcome"];
  canEndTurn: boolean;
}

/**
 * A payment a card offers instead of something worse says what the something worse is: Sonic Boom's "Either spend
 * [energy][mental][physical] resources or exhaust each character you control" asks "Spend 1 energy, 1 mental, 1
 * physical, or exhaust each character you control?", where the bare "Spend 3 resources?" hid what declining does.
 */
function eitherOrTitle(state: GameState, pending: NonNullable<GameState["pendingChoice"]>): string | null {
  if (pending.prompt.kind !== "spendResources" || pending.prompt.formChangeCost) return null;
  const source = choiceSourceOf(state, pending)?.instanceId;
  const card = source ? cardOf(state, source) : undefined;
  const otherwise = card && /\bEither spend\b[^.]*?\bor ([^.]+)\./i.exec(plainRulesTextOf(card))?.[1];
  if (!otherwise) return null;
  const { requirement } = pending.prompt;
  const parts = (["energy", "mental", "physical", "wild", "generic"] as const).flatMap((type) => {
    const n = requirement[type] ?? 0;
    return n ? [`${n} ${type === "generic" ? (n === 1 ? "resource" : "resources") : type}`] : [];
  });
  return `Spend ${parts.join(", ")}, or ${otherwise}?`;
}

function statModifiers(state: GameState, id: InstanceId) {
  const profile = characterProfile(state, id, CORE_DEPS);
  if (!profile) return [];
  // A facedown Drone has no printed numbers of its own: what it gains (Upgraded Drones, Ultron III) is counted from
  // the 1 SCH, 1 ATK and 1 hit point Ultron Drones gives it, which is what its picture prints.
  if (isFacedownMinion(state, id))
    return [
      { name: "SCH", count: (profile.sch ?? DRONE_BASE.sch) - DRONE_BASE.sch },
      { name: "ATK", count: (profile.atk ?? DRONE_BASE.atk) - DRONE_BASE.atk },
      { name: "HP", count: profile.maxHp - DRONE_BASE.hp },
    ].filter((modifier) => modifier.count !== 0);
  const printed = printedStatsOf(state, id);
  const modifiers = profileStatTiles(profile, printed, ["thw", "atk", "def", "sch", "rec"], undefined, undefined)
    .filter((tile) => tile.bonus !== 0)
    .map((tile) => ({ name: tile.label, count: tile.bonus }));
  if (printed && profile.maxHp !== printed.maxHp) modifiers.push({ name: "HP", count: profile.maxHp - printed.maxHp });
  return modifiers;
}

/**
 * Of a card's form-bound When Revealed lines ("When Revealed (Alter-Ego): This card gains surge. / When Revealed
 * (Hero): The villain attacks you."), the one for `form`. Nothing for a card without them.
 */
export function formWhenRevealed(
  text: string,
  form: "hero" | "alterEgo",
): { applies: { form: "Hero" | "Alter-Ego"; text: string } } | Record<string, never> {
  const label = form === "hero" ? "Hero" : "Alter-Ego";
  // The searchable text runs the lines together, so a line ends at the next ability's opening words.
  const line = new RegExp(
    String.raw`When Revealed \(${label}\)\s*:\s*(.+?)\s*(?=\n|When Revealed\b|(?:Hero |Alter-Ego )?(?:Forced )?(?:Interrupt|Response)\b|Boost\b|$)`,
    "is",
  ).exec(text);
  return line ? { applies: { form: label, text: line[1]!.trim() } } : {};
}

/**
 * A When Revealed that only hits "each hero" ("Deal 1 damage to each hero.") finds no one while the player is in
 * alter-ego form. Cards with a line per form are told apart by formWhenRevealed instead.
 */
export function whenRevealedMissesHeroes(text: string, form: "hero" | "alterEgo"): boolean {
  if (form !== "alterEgo" || /When Revealed \((?:Hero|Alter-Ego)\)/i.test(text)) return false;
  // The searchable text runs the lines together, so a line ends at the next ability's opening words.
  const line =
    /When Revealed\s*:\s*(.+?)\s*(?=\n|When Revealed\b|(?:Forced )?(?:Interrupt|Response)\b|Boost\b|$)/is.exec(
      text,
    )?.[1] ?? "";
  return /\beach hero\b/i.test(line) && !/\b(?:player|identity|you)\b/i.test(line);
}

/**
 * The cards an encounter card's ability is moving out of the hand are picked at random: its text says so ("Discard 1
 * card at random", Highway Robbery's "a random card"). The engine reports only the move, not how the card was picked.
 */
function pickedAtRandom(state: GameState, resolving: { card: InstanceId } | null): boolean {
  const card = resolving ? cardOf(state, resolving.card) : undefined;
  if (!card || !ENCOUNTER_TYPES.has(card.type)) return false;
  return /\bat random\b|\ba random card\b/i.test(plainRulesTextOf(card));
}

const ENCOUNTER_TYPES = new Set(["minion", "treachery", "attachment", "side_scheme", "environment", "obligation"]);

/** A card of a nemesis encounter set (Vulture and the rest of Spider-Man's). */
function isNemesisCard(card: object | undefined): boolean {
  const sets = card && "encounterSetIds" in card ? (card.encounterSetIds as readonly string[] | undefined) : undefined;
  return !!sets?.some((set) => set.endsWith("_nemesis"));
}

/** A step of `attacker`'s attack itself: its boost card, the defense, the damage. */
function partOfAttack(beat: BattleBeat, attacker: string): boolean {
  return (
    beat.boostFor === attacker ||
    beat.reveal?.boost?.enemy === attacker ||
    beat.hit?.source === attacker ||
    beat.text === "The attack is undefended" ||
    beat.text.endsWith(" defends")
  );
}

function apply(state: GameState, command: Command) {
  const result = applyCommand(state, command, CORE_DEPS);
  if (!result.ok) throw Error(result.error.message);
  return result;
}

/** A card's own abilities (an identity's are on its faces, so it has none here). */
function playedAbilityRefs(card: ReturnType<typeof cardOf>): readonly { id: string }[] {
  return card && "abilities" in card ? (card.abilities as readonly { id: string }[]) : [];
}

/**
 * "Use Maria Hill to each player draws 1 card": the helper's "Use X to <verb>" reads only when the ability's words
 * start with a verb ("Use Spider-Woman to confuse the villain"); one that starts with who does it takes a colon.
 */
function readableEffect(effect: string | null): string | null {
  return (
    effect
      ?.replace(/^Use ((?:(?! to ).)+) to ((?:each|every|all|you|your|that|the|a|an)\b.*)$/, "Use $1: $2")
      // A name that ends in its own ? or !, as "Do You Even Lift?" does, is quoted as the card prints it.
      .replace(/^Use ([^“:]+?[?!])( to |: )/, "Use “$1”$2") ?? null
  );
}

/**
 * Why a card can't be played, in the player's words where the engine's are its own: "choose exactly one card for
 * ally" (Make the Call with no ally in any discard pile), "max 1 per host" (Inspired: the card says per ally).
 */
function playerReason(card: object | undefined, message: string): string {
  const text = card ? plainRulesTextOf(card as Parameters<typeof plainRulesTextOf>[0]) : "";
  if (/choose exactly one card for ally/i.test(message) && /discard pile/i.test(text))
    return "No ally in a discard pile to put into play.";
  const per = /\bMax 1 per (ally|hero|player|enemy|minion|villain)\b/i.exec(text)?.[1];
  if (per && /max 1 per host/i.test(message)) return message.replace(/per host/i, `per ${per.toLowerCase()}`);
  return message;
}

/**
 * A step of a revealed card's When Revealed order (FFG ruling, September 22, 2026: surge, incite and When Revealed
 * share a timing and the players order them): what it does, in the card's words. Kree Manipulator: "Place 1 threat on
 * the main scheme" and "Surge: reveal 1 more encounter card". The engine names a printed step by its ability id.
 */
function whenRevealedStepLabel(state: GameState, card: InstanceId, step: string, engineLabel: string): string {
  // RRG 1.8 "Surge" (p. 42): deal yourself 1 facedown encounter card; it is revealed with the others.
  if (step === "surge") return "Surge: deal yourself 1 more encounter card";
  if (step === "incite") return `${engineLabel}: place that much threat on the main scheme`;
  const printed = cardOf(state, card);
  const text = printed ? plainRulesTextOf(printed) : "";
  const line = /When Revealed(?: \([^)]*\))?:\s*([^.]*)/.exec(text)?.[1]?.trim();
  return line || "When Revealed";
}

/** The repeatable practice deal the tests use: seed 75 deals Swinging Web Kick, Strength and several priced permanents. */
export const PRACTICE_SEED = 75;

/**
 * An encounter card's own way off the table: "Hero Action: Spend [energy][mental][physical] resources → discard this
 * card." (Klaw's Sonic Converter, Ultron's Upgraded Drones) or "Exhaust your hero and spend [mental][mental]
 * resources → discard this card." (Program Transmitter, Vibranium Armor). Its short label is only the cost, so the
 * button says what paying it does: "Discard it: spend energy, mental, physical".
 */
function payToDiscardLabel(card: object | undefined, cost: string): string | null {
  if (!card || !/→\s*discard this card\b/i.test(plainRulesTextOf(card as Parameters<typeof plainRulesTextOf>[0])))
    return null;
  const words = cost
    .replace(/\b1 (energy|mental|physical|wild)\b/gi, "$1")
    .replace(/\byour identity\b/i, "your hero")
    .replace(/^./, (first) => first.toLowerCase());
  return `Discard it: ${words}`;
}

/** What a side scheme's printed icons do (RRG 1.8 "Acceleration Icon", "Crisis Icon", "Hazard Icon"). */
const SCHEME_ICON_TEXT: Record<string, string> = {
  acceleration: "Acceleration icon: 1 more threat goes on the main scheme each villain phase while this is in play.",
  crisis: "Crisis icon: player cards can't remove threat from the main scheme while this is in play.",
  hazard: "Hazard icon: 1 more encounter card is dealt each villain phase while this is in play.",
};

/**
 * The question for an encounter attachment's host, when the engine leaves the pick to the player (two minions tied on
 * Biomechanical Upgrades' "highest printed hit points"): it names the card and gives its "Attach to" rule.
 */
function attachQuestion(
  state: GameState,
  attaching: InstanceId,
  options: NonNullable<GameState["pendingChoice"]>["options"],
): Pick<BattleChoice, "prompt" | "sourceTitle" | "explanation"> {
  const card = cardOf(state, attaching);
  const rule = card ? /\bAttach to [^.]*\./i.exec(plainRulesTextOf(card))?.[0] : undefined;
  const minions = options.every((o) => o.ref.kind === "card" && cardOf(state, o.ref.instanceId)?.type === "minion");
  return {
    prompt: `Choose ${minions ? "a minion" : "a card"} to attach it to`,
    sourceTitle: faceUpName(state, attaching),
    ...(rule ? { explanation: rule.trim() } : {}),
  };
}

/** The heroes the table can deal, each with their Core Set starter deck. */
export const HEROES = [
  { id: "spider-man", name: "Spider-Man", starterDeckId: "core-spider-man-justice" },
  { id: "captain-marvel", name: "Captain Marvel", starterDeckId: "core-captain-marvel-leadership" },
  { id: "she-hulk", name: "She-Hulk", starterDeckId: "core-she-hulk-aggression" },
] as const;
export type HeroId = (typeof HEROES)[number]["id"];

export function isHeroId(id: unknown): id is HeroId {
  return HEROES.some((hero) => hero.id === id);
}

/** The villains the table can deal, each a Core Set scenario, with the module its scenario recommends. */
export const VILLAINS = [
  { id: "rhino", name: "Rhino", module: "bomb_scare" },
  { id: "klaw", name: "Klaw", module: "masters_of_evil" },
  { id: "ultron", name: "Ultron", module: "under_attack" },
] as const;
export type VillainId = (typeof VILLAINS)[number]["id"];

export function isVillainId(id: unknown): id is VillainId {
  return VILLAINS.some((villain) => villain.id === id);
}

/** The Core Set's five modular encounter sets: a game adds one (its villain's recommended one unless chosen). */
export const MODULES = [
  { id: "bomb_scare", name: "Bomb Scare" },
  { id: "masters_of_evil", name: "Masters of Evil" },
  { id: "under_attack", name: "Under Attack" },
  { id: "legions_of_hydra", name: "Legions of Hydra" },
  { id: "the_doomsday_chair", name: "The Doomsday Chair" },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"];

export function isModuleId(id: unknown): id is ModuleId {
  return MODULES.some((module) => module.id === id);
}

/** Standard or Expert (RRG v1.8 p. 28): Expert adds the Expert set and starts the villain at stage II. */
export type Difficulty = "standard" | "expert";

export function isDifficulty(id: unknown): id is Difficulty {
  return id === "standard" || id === "expert";
}

/** The module the villain's scenario recommends: what a game adds unless another is chosen. */
export const recommendedModule = (villain: VillainId): ModuleId => VILLAINS.find((each) => each.id === villain)!.module;

export interface DealOptions {
  // The game: who plays against whom.
  /** Which hero, with their starter deck: Spider-Man unless chosen otherwise. */
  hero?: HeroId;
  /** Which scenario: Rhino unless chosen otherwise. */
  villain?: VillainId;
  /** Standard unless chosen otherwise. */
  difficulty?: Difficulty;
  /** The modular encounter sets: the villain's recommended one unless chosen otherwise. */
  modules?: readonly ModuleId[];

  // How it is dealt.
  /** The shuffle. Every seed is a different, repeatable deal. */
  seed?: number;
  /** Stop at the opening hand so the player can mulligan (RRG Appendix II step 15); otherwise keep it. */
  mulligan?: boolean;
  /** Rearrange the first hero phase (a dev scene for looking at a crowded table). Ignored with `mulligan`. */
  arrange?: (state: GameState) => GameState;
}

/**
 * What the scenario's setup put on the table before the first hand was drawn, in words: the cards its main scheme
 * brought into play (Klaw's Defense Network, Ultron's Drones environment) and a Drone made of the top card of the
 * player's deck. The table opens with them already there, so the log says where they came from.
 */
function setupNotesOf(state: GameState, events: readonly GameEvent[]): string[] {
  const notes: string[] = [];
  for (const e of events) {
    if (e.type === "cardPutIntoPlayFacedown" && e.as === "minion")
      notes.push("Setup: the top card of your deck goes into play facedown as a Drone minion");
    else if (
      e.type === "cardMoved" &&
      (e.to.kind === "villainArea" || e.to.kind === "playArea") &&
      ["encounterDeck", "encounterSetAside", "encounterDiscard", "dealtEncounter"].includes(e.from.kind)
    ) {
      const card = cardOf(state, e.instanceId);
      if (card && ENCOUNTER_TYPES.has(card.type)) notes.push(`Setup: ${card.name} comes into play`);
    }
  }
  return notes;
}

function openingTurn({
  hero = "spider-man",
  villain = "rhino",
  difficulty,
  modules,
  seed = PRACTICE_SEED,
  mulligan: ask = false,
  arrange,
}: DealOptions = {}): {
  state: GameState;
  setup: string[];
} {
  const created = createGame(
    coreScenario(villain, {
      seed,
      players: [{ starterDeckId: HEROES.find((each) => each.id === hero)!.starterDeckId }],
      ...(difficulty ? { difficulty } : {}),
      ...(modules ? { modularSetIds: modules } : {}),
    }),
    CORE_DEPS,
  );
  if (!created.ok) throw Error(created.error.message);
  const state = created.state;
  const setup = setupNotesOf(state, created.events);
  const mulligan = state.pendingChoice;
  if (mulligan?.prompt.kind !== "mulligan") throw Error("Expected the hero's opening hand.");
  if (ask) return { state, setup };
  const turn = apply(state, {
    type: "resolveChoice",
    playerId: mulligan.playerId,
    choiceId: mulligan.choiceId,
    selectedOptionIds: [],
  });
  return { state: arrange ? arrange(turn.state) : turn.state, setup };
}

export class BattleModel {
  #game!: GameState;
  #actions!: LegalActions;
  #plays = new Map<string, LegalAction>();
  #windowPicks: string[] = [];
  #payment: PaymentState | null = null;
  #subject: InstanceId | null = null;
  #targetPick: LegalAction | null = null;
  /**
   * An ability whose cost discards cards from the hand ("choose and discard 1 card from your hand →", Alpha Flight
   * Station), waiting for the player to pick which: the engine's own example would pick for them.
   */
  #costDiscard: { entry: LegalAction; candidates: readonly InstanceId[]; min: number; max: number } | null = null;
  #view: BattleSnapshot | null = null;
  #matchup: { hero: HeroId; villain: VillainId } = { hero: "spider-man", villain: "rhino" };
  #encounter: { difficulty: Difficulty; modules: readonly ModuleId[] } = {
    difficulty: "standard",
    modules: [recommendedModule("rhino")],
  };

  #beats: BattleBeat[] = [];
  #villainActivity = "";
  /** Enemies whose activation aimed an attack that hasn't been initiated yet: their attack needs no aim of its own. */
  #aimed = new Set<string>();
  /** An attack a card made happen (Assault), and the villain step it interrupts, to go back to once it resolves. */
  #effectAttack: { enemy: string; activity: string } | null = null;
  #drawn: readonly string[] = [];
  #handOrder: InstanceId[] = [];

  #history: {
    game: GameState;
    handOrder: InstanceId[];
    activity: string;
    beats: BattleBeat[];
    aimed: Set<string>;
    effectAttack: { enemy: string; activity: string } | null;
    dronesDefeated: Map<string, string>;
    /** How many of `#events` there were before this move. */
    events: number;
  }[] = [];
  /** Every engine event of this game's moves so far, undone moves left out: the saved record reads it (`record/`). */
  #events: GameEvent[] = [];

  /**
   * The cards defeated as Drones that still lie in the discard pile, and their names: a question about that defeat
   * asked on a later move (Interrogation Room, after Spider-Tracer has had its say) still speaks of the Drone.
   */
  #dronesDefeated = new Map<string, string>();
  #setup: string[] = [];
  /** What the scenario's setup put on the table before the first hand was drawn, for the log. */
  /**
   * Every picture this game can show: each card's faces (a hero's two, a villain's stages, a main scheme's stages and
   * sides, a flip side) and both card backs. Online a card's picture downloads the first time it is needed, so a card
   * turning over showed black for a moment (Adam, 2026-11-24, on the test site); the table loads these as it deals.
   */
  pictures(): string[] {
    const urls = new Set<string>([CARD_BACKS.player.url, CARD_BACKS.encounter.url]);
    const add = (card: Parameters<typeof artFor>[0], face: Parameters<typeof artFor>[1]) => {
      try {
        const url = artFor(card, face)?.url;
        if (url) urls.add(url);
      } catch {
        // A face this card doesn't have: nothing to load.
      }
    };
    for (const id of Object.keys(this.#game.instances)) {
      const card = cardOf(this.#game, id as InstanceId);
      if (!card) continue;
      add(card, { kind: "front" });
      if (card.type === "hero_identity") {
        add(card, { kind: "hero" });
        add(card, { kind: "alterEgo" });
      }
      if ("flipSide" in card && card.flipSide) add(card, { kind: "flipSide" });
      // Ultron's Drones: player cards facedown, shown by their own stand-in picture.
      if (card.type === "villain" && /ultron/i.test(card.name))
        urls.add(standInArt({ kind: "ultronDrone", atk: DRONE_BASE.atk }).url);
      if (card.type === "villain")
        card.sides.forEach((side, sideIndex) =>
          side.stages.forEach((_, stageIndex) => add(card, { kind: "villainStage", sideIndex, stageIndex })),
        );
      if (card.type === "main_scheme")
        card.stages.forEach((_, stageIndex) => {
          add(card, { kind: "mainSchemeStage", stageIndex, side: "A" });
          add(card, { kind: "mainSchemeStage", stageIndex, side: "B" });
        });
    }
    return [...urls];
  }

  get setupNotes(): readonly string[] {
    return this.#setup;
  }

  /** The game as the engine has it now (read only: the saved record works its facts out from it, `record/`). */
  get game(): GameState {
    return this.#game;
  }

  /** The engine's events of every move this game, undone moves left out (read only, for the saved record). */
  get events(): readonly GameEvent[] {
    return this.#events;
  }

  get canUndo(): boolean {
    return this.#history.length > 0;
  }

  /** Paying for a reaction the player chose in a window (Enhanced Spider-Sense), not for a card played from hand. */
  get payingForReaction(): boolean {
    return !this.#payment && !!this.snapshot().payment;
  }

  undo(): boolean {
    const previous = this.#history.pop();
    if (!previous) return false;
    // Undo from the middle of paying (for a reaction) drops the payment too: `#setGame` clears it.
    this.#handOrder = previous.handOrder;
    this.#villainActivity = previous.activity;
    this.#beats = previous.beats;
    this.#aimed = previous.aimed;
    this.#effectAttack = previous.effectAttack;
    this.#dronesDefeated = previous.dronesDefeated;
    this.#events.length = previous.events;
    this.#setGame(previous.game, []);
    return true;
  }

  /** The hero and villain of the game on the table, as it was dealt. */
  get matchup(): { hero: HeroId; villain: VillainId } {
    return this.#matchup;
  }

  /** The difficulty and modules of the game on the table, as it was dealt. */
  get encounter(): { difficulty: Difficulty; modules: readonly ModuleId[] } {
    return this.#encounter;
  }

  reset(options: DealOptions = {}): void {
    this.#matchup = { hero: options.hero ?? "spider-man", villain: options.villain ?? "rhino" };
    this.#encounter = {
      difficulty: options.difficulty ?? "standard",
      modules: options.modules ?? [recommendedModule(this.#matchup.villain)],
    };
    this.#history = [];
    this.#events = [];
    this.#villainActivity = "";
    this.#aimed = new Set();
    this.#effectAttack = null;
    this.#beats = [];
    this.#dronesDefeated = new Map();
    const opening = openingTurn(options);
    this.#setup = opening.setup;
    this.#setGame(opening.state, opening.state.players[0]!.hand);
  }

  #setGame(state: GameState, drawn: readonly string[]): void {
    const hand = state.players[0]!.hand;
    const newCards = hand.filter((id) => drawn.includes(id)).sort((a, b) => drawn.indexOf(b) - drawn.indexOf(a));
    this.#handOrder = [...new Set([...newCards, ...this.#handOrder.filter((id) => hand.includes(id)), ...hand])];
    this.#drawn = drawn;
    this.#game = state;
    this.#actions = legalActions(state, state.players[0]!.playerId, CORE_DEPS);
    this.#plays.clear();
    if (this.#actions.kind === "turn") {
      for (const entry of this.#actions.legal) {
        if (entry.action.kind === "playCard") this.#plays.set(entry.action.instanceId, entry);
      }
    }
    this.#clearPayment();
  }

  #accept(result: ReturnType<typeof apply>): void {
    // Engine states are immutable. Automatic effects and forced single-target choices belong to this move.
    this.#history.push({
      game: this.#game,
      handOrder: this.#handOrder,
      activity: this.#villainActivity,
      beats: this.#beats,
      aimed: new Set(this.#aimed),
      effectAttack: this.#effectAttack,
      dronesDefeated: new Map(this.#dronesDefeated),
      events: this.#events.length,
    });
    const events = [...result.events];
    for (;;) {
      const choice = result.state.pendingChoice;
      if (
        !choice ||
        !["chooseTarget", "chooseAttachmentTarget", "chooseBasicPowerTarget", "choosePlayer"].includes(
          choice.prompt.kind,
        ) ||
        choice.minSelections !== 1 ||
        choice.maxSelections !== 1 ||
        choice.options.length !== 1
      )
        break;
      const only = choice.options[0]!;
      const next = applyCommand(
        result.state,
        {
          type: "resolveChoice",
          playerId: choice.playerId,
          choiceId: choice.choiceId,
          selectedOptionIds: [only.optionId],
        },
        CORE_DEPS,
      );
      if (!next.ok) break;
      events.push(...next.events);
      result = next;
    }
    const drawn = events.flatMap((event) => (event.type === "cardDrawn" ? [event.instanceId] : []));
    let enemy = this.#game.step.phase === "villain";
    // Facedown Drones, from before this move or put into play during it: each is "Drone" in every line until it is
    // defeated, even when it is already faceup in the discard pile by the end of the move (it attacks, then dies to
    // the answer, all in one villain phase).
    const drones = new Set<string>(
      this.#game.players.flatMap((seat) => seat.playArea.filter((id) => isFacedownMinion(this.#game, id))),
    );
    const name = (id: InstanceId) =>
      drones.has(id) ? DRONE_NAME : (shortIdentityNameOf(result.state, id) ?? faceUpName(result.state, id));
    /** The cards these events put into play facedown as minions: each is seen leaving its pile as it moves. */
    const facedownPuts = new Set<string>(
      events.flatMap((e) => (e.type === "cardPutIntoPlayFacedown" && e.as === "minion" ? [e.instanceId] : [])),
    );
    // The main scheme is one card through all its stages: until it advances in these events, it is still called by
    // the stage it was on (the threat that completes Underground Distribution goes on Underground Distribution).
    const mainId = this.#game.mainScheme.instanceId;
    let mainStageName = faceUpName(this.#game, mainId);
    const schemeName = (id: InstanceId) => (id === mainId ? mainStageName : name(id));
    // Cards that come in face up off the encounter deck are presented by their reveal; the rest just enter play.
    const revealedHere = new Set(
      events.flatMap((e) =>
        e.type === "encounterCardRevealed" || e.type === "boostCardFlipped" ? [e.instanceId] : [],
      ),
    );
    this.#beats = [];
    const toughAttacks = new Set<string>();
    // Surge deals its extra card first and names the surging card just after; pair them up so the table can say
    // "surge" before the card flies out (RRG 1.8 "Surge").
    const surgeOf = new Map<string, InstanceId>();
    events.forEach((e, i) => {
      if (e.type !== "encounterCardDealt" || e.source !== "surge") return;
      const next = events.slice(i + 1).find((later) => later.type === "surgeTriggered");
      if (next?.type === "surgeTriggered") surgeOf.set(e.instanceId, next.instanceId);
    });
    const defeated = new Set(
      events.flatMap((e) =>
        e.type === "characterDefeated" || e.type === "schemeDefeated" ? [e.instanceId as string] : [],
      ),
    );
    // The card whose ability is resolving: its effects (Black Cat discarding from the deck) are its doing.
    let resolving: { card: InstanceId; label: string } | null = null;
    // The card whose question this move answers (Eviction Notice's "Choose one"): what follows is still its doing.
    const answered = this.#game.pendingChoice;
    const askedBy = answered ? (choiceSourceOf(this.#game, answered)?.instanceId ?? null) : null;
    const asking = askedBy ? { card: askedBy } : null;
    const millSourceOf = (source: { card: InstanceId; label: string }) => {
      const card = cardOf(result.state, source.card) ?? cardOf(this.#game, source.card);
      const miss = card ? missLineOf(plainRulesTextOf(card)) : null;
      return { ...source, ...(miss ? { miss } : {}) };
    };
    /** Its text discards from a deck ("Discard the top card of your deck for each ...", Black Cat's "top 2 cards"). */
    const millsDeck = (id: InstanceId) => {
      const card = cardOf(result.state, id) ?? cardOf(this.#game, id);
      return !!card && /\bdiscards? the top\b[^.]*\bdeck\b/i.test(plainRulesTextOf(card));
    };
    // The revealed card whose effect discards from the deck (Rage of Ultron, Invasive AI): its discard is its own,
    // though another ability resolved in the middle of it (Spider-Sense, drawn as Rage of Ultron's attack began).
    // A card revealed on an earlier move and still resolving (its attack stopped to ask about Spider-Sense) counts too.
    const stillRevealed = this.#game.players[0]!.dealtEncounter.find(
      (id) => getInstance(this.#game, id)?.faceup && millsDeck(id),
    );
    let milling: { card: InstanceId; label: string } | null = stillRevealed
      ? { card: stillRevealed, label: "When Revealed" }
      : null;
    // How many cards the player's deck was just shuffled from (a reset reports it just after).
    let shuffledDeck: number | null = null;
    // An encounter deck shuffle is a run-out reset when an acceleration token follows it (effects.ts
    // resetEncounterDeckIfEmpty); other shuffles (a search, a card shuffled in) are not.
    const resets = new Set(
      events.filter(
        (e, i) =>
          e.type === "deckShuffled" &&
          e.zone.kind === "encounterDeck" &&
          events
            .slice(i + 1, i + 4)
            .some((later) => later.type === "accelerationTokenAdded" || later.type === "accelerationTokenRedirected"),
      ),
    );
    const heldReset: BattleBeat[] = [];
    // A stunned enemy's attack: its activation is followed by the stun being discarded instead, with no attack in
    // between (RRG 1.8 'Stun'). It is shown straining against the stun, not aiming at the hero it never reaches.
    const stunnedAttempts = new Set<(typeof events)[number]>();
    events.forEach((e, i) => {
      if (e.type !== "enemyActivated" || e.activation !== "attack") return;
      for (const later of events.slice(i + 1)) {
        if (later.type === "enemyActivated" || later.type === "attackResolved") return;
        if (
          later.type === "statusRemoved" &&
          later.status === "stunned" &&
          later.reason === "cancelledAttack" &&
          later.instanceId === e.enemyInstanceId
        ) {
          stunnedAttempts.add(e);
          return;
        }
      }
    });
    // An attack a card makes happen, aimed only once the attack goes ahead (see where it is set).
    let heldAim: { attacker: string; activity: string; beat: BattleBeat } | null = null;
    let acceleration = this.#game.mainScheme.accelerationTokens;
    let round = this.#game.round;
    // The cards in the player's deck as these events go by, for the count a Drone leaves behind.
    let deckLeft = this.#game.players[0]!.deck.length;
    // The player is eliminated: their hand, deck and cards in play are cleared away (RRG 1.8 "Player Elimination"),
    // which is no discard for the table to play out card by card before the game ends. The engine clears them just
    // before it reports the elimination: every card move between the damage that did it and that report.
    const clearedAway = new Set<(typeof events)[number]>();
    const eliminatedAt = events.findIndex((e) => e.type === "playerEliminated");
    for (let i = eliminatedAt - 1; i >= 0; i--) {
      const earlier = events[i]!;
      if (earlier.type === "damageDealt" || earlier.type === "damagePlaced") break;
      if (earlier.type === "cardMoved") clearedAway.add(earlier);
    }
    for (const e of events) {
      if (e.type === "roundStarted") {
        round = e.round;
        // The engine starts the new round just after its hero phase: that phase belongs to it.
        const heroPhase = [...this.#beats].reverse().find((beat) => beat.phase);
        if (heroPhase?.phase === "hero" && (heroPhase.round ?? 0) < round) heroPhase.round = round;
      }
      const before = this.#beats.length;
      if (clearedAway.has(e)) continue;
      // Out of the discard pile again (shuffled into a new deck, taken back into the hand), it is a card like any other.
      if (e.type === "playerDeckReset") this.#dronesDefeated.clear();
      else if (e.type === "cardMoved" && e.from.kind === "discard") this.#dronesDefeated.delete(e.instanceId);
      if (e.type === "deckShuffled" && e.zone.kind === "deck") shuffledDeck = deckLeft = e.order.length;
      // Every card that leaves the deck is a move off it, a draw included (the engine reports the draw as well).
      else if (e.type === "cardMoved" && e.from.kind === "deck" && !facedownPuts.has(e.instanceId)) deckLeft--;
      if (e.type === "abilityResolved") resolving = { card: e.instanceId, label: triggerLabel(e.abilityId) };
      // Only the ability that resolved last owns what follows; a move into play or a new step ends its say.
      else if (e.type === "stepChanged" || e.type === "cardPlayed") resolving = null;
      if (
        e.type === "stepChanged" &&
        e.to.phase === "villain" &&
        (e.from.phase !== e.to.phase || e.from.kind !== e.to.kind)
      ) {
        switch (e.to.kind) {
          case "placeThreat":
            this.#villainActivity = "Place threat";
            break;
          case "dealEncounterCards":
            this.#villainActivity = "Deal encounter cards";
            break;
          case "revealEncounterCards":
            this.#villainActivity = "Reveal encounter cards";
            break;
          default:
            this.#villainActivity = "Villain phase";
        }
      }

      let text: string | undefined;
      let actor: InstanceId | null = null;
      if (e.type === "cardDrawn") {
        const last = this.#beats.at(-1);
        if (last?.draw) last.draw.push(e.instanceId);
        else this.#beats.push({ text: "Draw into hand", enemy, draw: [e.instanceId] });
      } else if (e.type === "stepChanged") {
        if (e.to.phase !== "player" && e.to.phase !== "villain") continue;
        const villainPhase = e.to.phase === "villain";
        if (villainPhase !== enemy || (e.from.phase === "setup" && !villainPhase))
          this.#beats.push({
            enemy: villainPhase,
            text: villainPhase ? "Villain Phase" : "Hero Phase",
            phase: villainPhase ? "villain" : "hero",
            round,
          });
        enemy = villainPhase;
      } else if (e.type === "gameEnded") {
        this.#beats.push({ enemy, text: "", gameEnded: true });
      } else if (e.type === "villainStageAdvanced" || e.type === "villainStageRevealed") {
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          villainStage: e.stageIndex + 1,
          text: `${name(e.instanceId)} · Stage ${e.stageIndex + 1}`,
          ...(e.type === "villainStageAdvanced"
            ? { defeat: `${faceUpName(this.#game, e.instanceId)} · Stage ${e.stageIndex} defeated` }
            : {}),
        });
      } else if (e.type === "mainSchemeAdvanced" && !e.schemeInstanceId) {
        const card = cardOf(result.state, mainId);
        const stage = card?.type === "main_scheme" ? card.stages[e.stageIndex] : undefined;
        const from = mainStageName;
        mainStageName = stage?.name ?? card?.name ?? name(mainId);
        const players = result.state.players.length;
        const amount = (value: { base: number; perPlayer: number } | undefined) =>
          value ? value.base + value.perPlayer * players : 0;
        this.#beats.push({
          enemy,
          actor: mainId,
          text: `${from} is completed: the main scheme advances to ${mainStageName}`,
          schemeAdvance: {
            scheme: mainId,
            from,
            to: mainStageName,
            stage: stage?.stageNumber ?? e.stageIndex + 1,
            // The engine turns it over with no threat, then places the stage's starting threat on a beat of its own.
            threat: 0,
            target: stage?.targetThreat ? amount(stage.targetThreat) : null,
          },
        });
      } else if (
        e.type === "cardMoved" &&
        e.to.kind === "playArea" &&
        (e.from.kind === "encounterDeck" || e.from.kind === "encounterDiscard" || e.from.kind === "setAside") &&
        !revealedHere.has(e.instanceId) &&
        cardOf(result.state, e.instanceId)?.type === "minion"
      ) {
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          text: `${name(e.instanceId)} enters play`,
          entersPlay: e.instanceId,
        });
      } else if (
        e.type === "cardMoved" &&
        e.to.kind === "playArea" &&
        (e.from.kind === "deck" || e.from.kind === "discard") &&
        facedownPuts.has(e.instanceId)
      ) {
        // The card leaves its pile here: when it was the deck's last, the reset that follows (the discard pile
        // shuffled into a new deck, an encounter card dealt) plays after the Drone has gone, as it happens.
        const fromDeck = e.from.kind === "deck";
        drones.add(e.instanceId);
        const source = resolving?.card ?? askedBy;
        if (fromDeck) deckLeft--;
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          text: fromDeck
            ? "The top card of your deck goes into play facedown as a Drone minion"
            : "The top card of your discard pile goes into play facedown as a Drone minion",
          droneIn: {
            card: droneCard(e.instanceId),
            from: fromDeck ? "deck" : "discard",
            source: source && source !== e.instanceId ? source : null,
            deckCount: Math.max(0, deckLeft),
          },
        });
      } else if (e.type === "villainFlipped") {
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          villainFlip: true,
          text: `${name(e.instanceId)} · Side ${e.to.toUpperCase()}`,
        });
      } else if (e.type === "characterDefeated" || e.type === "schemeDefeated") {
        const drone = e.type === "characterDefeated" && e.facedownAs?.kind === "minion";
        const type = drone
          ? "minion"
          : (cardOf(result.state, e.instanceId)?.type ?? cardOf(this.#game, e.instanceId)?.type);
        if (drone) {
          // The Drone is defeated and the card under it is known at last, on its way to its owner's discard pile.
          drones.delete(e.instanceId);
          const was = cardOf(result.state, e.instanceId)?.name ?? "a card";
          this.#dronesDefeated.set(e.instanceId, was);
          this.#beats.push({
            enemy,
            defeatedCard: e.instanceId,
            text: `${DRONE_NAME} defeated: it was ${was}, now in your discard pile`,
            droneWas: was,
          });
        } else if (type === "villain" && e.type === "characterDefeated") {
          const defeat = `${name(e.instanceId)} defeated`;
          this.#beats.push({ enemy, actor: e.instanceId, text: defeat, defeat });
        } else if (e.type === "schemeDefeated" || type === "minion" || type === "ally") {
          this.#beats.push({ enemy, defeatedCard: e.instanceId, text: `${name(e.instanceId)} is defeated` });
        }
      } else if (e.type === "encounterCardDealt" || e.type === "boostCardDealt") {
        const surging = e.type === "encounterCardDealt" ? surgeOf.get(e.instanceId) : undefined;
        if (surging) this.#beats.push({ enemy, actor: surging, text: `${name(surging)} surges`, surge: surging });
        this.#beats.push({
          enemy,
          text:
            e.type === "boostCardDealt" ? `Deal a boost card to ${name(e.enemyInstanceId)}` : "Deal an encounter card",
          encounterDeal: e.instanceId,
          ...(e.type === "boostCardDealt" ? { boostFor: e.enemyInstanceId } : {}),
          ...(e.type === "encounterCardDealt" && e.source === "deckReset" ? { penalty: true } : {}),
        });
        this.#beats.push(...heldReset.splice(0));
      } else if (e.type === "encounterCardRevealed" || e.type === "boostCardFlipped") {
        const card = cardOf(result.state, e.instanceId) ?? cardOf(this.#game, e.instanceId);
        if (card?.type === "villain" && e.type === "encounterCardRevealed") continue;
        if (e.type === "encounterCardRevealed")
          milling = millsDeck(e.instanceId) ? { card: e.instanceId, label: "When Revealed" } : null;
        const title = card?.name ?? name(e.instanceId);
        // Revealed by another card's ability rather than dealt (Shadow of the Past bringing in Vulture): it says so.
        const broughtBy =
          e.type === "encounterCardRevealed" && resolving && resolving.card !== e.instanceId
            ? name(resolving.card)
            : "";
        const nemesis = isNemesisCard(card);
        this.#beats.push({
          enemy,
          text: e.type === "boostCardFlipped" ? `Boost card · ${title}` : `Reveal ${title}`,
          reveal: {
            id: e.instanceId,
            name: title,
            ...(broughtBy ? { broughtBy } : {}),
            ...(nemesis ? { nemesis: true as const } : {}),
            boost: e.type === "boostCardFlipped" ? { icons: e.boostIcons, enemy: e.enemyInstanceId } : null,
            art: artFor(card, { kind: "front" })?.url ?? "",
            landscape: isLandscapeType(card?.type ?? ""),
            quick: card?.type === "minion",
            whenRevealed: !!card && /\bWhen Revealed\b/i.test(plainRulesTextOf(card)),
            ...(card && e.type === "encounterCardRevealed"
              ? formWhenRevealed(plainRulesTextOf(card), result.state.players[0]!.identity.form)
              : {}),
            ...(card &&
            e.type === "encounterCardRevealed" &&
            whenRevealedMissesHeroes(plainRulesTextOf(card), result.state.players[0]!.identity.form)
              ? { noHeroes: true as const }
              : {}),
          },
        });
      } else if (
        e.type === "cardMoved" &&
        ["playArea", "villainArea", "attachment", "scenarioPlayArea"].includes(e.from.kind) &&
        (e.to.kind === "discard" ||
          e.to.kind === "encounterDiscard" ||
          (e.to.kind === "removedFromGame" && e.from.kind === "playArea"))
      ) {
        // A defeat already sends the card to its pile; anything else that leaves play goes there on its own beat. One
        // removed from the game out of a player's area leaves the table the same way (Eviction Notice, when Peter
        // Parker exhausts for it). A main scheme stage or the villain's card swapped out is shown by its own beat.
        if (!defeated.has(e.instanceId))
          this.#beats.push({
            enemy,
            actor: e.instanceId,
            text: `${drones.has(e.instanceId) ? DRONE_NAME : faceUpName(this.#game, e.instanceId)} ${e.to.kind === "removedFromGame" ? "is removed from the game" : "is discarded"}`,
            leftPlay: e.instanceId,
            ...(e.to.kind === "removedFromGame" ? { removedFromGame: true } : {}),
          });
      } else if (e.type === "cardMoved" && e.from.kind === "hand" && e.to.kind === "discard") {
        const last = this.#beats.at(-1);
        if (last?.handDiscard) last.handDiscard.push(e.instanceId);
        else
          this.#beats.push({
            enemy,
            text: "Discard from your hand",
            handDiscard: [e.instanceId],
            ...(pickedAtRandom(result.state, resolving ?? asking) ? { random: true as const } : {}),
          });
      } else if (e.type === "cardMoved" && e.from.kind === "deck" && e.to.kind === "discard") {
        const last = this.#beats.at(-1);
        if (last?.milled) last.milled.push(e.instanceId);
        else
          this.#beats.push({
            enemy,
            text: "Discard from the top of your deck",
            milled: [e.instanceId],
            ...(resolving && millsDeck(resolving.card)
              ? { millSource: millSourceOf(resolving) }
              : milling
                ? { millSource: millSourceOf(milling) }
                : resolving
                  ? { millSource: millSourceOf(resolving) }
                  : {}),
          });
      } else if (e.type === "cardMoved" && e.from.kind === "encounterDeck" && e.to.kind === "encounterDiscard") {
        const last = this.#beats.at(-1);
        if (last?.encounterMilled) last.encounterMilled.push(e.instanceId);
        else
          this.#beats.push({
            enemy,
            text: "Discard from the top of the encounter deck",
            encounterMilled: [e.instanceId],
            ...(resolving ? { millSource: millSourceOf(resolving) } : {}),
          });
      } else if (e.type === "cardMoved" && e.from.kind === "hand" && e.to.kind === "tucked") {
        const host = e.to.hostInstanceId;
        const last = this.#beats.at(-1);
        const count = result.state.instances[host]?.tucked.length ?? 0;
        if (last?.tucked?.host === host) {
          last.tucked.ids.push(e.instanceId);
          last.tucked.count = count;
        } else
          this.#beats.push({
            enemy,
            actor: host,
            text: `A card from your hand goes facedown under ${name(host)}`,
            tucked: { ids: [e.instanceId], host, count },
            ...(pickedAtRandom(result.state, resolving ?? asking) ? { random: true as const } : {}),
          });
      } else if (e.type === "cardMoved" && e.to.kind === "hand" && e.from.kind !== "deck") {
        const from = e.from.kind === "tucked" ? e.from.hostInstanceId : undefined;
        const last = this.#beats.at(-1);
        if (last?.returned && last.returnedFrom === from) last.returned.push(e.instanceId);
        else
          this.#beats.push({
            enemy,
            text: "Return to your hand",
            returned: [e.instanceId],
            ...(from ? { returnedFrom: from } : {}),
          });
      } else if (e.type === "playerDeckReset") {
        this.#beats.push({
          enemy,
          text: "Your deck ran out: shuffle your discard pile into a new deck",
          deckReset: shuffledDeck ?? this.#game.players[0]!.discard.length,
        });
      } else if (e.type === "cardMoved" && e.from.kind === "setAside" && e.to.kind === "encounterDeck") {
        const last = this.#beats.at(-1);
        // Cards of a nemesis set (Shadow of the Past bringing in the rest of Vulture's) are named as such.
        const card = cardOf(result.state, e.instanceId);
        const nemesis = isNemesisCard(card);
        if (last?.intoEncounterDeck) {
          last.intoEncounterDeck.push(this.#shownCard(e.instanceId));
          if (!nemesis) delete last.nemesis;
        } else
          this.#beats.push({
            enemy,
            text: "Shuffle into the encounter deck",
            intoEncounterDeck: [this.#shownCard(e.instanceId)],
            ...(nemesis ? { nemesis: true as const } : {}),
          });
      } else if (e.type === "deckShuffled" && resets.has(e)) {
        // The deck ran out and its discard pile is the new deck. The engine reshuffles inside the deal that took the
        // last card, before reporting that deal: held back, it plays just after it, as it happened on the table.
        heldReset.push({
          enemy,
          text: "The encounter deck ran out: shuffle its discard pile back in",
          encounterReset: e.order.length,
        });
      } else if (e.type === "accelerationTokenAdded") {
        // Also reported when a token comes off (a lower total).
        const added = e.total > acceleration;
        acceleration = e.total;
        (heldReset.length ? heldReset : this.#beats).push({
          enemy,
          actor: e.schemeInstanceId ?? result.state.mainScheme.instanceId,
          text: `${added ? "+1" : "−1"} acceleration token (${e.total} in all)`,
          acceleration: e.total,
        });
      } else if (e.type === "overkillSpilled") {
        this.#beats.push({
          enemy,
          actor: e.toInstanceId,
          text: `Overkill: ${e.amount} damage spills onto ${name(e.toInstanceId)}`,
          overkill: { to: e.toInstanceId, amount: e.amount },
        });
      } else if (e.type === "lastingEffectAdded" && e.effect.kind === "costReduction") {
        this.#beats.push({
          enemy,
          text: `The next card you play costs ${e.effect.amount} less`,
          discount: { amount: e.effect.amount, source: resolving?.card ?? null },
        });
      } else if (e.type === "choiceFoundNothing") {
        const what = e.slot === "scheme" ? "scheme" : e.slot === "minion" ? "minion" : "target";
        this.#beats.push({
          enemy,
          text: `${resolving ? name(resolving.card) + ": no" : "No"} ${what} to choose`,
          nothingFound: { slot: e.slot, source: resolving?.card ?? null },
        });
      } else if (e.type === "cardMoved" && e.from.kind === "dealtEncounter" && e.to.kind === "encounterDiscard") {
        // A revealed treachery is discarded once its When Revealed has fully resolved (RRG 1.8 "Treachery"): after
        // the attack Assault makes, after the card its surge deals. It stays on the table until this beat.
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          text: `${name(e.instanceId)} goes to the encounter discard pile`,
          encounterResolved: e.instanceId,
        });
      } else if (
        e.type === "triggerEvent" &&
        e.event.kind === "enemyAttack" &&
        e.phase !== "resolved" &&
        !this.#aimed.delete(e.event.enemyInstanceId)
      ) {
        // An attack a card makes happen (Assault's "The villain attacks you") has no activation of its own: it is
        // aimed here, the way an activation's attack is, so the table shows who attacks whom before it resolves.
        // It is held until the attack itself goes ahead: Vulture's Quickstrike is triggered as Shadow of the Past puts
        // him into play, but waits for the rest of Shadow (Highway Robbery, the shuffle) to resolve first. Aimed at
        // once, Spider-Man would sit under the reticle through all of that with no attack in sight.
        const attacker = e.event.enemyInstanceId;
        const card = drones.has(attacker) ? undefined : cardOf(result.state, attacker);
        const quickstrike = !!card && /\bQuickstrike\b/i.test(plainRulesTextOf(card));
        this.#effectAttack = { enemy: attacker, activity: this.#villainActivity };
        heldAim = {
          attacker,
          activity: `${quickstrike ? "Quickstrike: " : ""}${name(attacker)} attacks`,
          beat: {
            enemy,
            actor: attacker,
            text: `Target: ${name(e.event.targetInstanceId)}`,
            attackAim: { source: attacker, target: e.event.targetInstanceId },
            enemyActivation: attacker,
          },
        };
      } else if (
        e.type === "triggerEvent" &&
        e.event.kind === "enemyAttack" &&
        e.phase === "resolved" &&
        this.#effectAttack?.enemy === e.event.enemyInstanceId
      ) {
        this.#villainActivity = this.#effectAttack.activity;
        this.#effectAttack = null;
      } else if (e.type === "cardMoved" && e.from.kind === "resolving" && e.to.kind === "discard") {
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          text: `Discard ${name(e.instanceId)}`,
          discardEvent: e.instanceId,
        });
      } else if (e.type === "cardPlayed" && cardOf(result.state, e.instanceId)?.type === "event") {
        const hero = result.state.players[0]!.identity.instanceId;
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          text: `${name(hero)} activates ${name(e.instanceId)}`,
          activate: { card: e.instanceId, hero },
        });
      } else if (e.type === "abilityResolved" && CORE_DEPS.abilities[e.abilityId]?.trigger.kind === "interrupt") {
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          interrupt: e.instanceId,
          text: `${name(e.instanceId)} interrupts`,
        });
      } else if (e.type === "threatPrevented" && e.amount > 0) {
        // Threat that never lands ("I Object!", Emergency) leaves no threat change behind: the log says it was kept off.
        this.#beats.push({
          enemy,
          actor: e.schemeInstanceId,
          text: `${e.amount} threat kept off ${name(e.schemeInstanceId)}`,
        });
      } else if (e.type === "damagePrevented" && e.preventerInstanceId && e.amount > 0) {
        this.#beats.push({
          enemy,
          actor: e.preventerInstanceId,
          text: `${name(e.preventerInstanceId)} prevents ${e.amount} damage`,
          deflection: { card: e.preventerInstanceId, amount: e.amount },
        });
      } else if (
        (e.type === "damageDealt" ||
          e.type === "damagePlaced" ||
          (e.type === "damagePrevented" && e.reason === "tough")) &&
        e.amount > 0
      ) {
        const tough = e.type === "damagePrevented";
        const sourceId = tough ? (e.attackSourceInstanceId ?? null) : e.sourceInstanceId;
        // A Drone's damage is the Drone's: the card under it (an attack event, say) has no say in whose it is.
        const source = sourceId && !drones.has(sourceId) ? cardOf(result.state, sourceId) : undefined;
        const attacker =
          source?.type === "event" &&
          source.abilities.some((ref) => CORE_DEPS.abilities[ref.id]?.label?.includes("attack"))
            ? result.state.players[0]!.identity.instanceId
            : sourceId;
        if (tough && attacker) toughAttacks.add(attacker);
        this.#beats.push({
          enemy,
          actor: attacker,
          text: tough
            ? `Tough prevents ${e.amount} damage to ${name(e.targetInstanceId)}`
            : e.type === "damagePlaced"
              ? `${e.amount} damage lands on ${name(e.targetInstanceId)}`
              : sourceId
                ? `${name(sourceId)} deals ${e.amount} damage to ${name(e.targetInstanceId)}`
                : `${name(e.targetInstanceId)} takes ${e.amount} damage`,
          hit: {
            source: attacker,
            target: e.targetInstanceId,
            amount: tough ? 0 : e.amount,
            ...(tough ? { tough: true } : {}),
          },
        });
      } else if (e.type === "counterAdded" || e.type === "counterRemoved" || e.type === "damageHealed") {
        const id = e.type === "damageHealed" ? e.targetInstanceId : e.instanceId;
        const counter = e.type === "damageHealed" ? "damage" : e.counterType;
        const delta = e.type === "counterAdded" ? e.amount : -e.amount;
        if (delta)
          this.#beats.push({
            enemy,
            actor: id,
            text: `${name(id)} · ${delta > 0 ? "+" : ""}${delta} ${counter}`,
            statusChange: { id, name: counter, delta },
          });
      } else if (e.type === "statusGiven" || e.type === "statusRemoved") {
        if (e.type === "statusRemoved" && e.status === "tough" && e.reason === "preventedDamage") continue;
        if (e.type === "statusRemoved" && e.status === "stunned" && e.reason === "cancelledAttack") {
          this.#beats.push({
            enemy,
            actor: e.instanceId,
            statusChange: { id: e.instanceId, name: e.status, delta: -1 },
            text: `${name(e.instanceId)} is no longer stunned`,
          });
          continue;
        }
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          statusChange: { id: e.instanceId, name: e.status, delta: e.type === "statusGiven" ? 1 : -1 },
          text: `${name(e.instanceId)} ${e.type === "statusGiven" ? "gains" : "loses"} ${e.status}`,
        });
      } else if (e.type === "cardExhausted" || e.type === "cardReadied") {
        const exhausted = e.type === "cardExhausted";
        // A card defeated in the same move (an ally killed by the damage its attack brings back) isn't shown turning
        // sideways first: it attacks, takes the damage and goes (Adam, 2026-11-23).
        if (exhausted && defeated.has(e.instanceId)) continue;
        this.#beats.push({
          enemy,
          text: `${name(e.instanceId)} ${exhausted ? "exhausts" : "readies"}`,
          turned: { id: e.instanceId, exhausted },
        });
      } else if (e.type === "threatPlaced" || e.type === "threatRemoved") {
        const placed = e.type === "threatPlaced";
        this.#beats.push({
          enemy,
          actor: e.sourceInstanceId ?? e.schemeInstanceId,
          text: placed
            ? e.sourceInstanceId && e.sourceInstanceId !== e.schemeInstanceId
              ? `${name(e.sourceInstanceId)} places ${e.amount} threat on ${schemeName(e.schemeInstanceId)}`
              : `${schemeName(e.schemeInstanceId)} gains ${e.amount} threat`
            : `Remove ${e.amount} threat from ${schemeName(e.schemeInstanceId)}`,
          threat: { scheme: e.schemeInstanceId, delta: placed ? e.amount : -e.amount },
        });
      } else if (enemy) {
        switch (e.type) {
          case "enemyActivated":
            actor = e.enemyInstanceId;
            this.#villainActivity = `${name(e.enemyInstanceId)} ${e.activation === "attack" ? "attacks" : "schemes"}`;
            text =
              e.activation === "attack"
                ? `Target: ${name(result.state.players[0]!.identity.instanceId)}`
                : `Target: ${schemeName(result.state.mainScheme.instanceId)}`;
            if (e.activation === "attack" && stunnedAttempts.has(e)) {
              // It tries, but the stun holds it back: no aim at the hero (Adam, 2026-11-23).
              this.#beats.push({
                enemy,
                actor,
                text: `${name(actor)} tries to attack, but is stunned`,
                stunnedAttempt: actor,
              });
              text = undefined;
            } else if (e.activation === "attack") {
              const target = result.state.players.find((p) => p.playerId === e.playerId)?.identity.instanceId;
              if (target) {
                this.#beats.push({
                  enemy,
                  actor,
                  text: `Target: ${name(target)}`,
                  attackAim: { source: actor, target },
                });
                this.#aimed.add(actor);
                text = undefined;
              }
            }
            break;
          case "schemeResolved":
            actor = e.enemyInstanceId;
            text = `${e.baseSch} SCH · ${e.boostIcons} boost${e.threatBonus ? " · " + (e.threatBonus > 0 ? "+" : "") + e.threatBonus + " modifier" : ""} · ${e.threatPlaced} threat`;
            break;
          case "boostIconsCounted":
            text = `Count boost icons · +${e.count}`;
            break;
          case "defenderDeclared":
            text = `${name(e.defenderInstanceId)} defends`;
            break;
          case "defenseDeclined":
            text = "The attack is undefended";
            break;
          case "attackResolved":
            if (!toughAttacks.delete(e.enemyInstanceId) && !e.damageDealt) {
              this.#beats.push({
                enemy,
                text: "The attack deals no damage",
                hit: { source: e.enemyInstanceId, target: e.targetInstanceId, amount: 0 },
              });
            }
            break;
          case "activationBlocked":
          case "activationSkipped":
            text = `${name(e.enemyInstanceId)} skips activation`;
            break;
        }
      }
      if (text)
        this.#beats.push({
          enemy,
          text,
          actor,
        });
      if (e.type === "enemyActivated" && this.#beats.length > before) {
        this.#beats.at(-1)!.enemyActivation = e.enemyInstanceId;
        if (e.activation !== "attack") this.#beats.at(-1)!.scheming = e.enemyInstanceId;
      }
      if (heldAim && this.#beats.slice(before).some((beat) => partOfAttack(beat, heldAim!.attacker))) {
        this.#villainActivity = heldAim.activity;
        this.#beats.splice(before, 0, { ...heldAim.beat, activity: heldAim.activity });
        heldAim = null;
      }
      if (enemy && this.#beats.length > before) this.#beats[this.#beats.length - 1]!.activity = this.#villainActivity;
    }
    // Cards off the top of the deck are named, with the card that discarded them: the log is how a player (and the
    // play hook) knows what was lost.
    for (const beat of this.#beats) {
      if (!beat.milled) continue;
      const names = beat.milled.map((id) => cardOf(result.state, id as InstanceId)?.name ?? "a card").join(", ");
      const by = beat.millSource ? `${name(beat.millSource.card as InstanceId)}: d` : "D";
      beat.text = `${by}iscard ${beat.milled.length === 1 ? "the top card" : `the top ${beat.milled.length} cards`} of your deck (${names})`;
    }
    for (const beat of this.#beats) {
      if (!beat.encounterMilled) continue;
      const count = beat.encounterMilled.length;
      const names = beat.encounterMilled
        .map((id) => cardOf(result.state, id as InstanceId)?.name ?? "a card")
        .join(", ");
      const by = beat.millSource ? `${name(beat.millSource.card as InstanceId)}: d` : "D";
      beat.text = `${by}iscard ${count === 1 ? "the top card" : `the top ${count} cards`} of the encounter deck (${names})`;
    }
    // The attack waits on a question (whether to defend): it is aimed now, as the question asks.
    if (heldAim) {
      this.#villainActivity = heldAim.activity;
      this.#beats.push({ ...heldAim.beat, activity: heldAim.activity });
    }
    // The engine pays exhaustion first. Show the attacking card upright through contact and recoil.
    for (const beat of [...this.#beats]) {
      if (!beat.turned?.exhausted) continue;
      const id = beat.turned.id;
      const start = this.#beats.indexOf(beat);
      let impact = start;
      for (let i = start + 1; i < this.#beats.length; i++) {
        const next = this.#beats[i]!;
        if (next.phase || next.turned?.id === id) break;
        if (next.hit?.source === id) impact = i;
      }
      if (impact !== start) {
        this.#beats.splice(start, 1);
        this.#beats.splice(impact, 0, beat);
      }
    }
    const characters = (s: GameState) =>
      [
        ...s.players.flatMap((p) => [p.identity.instanceId, ...p.playArea]),
        ...s.villainArea,
        ...s.villains.map((v) => v.instanceId),
      ].filter((id) => ["hero_identity", "ally", "villain", "minion"].includes(shownType(s, id) ?? ""));
    const previous = new Set(characters(this.#game));
    const heroPhase = this.#beats.findIndex((b) => b.phase === "hero");
    let modifierIndex = heroPhase === -1 ? this.#beats.length : heroPhase;
    for (const id of new Set(characters(result.state))) {
      const old = previous.has(id) ? statModifiers(this.#game, id) : [];
      const current = statModifiers(result.state, id);
      for (const stat of new Set([...old, ...current].map((m) => m.name))) {
        const before = old.find((m) => m.name === stat)?.count ?? 0;
        const count = current.find((m) => m.name === stat)?.count ?? 0;
        if (count !== before)
          this.#beats.splice(modifierIndex++, 0, {
            enemy: heroPhase >= 0 || enemy,
            actor: id,
            modifier: { id, name: stat, count },
            text: count
              ? `${name(id)} now has ${count > 0 ? "+" : ""}${count} ${stat}`
              : `${name(id)} returns to printed ${stat}`,
          });
      }
    }
    this.#events.push(...events);
    this.#setGame(result.state, drawn);
  }

  /** A card shown faceup a moment as it moves between hidden places (a set-aside card shuffled into a deck). */
  #shownCard(id: InstanceId): BattleCard {
    const card = cardOf(this.#game, id);
    return {
      ...this.#card(id),
      name: card?.name ?? faceUpName(this.#game, id),
      art: artFor(card, { kind: "front" })?.url ?? "",
    };
  }

  /** A facedown Drone: a minion with the Drone picture, and nothing of the card under it. */
  #drone(id: InstanceId): BattleCard {
    const state = this.#game;
    const instance = getInstance(state, id);
    return {
      ...droneCard(id),
      markers: [
        ...Object.entries(instance?.statuses ?? {}).map(([name, count]) => ({ name, count })),
        { name: "damage", count: instance?.damage ?? 0 },
        { name: "threat", count: instance?.threat ?? 0 },
        ...countersOf(state, id),
      ]
        .filter((m) => m.count > 0)
        .concat(statModifiers(state, id)),
      hp: Math.max(0, remainingHitPoints(state, id, CORE_DEPS) ?? 0),
      exhausted: instance?.exhausted ?? false,
    };
  }

  /**
   * A reaction window's headline about a Drone that was just defeated ("After you defeat a minion", Interrogation
   * Room): by then the card lies faceup in the discard pile under its own name, but what the player defeated was a
   * Drone, and the question says so ("The Drone was defeated", not "The Power of Justice was defeated").
   */
  #droneHeadline(headline: string | undefined, pending: NonNullable<GameState["pendingChoice"]>): string | undefined {
    // A facedown Drone's own name is printed in capitals ("DRONE entered play", Hawkeye's arrow on one).
    headline = headline?.replace(/\bDRONE\b/g, DRONE_NAME);
    if (!headline || pending.prompt.kind !== "chooseTriggers") return headline;
    const event = answeredEventsOf(this.#game, pending)[0] ?? pending.prompt.event;
    if (event.kind !== "characterDefeated") return headline;
    const was = this.#dronesDefeated.get(event.instanceId);
    return was && headline.startsWith(was) ? `The ${DRONE_NAME}${headline.slice(was.length)}` : headline;
  }

  /**
   * Why the player's thwarts and cards can't remove threat from this scheme now, or null. RRG 1.8 "Crisis Icon"
   * (p. 14): while one is in play, player cards remove no threat from the main scheme; "Target" (p. 43): a scheme
   * that cannot be thwarted is no target for a thwart (Countdown to Oblivion 3B, "Threat cannot be removed from this
   * scheme").
   */
  #threatLock(id: InstanceId): string | null {
    const state = this.#game;
    const player = state.players[0]!;
    const hero = player.identity.instanceId;
    if (threatCannotBeRemoved(state, CORE_DEPS, id, true, player.playerId, hero, [hero]))
      return "Threat cannot be removed from this scheme";
    if (id !== state.mainScheme.instanceId) return null;
    const crisis = [...state.villainArea, ...player.playArea].find((other) => {
      const card = cardOf(state, other);
      return (
        card?.type === "side_scheme" &&
        "icons" in card &&
        ((card.icons as readonly string[] | undefined) ?? []).includes("crisis")
      );
    });
    return crisis ? `Crisis: no threat comes off the main scheme while ${faceUpName(state, crisis)} is in play` : null;
  }

  #card(id: InstanceId): BattleCard {
    const state = this.#game;
    if (isFacedownMinion(state, id)) return this.#drone(id);
    const viewer = state.players[0]!.playerId;
    const card = cardOf(state, id);
    const action = this.#plays.get(id);
    const blocked =
      this.#actions.kind === "turn" &&
      this.#actions.illegal.find((entry) => entry.action.kind === "playCard" && entry.action.instanceId === id);
    const instance = getInstance(state, id);
    const lock = card?.type === "main_scheme" || card?.type === "side_scheme" ? this.#threatLock(id) : null;
    const showAsFullCard =
      card?.type === "upgrade" &&
      (card.keywords.some((keyword) => keyword.name === "uses") ||
        Object.keys(instance?.counters ?? {}).length > 0 ||
        card.abilities.some(({ id }) => {
          const trigger = CORE_DEPS.abilities[id]?.trigger.kind;
          return trigger === "action" || trigger === "resource";
        }));
    const markers = instance
      ? [
          ...Object.entries(instance.statuses).map(([name, count]) => ({ name, count })),
          { name: "damage", count: instance.damage },
          { name: "acceleration", count: state.mainScheme.instanceId === id ? state.mainScheme.accelerationTokens : 0 },
          ...(card?.type !== "main_scheme" && card?.type !== "side_scheme"
            ? [{ name: "threat", count: instance.threat }]
            : []),
          ...countersOf(state, id),
          { name: "tucked", count: instance.tucked.length },
        ].filter((m) => m.count > 0)
      : [];
    return {
      id,
      attachedTo: instance?.attachedTo ?? null,
      showAsFullCard,
      markers: ["ally", "hero_identity", "villain", "minion"].includes(card?.type ?? "")
        ? [...markers, ...statModifiers(state, id)]
        : markers,
      name: shortIdentityNameOf(state, id) ?? faceUpName(state, id),
      ...(card?.type === "minion" || card?.type === "ally"
        ? { hp: Math.max(0, remainingHitPoints(state, id, CORE_DEPS) ?? 0) }
        : {}),
      reverseArt:
        id === state.players[0]!.identity.instanceId
          ? (artFor(card, { kind: state.players[0]!.identity.form === "hero" ? "alterEgo" : "hero" })?.url ?? null)
          : null,
      threatTarget: card?.type === "main_scheme" ? schemePanel(state, id, CORE_DEPS, true).target : null,
      threat:
        card && ["main_scheme", "side_scheme", "player_side_scheme"].includes(card.type)
          ? (getInstance(state, id)?.threat ?? 0)
          : null,
      exhausted: getInstance(state, id)?.exhausted ?? false,
      landscape: isLandscapeType(card?.type ?? ""),
      art: artFor(card, faceOf(state, id, { viewer, deps: CORE_DEPS }))?.url ?? "",
      type: card?.type ?? "card",
      playable: !!action,
      requiresHeroForm: !!blocked && blocked.reason === "wrong_form" && state.players[0]!.identity.form === "alterEgo",
      cost: playCostOf(state, viewer, id, CORE_DEPS)?.current ?? null,
      reason:
        card?.type === "resource"
          ? "Spend this card to pay for another card."
          : blocked
            ? playerReason(card, blocked.message)
            : null,
      ...(lock ? { threatLock: lock } : {}),
    };
  }

  #priced() {
    return this.#payment
      ? paymentView(this.#game, this.#game.players[0]!.playerId, this.#payment, "", CORE_DEPS)
      : null;
  }

  #extraSpendMatters(id: InstanceId): boolean {
    const card = cardOf(this.#game, id);
    return (
      (!!card && "specialCost" in card && card.specialCost === "X") ||
      readsOverpaid(this.#game, CORE_DEPS, { kind: "playCard", instanceId: id })
    );
  }

  #windowPayment(): BattlePayment | null {
    const state = this.#game;
    const choice = state.pendingChoice;
    const prompt = choice?.prompt;
    if (!choice || (prompt?.kind !== "payForCard" && prompt?.kind !== "payForAbility")) return null;
    const sheet = paymentSheetView(state, choice, this.#windowPicks, CORE_DEPS)!;
    const cost = CORE_DEPS.abilities[prompt.abilityId]?.cost;
    const canAdd =
      !sheet.canConfirm ||
      this.#extraSpendMatters(prompt.instanceId) ||
      cost?.resourcesX !== undefined ||
      (prompt.kind === "payForAbility" && !!prompt.chosenResources && sheet.paid < prompt.chosenResources.max);
    const sources: BattlePayment["sources"] = [];
    for (const option of choice.options) {
      if (option.ref.kind !== "ability" && option.ref.kind !== "card") continue;
      const pool = paymentOptionsPool(state, CORE_DEPS, choice.playerId, [option.optionId], prompt.instanceId);
      sources.push({
        id: option.optionId,
        cardId: option.ref.instanceId,
        label: optionLabelOf(state, option),
        icons: RESOURCE_TYPES.flatMap((type) => Array<ResourceType>(pool?.[type] ?? 0).fill(type)),
        selected: this.#windowPicks.includes(option.optionId),
        available:
          canAdd ||
          this.#windowPicks.includes(option.optionId) ||
          (option.ref.kind === "ability" && CORE_DEPS.abilities[option.ref.abilityId]?.overpayOnly === true),
        kind: option.optionId.startsWith("hand:") ? "handCard" : "resourceAbility",
      });
    }
    return {
      ability: prompt.kind === "payForAbility",
      subject: this.#card(prompt.instanceId),
      required: prompt.kind === "payForAbility" && prompt.chosenResources ? prompt.chosenResources.min : sheet.cost,
      paid: sheet.paid,
      canPay: sheet.canConfirm,
      discards: this.#windowPicks.flatMap((id) =>
        sources.filter((s) => s.id === id && s.kind === "handCard").map((s) => s.cardId),
      ),
      sources,
    };
  }

  snapshot(): BattleSnapshot {
    if (this.#view) return this.#view;
    const state = this.#game;
    const player = state.players[0]!;
    const villain = state.villains[0]!;
    const priced = this.#priced();
    // "Spend X [energy] resources →" (Energy Channel): X is what is paid, so more can always go in, of that type.
    const spendX =
      this.#payment?.action.kind === "useAbility"
        ? CORE_DEPS.abilities[this.#payment.action.abilityId]?.cost?.resourcesX
        : undefined;
    const canAdd =
      !priced?.command ||
      !!spendX ||
      (this.#subject !== null && this.#extraSpendMatters(this.#subject)) ||
      (!!this.#payment?.query.chosenResources && priced.paid < this.#payment.query.chosenResources.max);
    // A fixed, typed ability cost cannot use an unrelated resource (e.g. energy for Tenacity).
    const typedAbility =
      this.#payment?.action.kind === "useAbility" &&
      !this.#payment.query.chosenResources &&
      CORE_DEPS.abilities[this.#payment.action.abilityId]?.cost?.resourcesX === undefined &&
      priced?.requirement.generic === 0 &&
      priced.required > 0;
    const payment =
      priced && this.#subject
        ? {
            // An upgrade being paid for already knows its host (Inspired on an ally): it waits by that card.
            subject: { ...this.#card(this.#subject), attachedTo: this.#payment?.target ?? null },
            ability: this.#payment?.action.kind === "useAbility",
            ...(spendX && spendX.resource !== "any" ? { spendX: spendX.resource } : {}),
            ...(this.#payment?.action.kind === "useAbility" && this.#subject === player.identity.instanceId
              ? {
                  used: `${faceUpName(state, this.#subject)} uses ${
                    abilityShortLabelOf(state, this.#subject, this.#payment.action.abilityId, CORE_DEPS) ?? "an ability"
                  }`,
                }
              : {}),
            outstanding: priced.outstanding,
            required: priced.required,
            paid: priced.paid,
            canPay: !!priced.command,
            discards: priced.sources
              .flatMap((source) =>
                source.discardOrder === null ? [] : [{ order: source.discardOrder, id: source.instanceId }],
              )
              .sort((a, b) => a.order - b.order)
              .map((source) => source.id),
            sources: priced.sources.map((source) => ({
              id: source.optionId,
              cardId: source.instanceId,
              label: source.label,
              icons: RESOURCE_TYPES.flatMap((icon) => Array<ResourceType>(source.pool[icon]).fill(icon)),
              selected: source.spent,
              available:
                source.spent ||
                (!source.lockedReason &&
                  (canAdd || source.overpayOnly === true) &&
                  (!spendX ||
                    spendX.resource === "any" ||
                    source.pool.wild > 0 ||
                    (source.pool[spendX.resource as ResourceType] ?? 0) > 0) &&
                  (!typedAbility ||
                    source.overpayOnly ||
                    source.pool.wild > 0 ||
                    RESOURCE_TYPES.some((type) => (priced.requirement[type] ?? 0) > 0 && source.pool[type] > 0))),
              kind: source.kind,
            })),
          }
        : this.#windowPayment();
    const pending = payment ? null : state.pendingChoice;
    const panel =
      pending && state.step.phase === "villain"
        ? choiceSourcePanelOf(state, pending, player.playerId, CORE_DEPS)
        : null;
    const revealed = panel?.abilityLine?.startsWith("When Revealed") ? panel : null;
    const trigger = pending && triggerWindowContextOf(state, pending, player.playerId, CORE_DEPS);
    const costDiscard = this.#costDiscard;
    const choice = costDiscard
      ? {
          id: `cost:${costDiscard.entry.action.kind === "useAbility" ? costDiscard.entry.action.abilityId : ""}`,
          prompt: `Discard ${costDiscard.min === costDiscard.max ? costDiscard.min : `${costDiscard.min} to ${costDiscard.max}`} to pay`,
          sourceTitle: faceUpName(state, this.#subject as InstanceId),
          options: costDiscard.candidates.map((id) => ({ id, label: faceUpName(state, id), cardId: id })),
          canSkip: false,
          canCancel: true,
          min: costDiscard.min,
          max: costDiscard.max,
          discardFromHand: true,
          mulligan: false,
        }
      : this.#targetPick
        ? {
            id: `target:${this.#targetPick.action.kind}`,
            prompt:
              this.#targetPick.action.kind === "basicAttack"
                ? "Choose an enemy to attack"
                : this.#targetPick.action.kind === "basicThwart"
                  ? "Choose a scheme to thwart"
                  : this.#targetPrompt(this.#targetPick),
            options: this.#targetPick.targets.map((id) => ({ id, label: faceUpName(state, id), cardId: id })),
            canSkip: false,
            canCancel: true,
            min: 1,
            max: 1,
            discardFromHand: false,
            mulligan: false,
          }
        : pending
          ? {
              id: pending.choiceId,
              prompt:
                this.#droneHeadline(trigger?.headline, pending) ??
                eitherOrTitle(state, pending) ??
                promptTitleOf(pending.prompt, CORE_DEPS, pending, state),
              ...(pending.prompt.kind === "declareDefender"
                ? {
                    prompt: pending.options.some((o) => o.ref.kind === "card")
                      ? "Choose a defender"
                      : "No defender available",
                    defense: {
                      attacker: faceUpName(state, pending.prompt.attack.enemyInstanceId),
                      attackerId: pending.prompt.attack.enemyInstanceId,
                      target: pending.prompt.attack.targetCharacterInstanceId,
                    },
                  }
                : {}),
              ...(revealed
                ? {
                    sourceTitle: `${revealed.name} · When Revealed`,
                    explanation: revealed.rulesText.split(/\n+/)[0]!.replace(/^When Revealed\s*:\s*/i, ""),
                  }
                : {}),
              // An encounter attachment choosing its host among equals (Biomechanical Upgrades: "Attach to the minion
              // with the highest printed hit points", two tied): the question names the card and says its rule.
              ...(!revealed && pending.prompt.kind === "chooseAttachmentTarget"
                ? attachQuestion(state, pending.prompt.instanceId, pending.options)
                : {}),
              ...(trigger && pending.prompt.kind === "chooseTriggers"
                ? {
                    // A merged window's headline names the first condition its options answer; spotlight that one.
                    event: triggerSubjectOf(
                      answeredEventsOf(state, pending)[0] ?? pending.prompt.event,
                      pending.prompt.timing === "interrupt",
                    ),
                    offers: pending.options.flatMap((option) => {
                      const ref = option.ref;
                      if (ref.kind !== "ability") return [];
                      const name =
                        activeAbilityRefs(state, ref.instanceId).find((a) => a.id === ref.abilityId)?.label ??
                        faceUpName(state, ref.instanceId);
                      const verb =
                        pending.prompt.kind === "chooseTriggers" && pending.prompt.timing === "interrupt"
                          ? "Interrupt"
                          : "Respond";
                      return [
                        {
                          id: option.optionId,
                          cardId: ref.instanceId,
                          // A name that ends in its own ? or ! ("Do You Even Lift?", "I Object!") is quoted, as
                          // the card prints it, rather than given a second mark.
                          question: /[?!]$/.test(name) ? `${verb} with “${name}”` : `${verb} with ${name}?`,
                          effect: readableEffect(triggerEffectOf(state, option, player.playerId, CORE_DEPS)),
                        },
                      ];
                    }),
                  }
                : {}),
              options: pending.options.map((option) => ({
                id: option.optionId,
                label:
                  pending.prompt.kind === "orderWhenRevealed"
                    ? whenRevealedStepLabel(state, pending.prompt.instanceId, option.optionId, option.label ?? "")
                    : option.ref.kind === "ability"
                      ? (abilityShortLabelOf(state, option.ref.instanceId, option.ref.abilityId, CORE_DEPS) ??
                        `Use ${faceUpName(state, option.ref.instanceId)}`)
                      : option.ref.kind === "card" && pending.prompt.kind === "declareDefender"
                        ? "Defend"
                        : pending.prompt.kind === "declareDefender" && option.optionId === "decline"
                          ? "Don’t defend"
                          : optionLabelOf(state, option),
                // Every step of a revealed card's order is that one card: buttons, not the card picked twice.
                cardId:
                  pending.prompt.kind !== "orderWhenRevealed" &&
                  (option.ref.kind === "card" || option.ref.kind === "ability")
                    ? option.ref.instanceId
                    : null,
              })),
              canSkip: pending.minSelections === 0,
              canCancel: false,
              min: pending.minSelections,
              max: pending.maxSelections,
              discardFromHand: pending.prompt.kind === "discardDownToHandSize",
              mulligan: pending.prompt.kind === "mulligan",
              // A reaction window's picks are ordered too, but the table asks those one card at a time (`offers`).
              ordered:
                pending.ordered && pending.maxSelections > 1 && !(trigger && pending.prompt.kind === "chooseTriggers"),
            }
          : null;
    // The player's cards attached to the hero, and to the player's allies (Inspired): the table tucks each under its host.
    const attached = [player.identity.instanceId, ...player.playArea].flatMap((host) =>
      (getInstance(state, host)?.attachments ?? []).filter((id) => !ENCOUNTER_TYPES.has(cardOf(state, id)?.type ?? "")),
    );
    const hostile = player.playArea.filter((id) =>
      ["minion", "attachment", "side_scheme", "environment", "obligation", "treachery"].includes(
        shownType(state, id) ?? "",
      ),
    );
    const enemyIds = new Set([
      state.mainScheme.instanceId,
      ...state.villainArea,
      ...(getInstance(state, villain.instanceId)?.attachments ?? []),
      ...hostile,
    ]);
    enemyIds.delete(villain.instanceId);
    for (const host of enemyIds) for (const id of getInstance(state, host)?.attachments ?? []) enemyIds.add(id);
    this.#view = {
      beats: this.#beats,
      choiceSource: pending ? (choiceSourceOf(state, pending)?.instanceId ?? null) : null,
      facedownEncounters: [
        ...player.dealtEncounter,
        ...[villain.instanceId, ...player.playArea].flatMap((id) => getInstance(state, id)?.boostCards ?? []),
      ],
      facedownBoosts: [villain.instanceId, ...player.playArea].flatMap((enemy) =>
        (getInstance(state, enemy)?.boostCards ?? []).map((id) => ({ id, enemy })),
      ),
      enemyCards: [...enemyIds].map((id) => this.#card(id)),
      under: [...enemyIds].flatMap((host) =>
        (getInstance(state, host)?.tucked ?? []).map((id) => ({
          ...this.#card(id),
          name: "Facedown card",
          art: (ENCOUNTER_TYPES.has(cardOf(state, id)?.type ?? "") ? CARD_BACKS.encounter : CARD_BACKS.player).url,
          under: host,
        })),
      ),
      hero: this.#card(player.identity.instanceId),
      villain: this.#card(villain.instanceId),
      // The identity's own Action abilities (Captain Marvel's Rechannel, Carol Danvers's Commander) sit in the hero's
      // menu with its powers.
      heroActions: [
        ...this.#heroEntries().map(({ action }) => ({
          kind: action.kind as string,
          label:
            action.kind === "changeForm"
              ? `Change to ${this.#otherFaceName()}`
              : action.kind === "basicAttack"
                ? "Attack"
                : action.kind === "basicThwart"
                  ? "Thwart"
                  : "Recover",
        })),
        ...this.#fieldAbilities(player.identity.instanceId).map(({ kind, label, exhausts }) => ({
          kind,
          label: this.#identityAbilityLabel(label),
          exhausts,
        })),
      ],
      heroHp: Math.max(0, remainingHitPoints(state, player.identity.instanceId, CORE_DEPS) ?? 0),
      villainHp: Math.max(0, remainingHitPoints(state, villain.instanceId, CORE_DEPS) ?? 0),
      hand: this.#handOrder.map((id) => this.#card(id)),
      deckCount: player.deck.length,
      encounterCount: activeEncounterDeck(state).deck.length,
      encounterDiscard: activeEncounterDeck(state)
        .discard.map((id) => ({
          ...this.#card(id),
          art: artFor(cardOf(state, id), { kind: "front" })?.url ?? "",
        }))
        .reverse(),
      drawn: this.#drawn,
      discard: player.discard.map((id) => this.#card(id)).reverse(),
      inPlay: [...new Set([...player.playArea, ...attached])]
        .filter((id) => !enemyIds.has(id))
        .map((id) => this.#card(id)),
      payment,
      choice,
      turn: state.outcome
        ? "finished"
        : state.step.phase === "villain"
          ? "enemy"
          : state.step.kind === "turn" && !state.step.ended
            ? "player"
            : "ending",
      round: state.round,
      outcome: state.outcome,
      canEndTurn: !!this.#endTurnCommand(),
    };
    return this.#view;
  }

  pick(id: string): boolean {
    const entry = this.#plays.get(id);
    if (!entry || this.#subject || this.#game.pendingChoice) return false;
    if (entry.action.kind !== "playCard") return false;
    if (entry.targets.length > 1) {
      this.#targetPick = entry;
      this.#subject = entry.action.instanceId;
      this.#view = null;
      return true;
    }
    if (!entry.targets.length && this.#askCostDiscard(entry)) return true;
    return this.#openPayment(entry, entry.targets[0] ?? null);
  }

  /**
   * A cost that discards from the hand and nothing else to pay (Alpha Flight Station's "choose and discard 1 card",
   * Legal Practice's "choose and discard up to 5 cards"): the player picks the cards on the hand, as at the end of the
   * turn, rather than the engine's own example picking them. Only the cards the engine lets the cost take (a filter, a
   * card that can't be chosen), and as many as it allows. False when the play or ability has no such cost.
   */
  #askCostDiscard(entry: LegalAction): boolean {
    if (entry.needsPayment) return false;
    const source =
      entry.action.kind === "useAbility" || entry.action.kind === "playCard" ? entry.action.instanceId : null;
    if (!source) return false;
    const cost =
      entry.action.kind === "useAbility"
        ? CORE_DEPS.abilities[entry.action.abilityId]?.cost
        : playedAbilityRefs(cardOf(this.#game, source))
            .map((ref) => CORE_DEPS.abilities[ref.id]?.cost)
            .find((each) => each?.discardFromHand);
    const discard = cost?.discardFromHand;
    if (!discard) return false;
    const candidates = handDiscardCandidates(this.#game, CORE_DEPS, source, this.#game.players[0]!.playerId, cost);
    this.#costDiscard = { entry, candidates, min: discard.min, max: discard.max ?? candidates.length };
    this.#subject = source;
    this.#view = null;
    return true;
  }

  /** An attachment played onto an enemy (Webbed Up, Spider-Tracer): it waits over the villain's side for its host. */
  isTargetedAttachment(id: string): boolean {
    return (this.#plays.get(id)?.targets ?? []).some((target) => {
      const type = cardOf(this.#game, target)?.type ?? "";
      return type === "villain" || ENCOUNTER_TYPES.has(type);
    });
  }

  #openPayment(entry: LegalAction, target: InstanceId | null): boolean {
    if (entry.action.kind !== "playCard") return false;
    const opened = beginPayment(this.#game, this.#game.players[0]!.playerId, entry.action, target, CORE_DEPS);
    if (!opened) {
      // A free play has no resource picker. Keep the chosen attachment host and validate the empty payment.
      if (entry.example.type !== "playCard") return false;
      const result = applyCommand(this.#game, { ...entry.example, attachToInstanceId: target, payment: [] }, CORE_DEPS);
      if (!result.ok) return false;
      this.#accept(result);
      return true;
    }
    this.#subject = entry.action.instanceId;
    this.#payment = opened;
    this.#view = null;
    return true;
  }

  toggle(id: string): void {
    if (!this.snapshot().payment?.sources.some((s) => s.id === id && s.available)) return;
    if (!this.#payment) {
      this.#windowPicks = this.#windowPicks.includes(id)
        ? this.#windowPicks.filter((s) => s !== id)
        : [...this.#windowPicks, id];
      this.#view = null;
      return;
    }
    this.#payment = togglePayment(this.#payment, id);
    this.#view = null;
  }

  cancel(): void {
    if (!this.#payment && this.snapshot().payment) this.chooseMany([]);
    else this.#clearPayment();
  }

  #clearPayment(): void {
    this.#windowPicks = [];
    this.#payment = null;
    this.#targetPick = null;
    this.#costDiscard = null;
    this.#subject = null;
    this.#view = null;
  }

  pay(): boolean {
    if (!this.#payment) return !!this.snapshot().payment?.canPay && this.chooseMany(this.#windowPicks);
    const command = this.#priced()?.command;
    if (!command) return false;
    this.#accept(apply(this.#game, command));
    return true;
  }

  #heroEntries() {
    if (this.#subject || this.#targetPick || this.#actions.kind !== "turn") return [];
    return this.#actions.legal.filter(
      ({ action }) =>
        action.kind === "changeForm" ||
        action.kind === "basicRecover" ||
        ((action.kind === "basicAttack" || action.kind === "basicThwart") &&
          action.instanceId === this.#game.players[0]!.identity.instanceId),
    );
  }

  #fieldAbilities(id: string) {
    if (this.#subject || this.#targetPick || this.#actions.kind !== "turn") return [];
    return this.#actions.legal.flatMap((entry) => {
      const { action } = entry;
      if (action.kind !== "useAbility" || action.instanceId !== id) return [];
      const ability = CORE_DEPS.abilities[action.abilityId];
      if (ability?.trigger.kind !== "action") return [];
      const short = abilityShortLabelOf(this.#game, action.instanceId, action.abilityId, CORE_DEPS) ?? "Use ability";
      // The exhaust icon on the button already says "exhaust", so the label is only what the action does.
      const does = short.replace(/^exhaust\b[^→·:]*[→·:]\s*/i, "");
      const label =
        action.abilityId === "01092.helicarrier-action"
          ? "Next card costs 1 less"
          : action.abilityId === "01091.avengers-mansion-action"
            ? "Draw 1 card"
            : (this.#namedAbilityLabel(action.instanceId, action.abilityId) ??
              // An encounter card paid off the table: the short label is only the cost, so say what paying it does.
              payToDiscardLabel(
                ENCOUNTER_TYPES.has(cardOf(this.#game, action.instanceId)?.type ?? "")
                  ? cardOf(this.#game, action.instanceId)
                  : undefined,
                short,
              ) ??
              does.charAt(0).toUpperCase() + does.slice(1));
      return [{ kind: String(action.abilityId), label, exhausts: !!ability.cost?.exhaustSelf, entry }];
    });
  }

  #allyPowers(id: string) {
    if (this.#subject || this.#targetPick || this.#actions.kind !== "turn") return [];
    return this.#actions.legal.filter(
      ({ action }) =>
        (action.kind === "basicAttack" || action.kind === "basicThwart") &&
        action.instanceId === id &&
        shownType(this.#game, action.instanceId) === "ally",
    );
  }

  /**
   * What a player reads on a card, in words: its stats as they stand now and its rules text (the face showing, for
   * the identity). For the play hook (`play.ts`), which describes the table to someone who can't see the pictures.
   */
  cardFacts(id: string): string {
    const state = this.#game;
    if (isFacedownMinion(state, id as InstanceId)) {
      const profile = characterProfile(state, id as InstanceId, CORE_DEPS);
      return `SCH ${profile?.sch ?? DRONE_BASE.sch} ATK ${profile?.atk ?? DRONE_BASE.atk} · ${DRONE_FACTS}`;
    }
    const card = cardOf(state, id as InstanceId);
    if (!card) return "";
    const identity = state.players[0]!.identity;
    const face =
      card.type === "hero_identity" && id === identity.instanceId
        ? ((card as unknown as Record<string, unknown>)[identity.form === "hero" ? "hero" : "alterEgo"] as
            | typeof card
            | undefined)
        : card;
    const profile = characterProfile(state, id as InstanceId, CORE_DEPS);
    const shown: readonly ("atk" | "thw" | "sch" | "def" | "rec")[] =
      card.type === "villain" || card.type === "minion"
        ? ["sch", "atk"]
        : card.type === "ally"
          ? ["thw", "atk"]
          : card.type === "hero_identity"
            ? identity.form === "hero"
              ? ["thw", "atk", "def"]
              : ["rec"]
            : [];
    const stats = profile
      ? shown.flatMap((stat) => (typeof profile[stat] === "number" ? [`${stat.toUpperCase()} ${profile[stat]}`] : []))
      : [];
    const text = face ? plainRulesTextOf(face) : "";
    // A side scheme's icons are printed, not written in its text: say what each does (Klaw's Defense Network is a
    // crisis, so the main scheme can't be thwarted until it goes; a thwart went to it without asking in a game).
    const icons =
      card.type === "side_scheme" && "icons" in card
        ? ((card.icons as readonly string[] | undefined) ?? []).flatMap((icon) =>
            SCHEME_ICON_TEXT[icon] ? [SCHEME_ICON_TEXT[icon]] : [],
          )
        : [];
    // A printed [energy] icon reads as a word: "Spend a [energy] resource" is "Spend an energy resource".
    return [stats.join(" "), text.replace(/\ba (?=energy\b)/g, "an "), ...icons].filter(Boolean).join(" · ");
  }

  /**
   * What the hero's menu says about a power that is missing for a reason the player can't see on the hero: a ready
   * Spider-Man with threat on the table and no Thwart, because no scheme's threat can be removed.
   */
  heroNotes(): string[] {
    const view = this.snapshot();
    const state = this.#game;
    const identity = state.players[0]!.identity;
    if (view.turn !== "player" || view.choice || view.payment || identity.form !== "hero" || view.hero.exhausted)
      return [];
    if (view.heroActions.some((action) => action.kind === "basicThwart")) return [];
    const locked = view.enemyCards.filter((card) => card.threatLock && (card.threat ?? 0) > 0);
    const open = view.enemyCards.some((card) => card.threat !== null && card.threat > 0 && !card.threatLock);
    if (!locked.length || open) return [];
    return locked.map((card) => `No thwart: ${card.name}. ${card.threatLock}.`);
  }

  /**
   * The menu's words for an ability whose engine label is only its cost ("Discard this card", "Exhaust, discard 1
   * card"): what using it does, with the numbers as they stand now.
   */
  #namedAbilityLabel(id: InstanceId, abilityId: string): string | null {
    switch (abilityId) {
      case "01018.energy-channel-action":
        return "Spend energy: 1 energy counter each";
      case "01018.energy-channel-hero-action": {
        const counters = getInstance(this.#game, id)?.counters?.energy ?? 0;
        return `Discard it: deal ${Math.min(10, 2 * counters)} damage`;
      }
      case "01027.focused-rage-action":
        return "Take 1 damage: draw 1 card";
      case "01020.hellcat-action":
        return "Return to your hand";
      case "01068.vision-action":
        return "Spend 1 energy: +2 THW or ATK";
      case "01015.alpha-flight-station-action":
        return this.#game.players[0]!.identity.form === "alterEgo"
          ? "Discard 1 card: draw 2 cards"
          : "Discard 1 card: draw 1 card";
      default:
        return null;
    }
  }

  /**
   * An identity's Action ability by its name and what it does, read from the face showing: "Commander: choose a player
   * to draw 1 card", "Rechannel: draw 1 card" (its cost is on the payment screen). The name alone says nothing.
   */
  #identityAbilityLabel(name: string): string {
    const identity = this.#game.players[0]!.identity;
    const card = cardOf(this.#game, identity.instanceId) as unknown as Record<string, unknown> | undefined;
    const face = card?.[identity.form === "hero" ? "hero" : "alterEgo"] as Parameters<typeof plainRulesTextOf>[0];
    const text = face ? plainRulesTextOf(face) : "";
    const from = text.indexOf(`${name} —`);
    // Its first sentence after the trigger word and the cost: "Rechannel — Action: <cost> → draw 1 card. (Limit…)".
    const does =
      from < 0
        ? ""
        : text
            .slice(from)
            .replace(/^[^:]*:\s*/, "")
            .replace(/^[^.]*?→\s*/, "")
            .split(/\.(?:\s|$)/)[0]!
            .trim();
    return does ? `${name}: ${does.charAt(0).toLowerCase()}${does.slice(1)}` : name;
  }

  /**
   * The question for a card's own pick before it is paid for: a host for an upgrade or attachment, an ally in a discard
   * pile for Make the Call ("Pay the printed cost of an ally in any player's discard pile").
   */
  #targetPrompt(entry: LegalAction): string {
    const type = entry.action.kind === "playCard" ? cardOf(this.#game, entry.action.instanceId)?.type : undefined;
    if (type === "upgrade" || type === "attachment") return "Choose a card to attach to";
    const inDiscard = entry.targets.every((id) => locateCard(this.#game, id)?.kind === "discard");
    const allies = entry.targets.every((id) => cardOf(this.#game, id)?.type === "ally");
    if (inDiscard) return `Choose ${allies ? "an ally" : "a card"} from a discard pile`;
    return "Choose a target";
  }

  /** The name on the identity's other face: what changing form turns the hero into ("Peter Parker", "Captain Marvel"). */
  #otherFaceName(): string {
    const identity = this.#game.players[0]!.identity;
    const card = cardOf(this.#game, identity.instanceId) as unknown as Record<
      string,
      { faceName?: string } | undefined
    >;
    return card?.[identity.form === "hero" ? "alterEgo" : "hero"]?.faceName ?? "the other form";
  }

  /** The player's current form and hand size (with modifiers, so the hand limit at the end of the turn). */
  playerFacts(): { form: "hero" | "alterEgo"; handSize: number } {
    const player = this.#game.players[0]!;
    return { form: player.identity.form, handSize: handSize(this.#game, player.playerId, CORE_DEPS) };
  }

  /** Any card's name as it shows now (an identity by its live face), wherever the card is. For the play hook. */
  cardName(id: string): string {
    return shortIdentityNameOf(this.#game, id as InstanceId) ?? faceUpName(this.#game, id as InstanceId);
  }

  /**
   * A way to pay that is a card's own ability, named by the card's live face and the ability ("Peter Parker —
   * Scientist"), for any card; null for a card spent from the hand. For the play hook: the payment bar draws the card
   * itself, so its own label can stay short.
   */
  paymentSourceName(sourceId: string, cardId: string): string | null {
    const ref = activeAbilityRefs(this.#game, cardId as InstanceId).find((ability) => sourceId.includes(ability.id));
    return ref ? abilityLabelOf(this.#game, cardId as InstanceId, ref.id, CORE_DEPS) : null;
  }

  /** The damage an ally takes after attacking or thwarting (the small number beside its ATK and THW); 0 for others. */
  consequentialDamage(id: string, power: "attack" | "thwart"): number {
    const card = cardOf(this.#game, id as InstanceId);
    if (card?.type !== "ally" || isFacedownMinion(this.#game, id as InstanceId)) return 0;
    return card.consequentialDamage?.[power] ?? 0;
  }

  basicPower(id: string, stat: "atk" | "thw" | "rec"): number {
    return characterProfile(this.#game, id as InstanceId, CORE_DEPS)?.[stat] ?? 0;
  }

  fieldActions(id: string) {
    return [
      ...this.#allyPowers(id).map(({ action }) => ({
        kind: action.kind,
        label: action.kind === "basicAttack" ? "Attack" : "Thwart",
      })),
      ...this.#fieldAbilities(id).map(({ kind, label, exhausts }) => ({ kind, label, exhausts })),
    ];
  }

  fieldAction(id: string, kind: string): boolean {
    const power = this.#allyPowers(id).find(({ action }) => action.kind === kind);
    if (power) return this.#usePower(power);
    const entry = this.#fieldAbilities(id).find((action) => action.kind === kind)?.entry;
    if (!entry || entry.action.kind !== "useAbility") return false;
    if (this.#askCostDiscard(entry)) return true;
    if (entry.needsPayment) {
      const payment = beginPayment(this.#game, this.#game.players[0]!.playerId, entry.action, null, CORE_DEPS);
      if (!payment) return false;
      this.#subject = entry.action.instanceId;
      this.#payment = payment;
      this.#view = null;
    } else this.#accept(apply(this.#game, entry.example));
    return true;
  }

  heroAction(kind: string): boolean {
    const entry = this.#heroEntries().find((e) => e.action.kind === kind);
    if (entry) return this.#usePower(entry);
    // One of the identity's own Action abilities (Rechannel, Commander).
    return this.fieldAction(this.#game.players[0]!.identity.instanceId, kind);
  }

  #usePower(entry: LegalAction): boolean {
    if (entry.targets.length > 1) {
      this.#targetPick = entry;
      this.#view = null;
    } else this.#accept(apply(this.#game, entry.example));
    return true;
  }

  #endTurnCommand(): Command | undefined {
    if (this.#subject || this.#targetPick || this.#actions.kind !== "turn") return;
    return this.#actions.legal.find((entry) => entry.action.kind === "endTurn")?.example;
  }

  endTurn(): boolean {
    const command = this.#endTurnCommand();
    if (!command) return false;
    this.#accept(apply(this.#game, command));
    return true;
  }

  choose(id: string | null): boolean {
    if (this.#targetPick) {
      const entry = this.#targetPick;
      const target = entry.targets.find((candidate) => candidate === id);
      if (!target) return false;
      const command = entry.example;
      if (command.type === "basicAttack" || command.type === "basicThwart") {
        this.#accept(
          apply(
            this.#game,
            command.type === "basicAttack"
              ? { ...command, targetInstanceId: target }
              : { ...command, schemeInstanceId: target },
          ),
        );
        return true;
      }
      if (!this.#openPayment(entry, target)) return false;
      this.#targetPick = null;
      return true;
    }
    return this.chooseMany(id === null ? [] : [id]);
  }

  chooseMany(ids: readonly string[]): boolean {
    if (this.#costDiscard) {
      const { entry, candidates, min, max } = this.#costDiscard;
      if (ids.length < min || ids.length > max || ids.some((id) => !candidates.includes(id as InstanceId)))
        return false;
      if (entry.example.type !== "useAbility" && entry.example.type !== "playCard") return false;
      const result = applyCommand(
        this.#game,
        { ...entry.example, costChoices: { ...entry.example.costChoices, discard: ids as InstanceId[] } },
        CORE_DEPS,
      );
      if (!result.ok) return false;
      this.#costDiscard = null;
      this.#subject = null;
      this.#accept(result);
      return true;
    }
    const choice = this.#game.pendingChoice;
    if (
      !choice ||
      ids.length < choice.minSelections ||
      ids.length > choice.maxSelections ||
      ids.some((id) => !choice.options.some((option) => option.optionId === id))
    ) {
      return false;
    }
    const result = applyCommand(
      this.#game,
      {
        type: "resolveChoice",
        choiceId: choice.choiceId,
        playerId: choice.playerId,
        selectedOptionIds: ids,
      },
      CORE_DEPS,
    );
    if (!result.ok) return false;
    this.#accept(result);
    return true;
  }
}

/** How a card's ability is printed: "Forced Response", "Interrupt", "Action". */
function triggerLabel(abilityId: string): string {
  const trigger = CORE_DEPS.abilities[abilityId]?.trigger;
  if (!trigger) return "Ability";
  if (trigger.kind === "response" || trigger.kind === "interrupt") {
    const kind = trigger.kind === "response" ? "Response" : "Interrupt";
    return "forced" in trigger && trigger.forced ? `Forced ${kind}` : kind;
  }
  if (trigger.kind === "action") return trigger.forced ? "Forced Action" : "Action";
  return "Ability";
}
