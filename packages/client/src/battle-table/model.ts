import { WAVE1_DEPS, coreScenario, wave1Scenario, type CorePlayer } from "@mc/cards";
import {
  RESOURCE_TYPES,
  applyCommand,
  activeEncounterDeck,
  activeAbilityRefs,
  canAttack,
  cardOf,
  encounterFace,
  hasKeyword,
  characterProfile,
  createGame,
  getInstance,
  handDiscardCandidates,
  isResourcesChoice,
  handSize,
  legalActions,
  locateCard,
  paymentOptionsPool,
  traitsOf,
  satisfies,
  combineRequirements,
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
  type PendingChoice,
  type ResourcePool,
  type ResourceType,
  type TriggerEvent,
} from "@mc/engine";
import { CORE_STARTER_DECKS, type CoreAspect } from "@mc/content";
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
import { choiceAffects } from "./choice-affects.js";
import {
  faceUpName as printedNameOf,
  optionLabelOf as printedOptionLabelOf,
  shortIdentityNameOf,
} from "../view/names.js";
import { beginPayment, paymentView, togglePayment, type PaymentState } from "../view/payment-model.js";

import { paymentSheetView } from "../view/payment-sheet.js";

/**
 * The scripts the table plays by: the Core Set's and wave 1's (Green Goblin, The Wrecking Crew and their heroes),
 * a superset of the Core Set's, so a Core game plays exactly as before.
 */
const TABLE_DEPS = WAVE1_DEPS;

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
  /**
   * A minion engaged with the player that has guard now: while it is there the player cannot attack the villain (RRG
   * 1.8 "Guard", p. 21). The table wears a shield on its plate, and calls "Guard" out as it arrives.
   */
  guard?: true;
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

/** The paying and resolving around an interrupt: never what it interrupts. */
const PAYING = new Set<TriggerEvent["kind"]>(["resourcesSpent", "resourcesGenerated", "abilityResolved"]);

/**
 * The game event an interrupt that resolves after `history` interrupts: the innermost one initiated and not yet
 * resolved or cancelled (RRG 1.8 "Interrupt", p. 24: it resolves before the event it answers). Null when none is open.
 */
export function interruptedEventOf(history: readonly GameEvent[], interrupter: string): TriggerEvent | null {
  const open: TriggerEvent[] = [];
  const key = (event: TriggerEvent) => `${event.kind} ${triggerSubjectOf(event, true).subject ?? ""}`;
  for (const e of history) {
    if (e.type !== "triggerEvent") continue;
    if (e.phase === "initiated") {
      open.push(e.event);
      continue;
    }
    // The resolved or cancelled one is the last open event like it; an event never seen opening closes nothing.
    const at = open.map(key).lastIndexOf(key(e.event));
    if (at >= 0) open.splice(at, 1);
  }
  for (let i = open.length - 1; i >= 0; i--) {
    const event = open[i]!;
    if (PAYING.has(event.kind)) continue;
    // Its own playing (Backflip, an event, is being played as it resolves).
    if ((event.kind === "cardPlayed" || event.kind === "cardBeingPlayed") && event.instanceId === interrupter) continue;
    return event;
  }
  return null;
}

/**
 * What an interrupt interrupts, in a few words after "… interrupts": "Rhino's attack", "2 damage to Spider-Man",
 * "the reveal of Advance". Its own card is not named twice: Norman Osborn interrupts "2 incoming damage". Null for an
 * event the table has no words for: the line then says only who interrupts.
 */
export function interruptedWords(
  event: TriggerEvent,
  interrupter: string,
  name: (id: InstanceId) => string,
): string | null {
  const own = (id: string) => id === interrupter;
  const whose = (id: string, thing: string) => (own(id) ? `the ${thing}` : `${name(id as InstanceId)}’s ${thing}`);
  switch (event.kind) {
    case "enemyAttack":
      return whose(event.enemyInstanceId, "attack");
    case "enemyScheme":
      return whose(event.enemyInstanceId, "scheme");
    case "attack":
      return whose(event.attackerInstanceId, "attack");
    case "thwart":
      return whose(event.thwarterInstanceId, "thwart");
    case "dealDamage": {
      const amount = `${event.amount} damage`;
      if (own(event.targetInstanceId)) return `${event.amount} incoming damage`;
      const target = name(event.targetInstanceId as InstanceId);
      const source = event.fromAttack && event.sourceInstanceId ? event.sourceInstanceId : null;
      return source && source !== event.targetInstanceId && !own(source)
        ? `${name(source as InstanceId)}’s ${amount} to ${target}`
        : `${amount} to ${target}`;
    }
    case "placeThreat":
      return `${event.amount} threat on ${name(event.schemeInstanceId as InstanceId)}`;
    case "removeThreat":
      return `${event.amount} threat coming off ${name(event.schemeInstanceId as InstanceId)}`;
    case "cardRevealed":
    case "encounterCardRevealing":
    case "encounterCardBeingRevealed":
      return own(event.instanceId) ? "its reveal" : `the reveal of ${name(event.instanceId as InstanceId)}`;
    case "characterDefeated":
      return whose(event.instanceId, "defeat");
    case "cardEntersPlay":
      return own(event.instanceId) ? null : `${name(event.instanceId as InstanceId)} entering play`;
    case "cardPlayed":
    case "cardBeingPlayed":
      return own(event.instanceId) ? null : `${name(event.instanceId as InstanceId)} being played`;
    default:
      return null;
  }
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
  /**
   * A spend of resources (Ultron's Drones: "Spend 1 energy, or …"): the cards picked pay it, so their plates show no
   * label of what each card's resource costs to use ("exhaust, remove 1 web counter"; Adam, 2026-11-25: "we don't need
   * this pill").
   */
  spend?: boolean;
  /**
   * A spend the player may decline (Android Efficiency's boost: "spend a [energy] resource or put the top card of the
   * deck into play ... as a Drone minion"; Sonic Boom), asked in two steps like any other card's choice (Adam,
   * 2026-11-25): "choose" offers the two halves as buttons; picking "Spend ..." opens "spend", where the cards that
   * can pay are picked, and Cancel goes back to "choose".
   */
  eitherOr?: "choose" | "spend";
  /**
   * An either-or's "choose" step: the cards that could pay its spend, in the order the "spend" step offers them. The
   * table keeps them (and the whole hand) readable while the player decides, and puts the asking card where the
   * "spend" step will, so nothing moves between the steps (issue 217: "I can't view the cards in my hand").
   */
  payers?: string[];
  /** The opening-hand mulligan: pick any cards to discard, then draw back up to hand size. */
  mulligan: boolean;
  /**
   * The picks are an order (Masters of Mayhem's "Order the enemies", "Order these effects"): the first one picked goes
   * first. The table numbers the picked cards as they are picked (`pick-order.ts`).
   */
  ordered?: boolean;
  /**
   * Indirect damage to divide among the player's characters (Green Goblin's "Deal 3 indirect damage to each player",
   * Pumpkin Bombs; RRG 1.8 "Indirect Damage", p. 24): each pick is 1 damage on that card, a card offered once per hit
   * point it has left, and exactly `amount` are picked. The table counts the damage on each card as it is assigned.
   */
  indirect?: { amount: number };
  /**
   * Picking whom to attack while guard stops an attack on the villain: the villains the player cannot attack, and the
   * guard minions stopping it. The pick is asked even when the guard minion is the only enemy left to attack, so the
   * player sees why the villain is out of reach rather than the attack going to the minion by itself (Adam,
   * 2026-11-25: a playtester was confused when the attack "went straight to the guard one").
   */
  guard?: { blocked: string[]; guards: string[] };
  /**
   * The cards a "Choose one" question's options would change (Ultron's "Place 1 threat on the main scheme": the main
   * scheme), kept in focus while it is asked so their numbers can be read (`choice-affects.ts`; issue 210).
   */
  affects?: string[];
  /**
   * Options that are cards in a deck, a discard pile or set aside, which the table doesn't show face up: each one's
   * face and the pile it is in. The table lays them out as cards to read before choosing (Masters of Mayhem searching
   * the encounter deck for a Masters of Evil minion; any search of the player's own deck). Absent when none are.
   */
  searched?: { id: string; card: BattleCard; from: string }[];
}

/** What the table calls each pile a question can offer cards from (`BattleChoice.searched`). */
/**
 * Whether an ability's effects choose `slot` as an enemy its controller can attack (`TargetQuery.attackableBy` over
 * enemies, as `anAttackableEnemy` writes it): the pick of an attack that guard can narrow. Walks the whole effect tree,
 * since the step may sit inside a "choose one" or a sequence.
 */
function asksAttackableEnemy(effects: unknown, slot: string): boolean {
  if (Array.isArray(effects)) return effects.some((effect) => asksAttackableEnemy(effect, slot));
  if (!effects || typeof effects !== "object") return false;
  const step = effects as { kind?: unknown; slot?: unknown; query?: { attackableBy?: unknown; categories?: unknown } };
  if (
    step.kind === "chooseTarget" &&
    step.slot === slot &&
    step.query?.attackableBy &&
    Array.isArray(step.query.categories) &&
    step.query.categories.some((category) => category === "enemy" || category === "villain")
  )
    return true;
  return Object.values(effects).some((value) => asksAttackableEnemy(value, slot));
}

const PILE_NAMES: Partial<Record<NonNullable<ReturnType<typeof locateCard>>["kind"], string>> = {
  deck: "Your deck",
  discard: "Your discard pile",
  setAside: "Set aside",
  separateDeck: "Deck",
  separateDiscard: "Discard pile",
  encounterDeck: "Encounter deck",
  encounterDiscard: "Encounter discard pile",
  encounterSetAside: "Set aside",
  scenarioDeck: "Deck",
  scenarioDiscard: "Discard pile",
  victoryDisplay: "Victory display",
  removedFromGame: "Out of the game",
};

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
  /**
   * The interrupt's kind as printed ("Forced Interrupt"), whose side it is on (an encounter card's has no controller),
   * and the card of what it interrupts, when the table can tell (`interruptedEventOf`).
   */
  interruptBy?: { label: string; villain: boolean; subject: string | null };
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
   * A card in play other than the villain turns over to its other side (Criminal Enterprise to State of Madness): the
   * table turns it over, as it does the villain (Adam, 2026-11-28: it changed in place, unnoticed).
   */
  cardFlip?: string;
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
  millSource?: { card: string; label: string; miss?: string; by?: string };
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
    applies?: { form: "Hero" | "Alter-Ego"; text: string } | { villain: string; text: string };
    /**
     * Its When Revealed hits "each hero" while the player is in alter-ego form, so it fires on no one (Shocker). An
     * alter-ego is not a hero (Rules Reference v1.8, "Hero"), and the table says so rather than flashing for nothing.
     */
    noHeroes?: true;
    /**
     * Its When Revealed attacks "your hero" while the player is in alter-ego form (Swarm Attack), so nothing attacks
     * (Rules Reference v1.8, "Form, Change Form", p. 21). `instead` is the card's own "if no attack was made" half, in
     * its words, when it has one. The table says so, as it does for a choice with no target (issue 222).
     */
    noHeroToAttack?: { instead: string | null };
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
  /**
   * Threat placed on or removed from a scheme: `delta` is the change, `to` the scheme's threat once it has landed. The
   * table shows `to` rather than adding `delta` to what it shows, so a label redrawn mid-move (a Drone arriving) can
   * never count the same threat twice.
   */
  threat?: { scheme: string; delta: number; to: number };
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
  /** The game is still being set up (the mulligan, a hero's setup ability such as Black Panther's Foresight). */
  setup: boolean;
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

/** The two answers of an either-or spend's first step (`BattleChoice.eitherOr`). */
export const EITHER_SPEND = "either-or:spend";
export const EITHER_OTHERWISE = "either-or:otherwise";

/** `BattleChoice.affects`, present only when the question names cards it would change. */
function affectsOf(state: GameState, pending: PendingChoice): { affects?: string[]; prompt?: string } {
  const affects = choiceAffects(state, pending, TABLE_DEPS);
  // A card the question is about that isn't on the table (a Goblin minion Wicked Ambitions just discarded): named in
  // the question, so two in a row can be told apart.
  const offTable = affects.find((id) => isInEncounterDiscard(state, id));
  return affects.length
    ? { affects, ...(offTable ? { prompt: `Choose one for ${faceUpName(state, offTable)}` } : {}) }
    : {};
}

/** The card lies in an encounter discard pile. */
function isInEncounterDiscard(state: GameState, id: InstanceId): boolean {
  return Object.values(state.encounterDecks).some((piles) => piles.discard.includes(id));
}

function statModifiers(state: GameState, id: InstanceId) {
  const profile = characterProfile(state, id, TABLE_DEPS);
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
 * Of a card's When Revealed lines for each side of the villain (Mad Genius: "When Revealed (Green Goblin): ... /
 * When Revealed (Norman Osborn): ..."), the one for the side showing. Nothing for a card without them.
 */
export function villainWhenRevealed(
  text: string,
  villain: string,
): { applies: { villain: string; text: string } } | Record<string, never> {
  // A face name is plain words ("Green Goblin", "Norman Osborn"): nothing in it needs escaping for the pattern.
  const at = text.search(new RegExp(String.raw`When Revealed \(${villain}\)\s*:`, "i"));
  if (at < 0) return {};
  const line =
    /:\s*(.+?)\s*(?=\n|When Revealed\b|(?:Hero |Alter-Ego )?(?:Forced )?(?:Interrupt|Response)\b|Boost\b|$)/is.exec(
      text.slice(at),
    );
  return line ? { applies: { villain, text: line[1]!.trim() } } : {};
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
 * A When Revealed that opens by attacking "your hero" ("Each Drone minion engaged with your hero attacks.") finds no
 * hero while the player is in alter-ego form: no attack is made, and its "if no attack was made" sentence, if it has
 * one, is what happens instead (Rules Reference v1.8, "Form, Change Form", p. 21; issue 222).
 */
export function whenRevealedAttacksYourHero(
  text: string,
  form: "hero" | "alterEgo",
): { noHeroToAttack: { instead: string | null } } | Record<string, never> {
  if (form !== "alterEgo" || /When Revealed \((?:Hero|Alter-Ego)\)/i.test(text)) return {};
  const line =
    /When Revealed\s*:\s*(.+?)\s*(?=\n|When Revealed\b|(?:Forced )?(?:Interrupt|Response)\b|Boost\b|$)/is.exec(
      text,
    )?.[1] ?? "";
  const [first = "", ...rest] = line.split(/(?<=\.)\s+/);
  if (!/\b(?:attacks your hero|engaged with your hero attacks)\b/i.test(first)) return {};
  const otherwise = rest
    .map((sentence) => /^If\b[^,]*\b(?:no attacks?|not attack)\b[^,]*,\s*(.+)$/i.exec(sentence)?.[1])
    .find(Boolean);
  return {
    noHeroToAttack: { instead: otherwise ? otherwise.charAt(0).toUpperCase() + otherwise.slice(1) : null },
  };
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
  const result = applyCommand(state, command, TABLE_DEPS);
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
  if (!effect) return null;
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  return (
    effect
      // A paragraph the helper left whole, trigger and all ("Use Counter-Punch: Response (attack): After your hero
      // defends against an attack, deal damage …"): from what it does.
      .replace(
        /^Use ([^:,]+?): (?:Hero |Alter-Ego )?(?:Forced )?(?:Interrupt|Response)(?: \([^)]*\))?:\s*(?:(?:After|When)\b[^,]*,\s*)?(.*)$/,
        (_, name: string, rest: string) => `Use ${name} to ${lower(rest)}`,
      )
      // The cost before the arrow is the card's own business ("exhaust Black Widow and spend a mental resource →",
      // "discard Indomitable →"): the sentence says what using it does.
      .replace(/^Use ([^:,]+?) to [^→]*→\s*(.*)$/, (_, name: string, rest: string) => `Use ${name} to ${lower(rest)}`)
      .replace(/^Use ((?:(?! to )[^:,])+) to ((?:each|every|all|you|your|that|the|a|an)\b.*)$/, "Use $1: $2")
      // A name that ends in its own ? or !, as "Do You Even Lift?" does, is quoted as the card prints it.
      .replace(/^Use ([^“:]+?[?!])( to |: )/, "Use “$1”$2")
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
/**
 * A pick from the player's hand that a card's text discards (Tombstone's "discard a [mental] or a [physical] resource
 * from your hand", Power Drain's "choose and discard 1 resource ... for each boost icon"): asked as a discard, named by
 * the card, with the words that say why ("Choose a target" said neither). Null for any other pick.
 */
function handDiscardQuestion(
  state: GameState,
  pending: NonNullable<GameState["pendingChoice"]>,
): Pick<BattleChoice, "prompt" | "sourceTitle" | "explanation"> | null {
  if (pending.prompt.kind !== "chooseCards" && pending.prompt.kind !== "chooseTarget") return null;
  const hand = new Set<string>(state.players.flatMap((seat) => seat.hand));
  const cards = pending.options.filter((o) => o.ref.kind === "card");
  if (!cards.length || cards.length !== pending.options.length) return null;
  if (!cards.every((o) => o.ref.kind === "card" && hand.has(o.ref.instanceId))) return null;
  const panel = choiceSourcePanelOf(state, pending, pending.playerId, TABLE_DEPS);
  const said = panel?.rulesText
    .split(/(?<=\.)\s+|\n+/)
    .find((sentence) => /\bdiscard\b/i.test(sentence) && /\bhand\b/i.test(sentence));
  if (!panel || !said) return null;
  const n = pending.minSelections === pending.maxSelections ? pending.minSelections : 0;
  return {
    prompt: n ? `Choose ${n === 1 ? "a card" : `${n} cards`} to discard` : "Choose cards to discard",
    sourceTitle: panel.name,
    explanation: said.trim(),
  };
}

/**
 * The question for a pick among cards one of the player's abilities turned up (Futurist: "Choose cards" said nothing):
 * "Choose a card to add to your hand", titled "Tony Stark · Futurist", with the ability's words.
 */
function pickQuestion(
  state: GameState,
  pending: NonNullable<GameState["pendingChoice"]>,
): Partial<Pick<BattleChoice, "prompt" | "sourceTitle" | "explanation">> {
  const panel = choiceSourcePanelOf(state, pending, state.players[0]!.playerId, TABLE_DEPS);
  const ability = panel?.abilityLine?.split(" — ")[1];
  if (!panel || !ability) return {};
  const from = panel.rulesText.indexOf(`${ability} — `);
  const said = from < 0 ? undefined : /:\s*([^(]+)/.exec(panel.rulesText.slice(from))?.[1]?.trim();
  return {
    ...(said && /\badd (?:1|one) to your hand\b/i.test(said) ? { prompt: "Choose a card to add to your hand" } : {}),
    sourceTitle: `${panel.name} · ${ability}`,
    ...(said ? { explanation: said } : {}),
  };
}

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
  { id: "black-panther", name: "Black Panther", starterDeckId: "core-black-panther-protection" },
  { id: "iron-man", name: "Iron Man", starterDeckId: "core-iron-man-aggression" },
] as const;
export type HeroId = (typeof HEROES)[number]["id"];

export function isHeroId(id: unknown): id is HeroId {
  return HEROES.some((hero) => hero.id === id);
}

/**
 * The scenarios the table can deal, with the module each recommends and the box it came in: the Core Set's three
 * (named by their villain, as they always were) and The Green Goblin pack's two (named by the scenario: the same
 * villain fronts both). The id is `@mc/content`'s scenario id; the type keeps its old name, `VillainId`.
 */
export const VILLAINS = [
  { id: "rhino", name: "Rhino", module: "bomb_scare", box: "core" },
  { id: "klaw", name: "Klaw", module: "masters_of_evil", box: "core" },
  { id: "ultron", name: "Ultron", module: "under_attack", box: "core" },
  { id: "risky-business", name: "Risky Business", module: "power_drain", box: "gob" },
  { id: "mutagen-formula", name: "Mutagen Formula", module: "goblin_gimmicks", box: "gob" },
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
/**
 * The Green Goblin pack's four modular sets. A game can be dealt with them (its scenarios recommend two), but the
 * Free Play tray offers `MODULES` only until the road opens these.
 */
export const PACK_MODULES = [
  { id: "power_drain", name: "Power Drain" },
  { id: "goblin_gimmicks", name: "Goblin Gimmicks" },
  { id: "a_mess_of_things", name: "A Mess of Things" },
  { id: "running_interference", name: "Running Interference" },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"] | (typeof PACK_MODULES)[number]["id"];

export function isModuleId(id: unknown): id is ModuleId {
  return [...MODULES, ...PACK_MODULES].some((module) => module.id === id);
}

/** A module's name, from either list. */
export const moduleName = (id: ModuleId): string => [...MODULES, ...PACK_MODULES].find((each) => each.id === id)!.name;

/** Standard or Expert (RRG v1.8 p. 28): Expert adds the Expert set and starts the villain at stage II. */
export type Difficulty = "standard" | "expert";

export function isDifficulty(id: unknown): id is Difficulty {
  return id === "standard" || id === "expert";
}

/** The module the villain's scenario recommends: what a game adds unless another is chosen. */
export const recommendedModule = (villain: VillainId): ModuleId => VILLAINS.find((each) => each.id === villain)!.module;

/** A deck the player built, as the deal takes it: the hero's identity, the chosen aspects and one card id per copy. */
export interface BuiltDeck {
  /** The saved deck's id and name, carried to the game so its record can say which deck played. */
  readonly id: string;
  readonly name: string;
  readonly identityCardId: string;
  readonly aspects: readonly CoreAspect[];
  readonly cards: readonly string[];
}

/** The deal a replay starts from: `DealOptions` without a dev set-up, as plain data. */
export interface ReplayDeal {
  hero: HeroId;
  villain: VillainId;
  difficulty: Difficulty;
  modules: ModuleId[];
  seed: number;
  /** Dealt stopping at the opening hand (the table always does): the mulligan answer is the first move. */
  mulligan: boolean;
  /** The deck built at the bench, or null for the hero's starter deck. */
  deck: BuiltDeck | null;
}

/** A game as a replay: the deal and the player's moves in order, undone ones left out (`record/replay.ts`). */
export interface GameReplay {
  v: 1;
  deal: ReplayDeal;
  moves: Command[];
}

export interface DealOptions {
  // The game: who plays against whom.
  /** Which hero, with their starter deck: Spider-Man unless chosen otherwise. */
  hero?: HeroId;
  /** A deck built at the bench (`decks/`), dealt in place of the hero's starter deck. It must be the hero's, and legal. */
  deck?: BuiltDeck;
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

/** The hero's seat: their starter deck, or the deck built for them (`coreScenario` refuses one that isn't legal). */
function seatOf(hero: HeroId, deck: BuiltDeck | undefined): CorePlayer {
  const starterDeckId = HEROES.find((each) => each.id === hero)!.starterDeckId;
  if (!deck) return { starterDeckId };
  const identity = CORE_STARTER_DECKS.find((each) => each.id === starterDeckId)?.identityCardId;
  if (deck.identityCardId !== identity) throw Error(`The deck "${deck.name}" is not a deck for ${hero}.`);
  return {
    identityCardId: deck.identityCardId,
    deck: deck.cards,
    aspects: deck.aspects,
    deckId: deck.id,
    deckName: deck.name,
  };
}

function openingTurn({
  hero = "spider-man",
  deck,
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
  const options = {
    seed,
    players: [seatOf(hero, deck)],
    ...(difficulty ? { difficulty } : {}),
    ...(modules ? { modularSetIds: modules } : {}),
  };
  // A Core scenario with Core modules is built by the Core Set's own builder, exactly as always. A scenario pack's, or a
  // Core scenario given one of a pack's modules in Free Play (Rhino with Power Drain), by the wave's, whose card pool
  // holds the pack's cards.
  const core =
    VILLAINS.find((each) => each.id === villain)!.box === "core" &&
    (modules ?? []).every((id) => MODULES.some((each) => each.id === id));
  const created = createGame(core ? coreScenario(villain, options) : wave1Scenario(villain, options), TABLE_DEPS);
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

/** One committed move, as the table gets it: the game before and after, the engine's events and the beats shown. */
export interface CommittedMove {
  readonly model: BattleModel;
  readonly before: GameState;
  readonly after: GameState;
  readonly events: readonly GameEvent[];
  readonly beats: readonly BattleBeat[];
}

/** Hears a move as it is committed (the game still the one before it); what it returns is called once it is in. */
export type CommitObserver = (move: CommittedMove) => (() => void) | void;

let commitObserver: CommitObserver | null = null;

/**
 * Tests only: hear every committed move (`shown-check.ts`, the "nothing happens without the table showing it" check).
 * Null stops listening. The table itself never sets it.
 */
export function observeCommits(observer: CommitObserver | null): void {
  commitObserver = observer;
}

/** One symbol a spend asks for (`BattleModel.spendMeter`): a resource type, or "any" for a resource of any type. */
export interface SpendNeed {
  readonly type: "wild" | "energy" | "mental" | "physical" | "any";
  readonly paid: boolean;
}
export interface SpendMeter {
  readonly need: readonly SpendNeed[];
  /** Options not yet picked that would pay a symbol still unlit. */
  readonly useful: ReadonlySet<string>;
  /** Each picked option and the symbols it pays, taken in the order picked (the card wears them, `main.ts`). */
  readonly paidBy: ReadonlyMap<string, readonly SpendNeed["type"][]>;
}
type SpendFill = Record<"wild" | "energy" | "mental" | "physical" | "any", number>;

/**
 * How many of each symbol a pool pays, the way the engine's `satisfies` counts it (RRG 1.8 "Cost"): wild slots take
 * wilds only, typed slots their own type first, wilds left over cover a typed shortfall, and what remains pays the
 * "any" slots.
 */
function fillSpend(req: ReturnType<typeof combineRequirements>, pool: ResourcePool | null): SpendFill {
  const fill: SpendFill = { wild: 0, energy: 0, mental: 0, physical: 0, any: 0 };
  if (!pool) return fill;
  fill.wild = Math.min(pool.wild, req.wild ?? 0);
  let wilds = pool.wild - fill.wild;
  let spare = 0;
  for (const type of ["energy", "mental", "physical"] as const) {
    fill[type] = Math.min(pool[type], req[type]);
    spare += pool[type] - fill[type];
  }
  for (const type of ["energy", "mental", "physical"] as const) {
    const cover = Math.min(wilds, req[type] - fill[type]);
    fill[type] += cover;
    wilds -= cover;
  }
  fill.any = Math.min(req.generic, spare + wilds);
  return fill;
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
  /** The either-or spend whose "Spend" half the player picked (its engine choice id): its second step is up. */
  #eitherOrSpending: string | null = null;
  #view: BattleSnapshot | null = null;
  #matchup: { hero: HeroId; villain: VillainId } = { hero: "spider-man", villain: "rhino" };
  /** The shuffle this game was dealt with: with the matchup, it deals the same game again (a bug report keeps it). */
  #seed = PRACTICE_SEED;
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
    /** How many of `#moves` there were before this move. */
    moves: number;
  }[] = [];
  /** Every engine event of this game's moves so far, undone moves left out: the saved record reads it (`record/`). */
  #events: GameEvent[] = [];
  /**
   * The player's moves this game as the engine got them, undone moves left out: with the deal they play the same game
   * again (`record/replay.ts`, the saved game kept on the test site). The forced single-option answers `#accept` makes
   * itself are not here: replaying through the model makes them again.
   */
  #moves: Command[] = [];
  /** The command the last `#apply`/`#try` sent, which `#accept` keeps once the move goes in. */
  #sent: Command | null = null;
  /** The deal this game came from, for the replay; null for a dev set-up (`arrange`), which a replay can't redo. */
  #dealt: ReplayDeal | null = null;

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
    return this.#history.length > 0 || this.snapshot().choice?.eitherOr === "spend";
  }

  /** Paying for a reaction the player chose in a window (Enhanced Spider-Sense), not for a card played from hand. */
  get payingForReaction(): boolean {
    return !this.#payment && !!this.snapshot().payment;
  }

  undo(): boolean {
    // Picking "Spend ..." on an either-or is no move of its own: undoing it goes back to the two halves.
    if (this.snapshot().choice?.eitherOr === "spend") {
      this.cancel();
      return true;
    }
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
    this.#moves.length = previous.moves;
    this.#setGame(previous.game, []);
    return true;
  }

  /** The shuffle the game on the table was dealt with. */
  get seed(): number {
    return this.#seed;
  }

  /** The engine's own state of the game this moment, for a bug report: plain data, never changed in place. */
  get engineState(): GameState {
    return this.#game;
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
    this.#seed = options.seed ?? PRACTICE_SEED;
    this.#encounter = {
      difficulty: options.difficulty ?? "standard",
      modules: options.modules ?? [recommendedModule(this.#matchup.villain)],
    };
    this.#history = [];
    this.#events = [];
    this.#moves = [];
    this.#sent = null;
    this.#dealt = options.arrange
      ? null
      : {
          hero: this.#matchup.hero,
          villain: this.#matchup.villain,
          difficulty: this.#encounter.difficulty,
          modules: [...this.#encounter.modules],
          seed: this.#seed,
          mulligan: options.mulligan === true,
          deck: options.deck ?? null,
        };
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
    this.#eitherOrSpending = null;
    this.#actions = legalActions(state, state.players[0]!.playerId, TABLE_DEPS);
    this.#plays.clear();
    if (this.#actions.kind === "turn") {
      for (const entry of this.#actions.legal) {
        if (entry.action.kind === "playCard") this.#plays.set(entry.action.instanceId, entry);
      }
    }
    this.#clearPayment();
  }

  /** Sends a command to the engine (throwing when it refuses), remembering it for the replay once it goes in. */
  #apply(command: Command): ReturnType<typeof apply> {
    const result = apply(this.#game, command);
    this.#sent = command;
    return result;
  }

  /** Sends a command to the engine, which may refuse it; one it takes is remembered for the replay once it goes in. */
  #try(command: Command): ReturnType<typeof applyCommand> {
    const result = applyCommand(this.#game, command, TABLE_DEPS);
    this.#sent = result.ok ? command : null;
    return result;
  }

  /**
   * The game so far as a replay: the deal and every move, undone ones left out. Null for a dev set-up (`?scene=`),
   * whose arranged table no deal makes again.
   */
  get replay(): GameReplay | null {
    return this.#dealt ? { v: 1, deal: this.#dealt, moves: [...this.#moves] } : null;
  }

  /**
   * Plays a move kept in a replay (`record/replay.ts`): exactly as the table played it, beats and all. False when the
   * engine refuses it, which means the replay isn't this game's (or this code isn't the code it was played on).
   */
  replayMove(command: Command): boolean {
    const result = this.#try(command);
    if (!result.ok) return false;
    this.#accept(result);
    return true;
  }

  #accept(result: ReturnType<typeof apply>): void {
    // The move as the player made it, for the replay (the forced answers below are the engine's, made again on replay).
    const sent = this.#sent;
    this.#sent = null;
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
      moves: this.#moves.length,
    });
    if (sent) this.#moves.push(sent);
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
        choice.options.length !== 1 ||
        // An attack card guard narrows to its minion still asks, to say why the villain can't be chosen.
        this.#attackPickGuard(result.state, choice)
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
        TABLE_DEPS,
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
    // The main scheme is one card through all its stages: until it advances in these events, it is still called by
    // the stage it was on (the threat that completes Underground Distribution goes on Underground Distribution, and
    // Hostile Takeover's When Completed discard is Hostile Takeover's, not the next stage's).
    const mainId = this.#game.mainScheme.instanceId;
    let mainStageName = faceUpName(this.#game, mainId);
    // A card that turns over in these events (Norman Osborn into the Green Goblin, Criminal Enterprise into State of
    // Madness) is called by the side it showed until its flip comes round: "Norman Osborn interrupts", then the flip.
    const turnsHere = new Set<string>(
      events.flatMap((e) => (e.type === "villainFlipped" || e.type === "cardFlipped" ? [e.instanceId] : [])),
    );
    const turned = new Set<string>();
    const name = (id: InstanceId) =>
      drones.has(id)
        ? DRONE_NAME
        : id === mainId
          ? mainStageName
          : turnsHere.has(id) && !turned.has(id)
            ? (shortIdentityNameOf(this.#game, id) ?? faceUpName(this.#game, id))
            : (shortIdentityNameOf(result.state, id) ?? faceUpName(result.state, id));
    /** The cards these events put into play facedown as minions: each is seen leaving its pile as it moves. */
    const facedownPuts = new Set<string>(
      events.flatMap((e) => (e.type === "cardPutIntoPlayFacedown" && e.as === "minion" ? [e.instanceId] : [])),
    );
    const schemeName = name;
    /** The boost cards of these events: one shuffled back into the encounter deck after its activation is shown going. */
    const boostedHere = new Set<string>(
      events.flatMap((e) => (e.type === "cardMoved" && e.from.kind === "boost" ? [e.instanceId] : [])),
    );
    /** The cards these events bring into a play area (a minion engaging): only those attack by Quickstrike. */
    const enteredHere = new Set<string>(
      events.flatMap((e) => (e.type === "cardMoved" && e.to.kind === "playArea" ? [e.instanceId] : [])),
    );
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
    // Cards dealt to the player (the deal, a hazard icon, a surge), this move or waiting facedown from an earlier one:
    // each is revealed in its turn, never "brought in" by the ability that resolved before it.
    const dealt = new Set<string>(this.#game.players[0]!.dealtEncounter);
    // The card whose question this move answers (Eviction Notice's "Choose one"): what follows is still its doing.
    const answered = this.#game.pendingChoice;
    const askedBy = answered ? (choiceSourceOf(this.#game, answered)?.instanceId ?? null) : null;
    const asking = askedBy ? { card: askedBy } : null;
    const millSourceOf = (source: { card: InstanceId; label: string }) => {
      const card = cardOf(result.state, source.card) ?? cardOf(this.#game, source.card);
      const miss = card ? missLineOf(plainRulesTextOf(card)) : null;
      // Named as it was when it discarded: Hostile Takeover's When Completed is Hostile Takeover's, though the main
      // scheme has turned to Corporate Acquisition by the end of the move.
      return { ...source, ...(miss ? { miss } : {}), by: name(source.card) };
    };
    /** Its text discards from a deck ("Discard the top card of your deck for each ...", Black Cat's "top 2 cards"). */
    /** Its text discards the cards it looked at ("Add 1 to your hand and discard the others", Futurist). */
    const millsOrDiscardsOthers = (id: InstanceId) => {
      const card = cardOf(result.state, id) ?? cardOf(this.#game, id);
      // An identity keeps its text on its faces (Tony Stark's Futurist is on his alter-ego face).
      const faces = card
        ? [card, ...["hero", "alterEgo"].map((face) => (card as unknown as Record<string, unknown>)[face])]
        : [];
      return faces.some(
        (face) => !!face && /\bdiscard the others\b/i.test(plainRulesTextOf(face as typeof card & object)),
      );
    };
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
    // Each scheme's threat as these events go by, from the game before the move: every threat beat carries the number
    // its scheme should read once it lands.
    const threatNow = new Map<string, number>();
    const threatOf = (id: string) => threatNow.get(id) ?? getInstance(this.#game, id as InstanceId)?.threat ?? 0;
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
      if (e.type === "encounterCardDealt") dealt.add(e.instanceId);
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
        threatNow.set(mainId, 0);
        const card = cardOf(result.state, mainId);
        const stage = card?.type === "main_scheme" ? card.stages[e.stageIndex] : undefined;
        const from = mainStageName;
        mainStageName = stage?.name ?? card?.name ?? mainStageName;
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
        (e.from.kind === "encounterDeck" ||
          e.from.kind === "encounterDiscard" ||
          e.from.kind === "setAside" ||
          // A boost card whose Boost puts it into play (Goblin Soldier, Goblin Thrall): turned up, then in play.
          e.from.kind === "boost") &&
        (!revealedHere.has(e.instanceId) || e.from.kind === "boost") &&
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
      } else if (e.type === "cardFlipped") {
        // A card in play turning over to its other side (Criminal Enterprise to State of Madness and back): named by
        // the side it leaves, then the side it shows.
        const from = name(e.instanceId);
        turned.add(e.instanceId);
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          cardFlip: e.instanceId,
          text: `${from} turns over: ${name(e.instanceId)}`,
        });
      } else if (e.type === "villainFlipped") {
        turned.add(e.instanceId);
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
          e.type === "encounterCardRevealed" && resolving && resolving.card !== e.instanceId && !dealt.has(e.instanceId)
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
            // An ability of its own ("When Revealed (Hero):"), not the words quoted (Media Coverage's "Resolve each
            // "When Revealed" ability ... 1 additional time").
            whenRevealed: !!card && /\bWhen Revealed(?:\s*\([^)]*\))?\s*:/i.test(plainRulesTextOf(card)),
            ...(card && e.type === "encounterCardRevealed"
              ? formWhenRevealed(plainRulesTextOf(card), result.state.players[0]!.identity.form)
              : {}),
            ...(card && e.type === "encounterCardRevealed"
              ? villainWhenRevealed(
                  plainRulesTextOf(card),
                  faceUpName(result.state, result.state.villains[0]!.instanceId),
                )
              : {}),
            ...(card &&
            e.type === "encounterCardRevealed" &&
            whenRevealedMissesHeroes(plainRulesTextOf(card), result.state.players[0]!.identity.form)
              ? { noHeroes: true as const }
              : {}),
            ...(card && e.type === "encounterCardRevealed"
              ? whenRevealedAttacksYourHero(plainRulesTextOf(card), result.state.players[0]!.identity.form)
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
                  : // The card whose question this move answers (Tony Stark's Futurist: "add 1 to your hand and discard
                    // the others"), its ability still under way.
                    asking && millsOrDiscardsOthers(asking.card)
                    ? { millSource: millSourceOf({ card: asking.card, label: "Action" }) }
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
      } else if (
        e.type === "cardMoved" &&
        // A boost card shuffled back after its activation (Goblin Knight, Monster: discarded, then shuffled in) goes
        // the same way; a whole discard pile reshuffled when the deck runs out does not (it has a beat of its own).
        (e.from.kind === "setAside" || (e.from.kind === "encounterDiscard" && boostedHere.has(e.instanceId))) &&
        e.to.kind === "encounterDeck"
      ) {
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
      } else if (
        e.type === "lastingEffectAdded" &&
        e.effect.kind === "traitGrant" &&
        e.effect.trait &&
        !e.effect.loses
      ) {
        // A trait the hero gains for a while (Rocket Boots: "gain the Aerial trait until the end of the phase"): the
        // log says so, as the hero's card does (`cardFacts`), since other cards ask for it (Supersonic Punch's 8).
        const hero = result.state.players[0]!.identity.instanceId;
        const trait = String(e.effect.trait);
        const until =
          e.effect.duration.kind === "endOfPhase"
            ? " until the end of the phase"
            : e.effect.duration.kind === "endOfRound"
              ? " until the end of the round"
              : "";
        if (
          traitsOf(result.state, hero, TABLE_DEPS).includes(e.effect.trait) &&
          !traitsOf(this.#game, hero, TABLE_DEPS).includes(e.effect.trait)
        )
          this.#beats.push({
            enemy,
            actor: hero,
            text: `${name(hero)} gains the ${trait.charAt(0) + trait.slice(1).toLowerCase()} trait${until}`,
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
        // Quickstrike only as he engages: a minion already engaged that a card makes attack (Gang-Up, Tail Sweep with
        // Scorpion out) is not attacking by his keyword.
        const quickstrike = !!card && /\bQuickstrike\b/i.test(plainRulesTextOf(card)) && enteredHere.has(attacker);
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
      } else if (e.type === "abilityResolved" && TABLE_DEPS.abilities[e.abilityId]?.trigger.kind === "interrupt") {
        // What it interrupts: the innermost game event still waiting to happen when it resolved, which can have been
        // set going a move earlier (the attack Backflip was offered on). Said, so a player sees what was stopped or
        // changed, and by what (Adam, 2026-11-28: Norman Osborn's interrupt swallowed an attack without a word).
        const interrupted = interruptedEventOf([...this.#events, ...events.slice(0, events.indexOf(e))], e.instanceId);
        const what = interrupted ? interruptedWords(interrupted, e.instanceId, name) : null;
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          interrupt: e.instanceId,
          interruptBy: {
            label: triggerLabel(e.abilityId),
            villain: e.controllerId === null,
            subject: interrupted ? triggerSubjectOf(interrupted, true).subject : null,
          },
          text: what ? `${name(e.instanceId)} interrupts ${what}` : `${name(e.instanceId)} interrupts`,
        });
      } else if (e.type === "threatPrevented" && e.amount > 0) {
        // Threat that never lands ("I Object!") leaves no threat change behind: the log says it was kept off.
        this.#beats.push({
          enemy,
          actor: e.schemeInstanceId,
          text: `${e.amount} threat kept off ${schemeName(e.schemeInstanceId)}`,
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
          source.abilities.some((ref) => TABLE_DEPS.abilities[ref.id]?.label?.includes("attack"))
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
              : // An ally's own damage for attacking or thwarting (consequential damage) is taken, not dealt to itself:
                // "Daredevil takes 1 damage", where "Daredevil deals 1 damage to Daredevil" read as a mistake.
                sourceId && sourceId !== e.targetInstanceId
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
          threat: {
            scheme: e.schemeInstanceId,
            delta: placed ? e.amount : -e.amount,
            to: Math.max(0, threatOf(e.schemeInstanceId) + (placed ? e.amount : -e.amount)),
          },
        });
        threatNow.set(e.schemeInstanceId, this.#beats.at(-1)!.threat!.to);
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
      const by = beat.millSource ? `${beat.millSource.by ?? name(beat.millSource.card as InstanceId)}: d` : "D";
      beat.text = `${by}iscard ${beat.milled.length === 1 ? "the top card" : `the top ${beat.milled.length} cards`} of your deck (${names})`;
    }
    for (const beat of this.#beats) {
      if (!beat.encounterMilled) continue;
      const count = beat.encounterMilled.length;
      const names = beat.encounterMilled
        .map((id) => cardOf(result.state, id as InstanceId)?.name ?? "a card")
        .join(", ");
      const by = beat.millSource ? `${beat.millSource.by ?? name(beat.millSource.card as InstanceId)}: d` : "D";
      beat.text = `${by}iscard ${count === 1 ? "the top card" : `the top ${count} cards`} of the encounter deck (${names})`;
    }
    // The attack waits on a question (whether to defend): it is aimed now, as the question asks. With no question
    // waiting, the attack never came (Norman Osborn's was replaced by his infamy interrupt): nothing to aim.
    if (heldAim && result.state.pendingChoice) {
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
    const committed = commitObserver?.({
      model: this,
      before: this.#game,
      after: result.state,
      events,
      beats: this.#beats,
    });
    this.#events.push(...events);
    this.#setGame(result.state, drawn);
    committed?.();
  }

  /**
   * The cards a question offers from a pile the table doesn't lay out face up (a deck, a discard pile, set aside):
   * each card's face and which pile it is in, so the player sees what they are choosing (`BattleChoice.searched`).
   */
  #searched(options: BattleChoice["options"]): BattleChoice["searched"] {
    const state = this.#game;
    const found: NonNullable<BattleChoice["searched"]> = [];
    for (const { cardId } of options) {
      if (!cardId || found.some((each) => each.id === cardId)) continue;
      const zone = locateCard(state, cardId as InstanceId);
      const from = zone ? PILE_NAMES[zone.kind] : undefined;
      if (!from) continue;
      found.push({ id: cardId, card: this.#shownCard(cardId as InstanceId), from });
    }
    return found.length ? found : undefined;
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
      hp: Math.max(0, remainingHitPoints(state, id, TABLE_DEPS) ?? 0),
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
    // The view's words are "Just happened: a defense" (Counter-Punch): name who defended against whom.
    if (event.kind === "defended")
      return `${this.#card(event.defenderInstanceId).name} defended against ${this.#card(event.enemyInstanceId).name}'s attack`;
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
    if (threatCannotBeRemoved(state, TABLE_DEPS, id, true, player.playerId, hero, [hero]))
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
          const trigger = TABLE_DEPS.abilities[id]?.trigger.kind;
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
        ? { hp: Math.max(0, remainingHitPoints(state, id, TABLE_DEPS) ?? 0) }
        : {}),
      ...(card?.type === "minion" && instance?.engagedWith && hasKeyword(state, id, "guard", TABLE_DEPS)
        ? { guard: true as const }
        : {}),
      reverseArt:
        id === state.players[0]!.identity.instanceId
          ? (artFor(card, { kind: state.players[0]!.identity.form === "hero" ? "alterEgo" : "hero" })?.url ?? null)
          : null,
      threatTarget: card?.type === "main_scheme" ? schemePanel(state, id, TABLE_DEPS, true).target : null,
      threat:
        card && ["main_scheme", "side_scheme", "player_side_scheme"].includes(card.type)
          ? (getInstance(state, id)?.threat ?? 0)
          : null,
      exhausted: getInstance(state, id)?.exhausted ?? false,
      landscape: isLandscapeType(card?.type ?? ""),
      art: artFor(card, faceOf(state, id, { viewer, deps: TABLE_DEPS }))?.url ?? "",
      type: card?.type ?? "card",
      playable: !!action,
      requiresHeroForm: !!blocked && blocked.reason === "wrong_form" && state.players[0]!.identity.form === "alterEgo",
      cost: playCostOf(state, viewer, id, TABLE_DEPS)?.current ?? null,
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
      ? paymentView(this.#game, this.#game.players[0]!.playerId, this.#payment, "", TABLE_DEPS)
      : null;
  }

  #extraSpendMatters(id: InstanceId): boolean {
    const card = cardOf(this.#game, id);
    return (
      (!!card && "specialCost" in card && card.specialCost === "X") ||
      readsOverpaid(this.#game, TABLE_DEPS, { kind: "playCard", instanceId: id })
    );
  }

  #windowPayment(): BattlePayment | null {
    const state = this.#game;
    const choice = state.pendingChoice;
    const prompt = choice?.prompt;
    if (!choice || (prompt?.kind !== "payForCard" && prompt?.kind !== "payForAbility")) return null;
    const sheet = paymentSheetView(state, choice, this.#windowPicks, TABLE_DEPS)!;
    const cost = TABLE_DEPS.abilities[prompt.abilityId]?.cost;
    // A typed cost ("spend a [mental] resource", Black Widow): only a card with that resource, or a wild one, pays it,
    // and the screen says what is still owed, as the payment for a card from hand does.
    // A mixed cost (a [mental] and one more of any kind) is left to the engine: any card pays its generic part.
    const typed =
      cost?.resources && typeof cost.resources === "object" && !isResourcesChoice(cost.resources)
        ? Object.entries(cost.resources as Record<string, number>).filter(([type, n]) => type !== "generic" && n > 0)
        : [];
    if (cost?.resources && !isResourcesChoice(cost.resources) && (cost.resources as Record<string, number>).generic)
      typed.length = 0;
    const canAdd =
      !sheet.canConfirm ||
      this.#extraSpendMatters(prompt.instanceId) ||
      cost?.resourcesX !== undefined ||
      (prompt.kind === "payForAbility" && !!prompt.chosenResources && sheet.paid < prompt.chosenResources.max);
    const sources: BattlePayment["sources"] = [];
    for (const option of choice.options) {
      if (option.ref.kind !== "ability" && option.ref.kind !== "card") continue;
      const pool = paymentOptionsPool(state, TABLE_DEPS, choice.playerId, [option.optionId], prompt.instanceId);
      sources.push({
        id: option.optionId,
        cardId: option.ref.instanceId,
        label: optionLabelOf(state, option),
        icons: RESOURCE_TYPES.flatMap((type) => Array<ResourceType>(pool?.[type] ?? 0).fill(type)),
        selected: this.#windowPicks.includes(option.optionId),
        available:
          this.#windowPicks.includes(option.optionId) ||
          ((canAdd ||
            (option.ref.kind === "ability" && TABLE_DEPS.abilities[option.ref.abilityId]?.overpayOnly === true)) &&
            (!typed.length || !!pool?.wild || typed.some(([type]) => (pool?.[type as ResourceType] ?? 0) > 0))),
        kind: option.optionId.startsWith("hand:") ? "handCard" : "resourceAbility",
      });
    }
    return {
      ability: prompt.kind === "payForAbility",
      ...(typed.length && !sheet.canConfirm ? { outstanding: typed.map(([type, n]) => `${n} ${type}`) } : {}),
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
        ? TABLE_DEPS.abilities[this.#payment.action.abilityId]?.cost?.resourcesX
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
      TABLE_DEPS.abilities[this.#payment.action.abilityId]?.cost?.resourcesX === undefined &&
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
                    abilityShortLabelOf(state, this.#subject, this.#payment.action.abilityId, TABLE_DEPS) ??
                    "an ability"
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
        ? choiceSourcePanelOf(state, pending, player.playerId, TABLE_DEPS)
        : null;
    // The revealed encounter card asking: its ability named on the panel, or, where the panel can't name it (Electric
    // Whip Attack's "Choose one"), a card just revealed (not a boost card) whose text opens with When Revealed.
    const revealed =
      panel?.abilityLine?.startsWith("When Revealed") ||
      (panel &&
        !panel.abilityLine &&
        /^When Revealed\s*:/i.test(panel.rulesText) &&
        state.players[0]!.dealtEncounter.includes(panel.instanceId))
        ? panel
        : null;
    // A boost card's ability asking (Android Efficiency's "Choose to either spend a [energy] resource or put the top card
    // of the deck into play … as a Drone minion"): the question names that card, where it read "Villain phase" and the
    // player looked for it on Ultron (Adam, 2026-11-25: "what is this resource question being triggered from?").
    const boostSource = pending && !revealed ? choiceSourceOf(state, pending) : null;
    // A boost card is one an enemy holds among its boost cards (the source's ability can't always be pinned down: a
    // card with a When Revealed and a Boost has two).
    const boosted =
      boostSource &&
      Object.values(state.instances).some((instance) => instance?.boostCards.includes(boostSource.instanceId))
        ? faceUpName(state, boostSource.instanceId)
        : null;
    const trigger = pending && triggerWindowContextOf(state, pending, player.playerId, TABLE_DEPS);
    const costDiscard = this.#costDiscard;
    const choice = costDiscard
      ? {
          id: `cost:${costDiscard.entry.action.kind === "useAbility" ? costDiscard.entry.action.abilityId : this.#subject}`,
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
            ...this.#guardChoice(this.#targetPick),
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
                this.#setupAbilityTitle(pending) ??
                this.#chooseCardsTitle(pending) ??
                eitherOrTitle(state, pending) ??
                promptTitleOf(pending.prompt, TABLE_DEPS, pending, state),
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
              ...(pending.prompt.kind === "assignIndirectDamage"
                ? {
                    prompt: `Divide ${pending.prompt.amount} damage among your characters`,
                    indirect: { amount: pending.prompt.amount },
                    // The card dealing it (Pumpkin Bombs, Green Goblin's When Revealed), named over the question.
                    ...(choiceSourcePanelOf(state, pending, player.playerId, TABLE_DEPS)?.name
                      ? { sourceTitle: choiceSourcePanelOf(state, pending, player.playerId, TABLE_DEPS)!.name }
                      : {}),
                  }
                : {}),
              ...(revealed
                ? {
                    sourceTitle: `${revealed.name} · When Revealed`,
                    // "Choose a target" for "choose and discard an upgrade you control" (Electric Whip Attack): which.
                    ...(promptTitleOf(pending.prompt, TABLE_DEPS, pending, state) === "Choose a target" &&
                    /\bchoose and discard an? (upgrade|support)\b/i.exec(revealed.rulesText)
                      ? {
                          prompt: `Choose ${/\bchoose and discard an? (upgrade|support)\b/i.exec(revealed.rulesText)![1] === "upgrade" ? "an upgrade" : "a support"} to discard`,
                        }
                      : {}),
                    explanation: revealed.rulesText.split(/\n+/)[0]!.replace(/^When Revealed\s*:\s*/i, ""),
                  }
                : {}),
              ...(boosted ? { sourceTitle: `${boosted} · Boost` } : {}),
              // An encounter attachment choosing its host among equals (Biomechanical Upgrades: "Attach to the minion
              // with the highest printed hit points", two tied): the question names the card and says its rule.
              ...(!revealed && pending.prompt.kind === "chooseAttachmentTarget"
                ? attachQuestion(state, pending.prompt.instanceId, pending.options)
                : {}),
              // A pick among cards an ability of the player's turned up (Tony Stark's Futurist: "Look at the top 3
              // cards of your deck. Add 1 to your hand"): the question names the card and the ability, and says it.
              ...(!revealed && pending.prompt.kind === "chooseCards" && state.step.phase !== "villain"
                ? pickQuestion(state, pending)
                : {}),
              ...handDiscardQuestion(state, pending),
              // An attack card's enemy pick that guard narrows (Swinging Web Kick with Hydra Mercenary out): why the
              // villain isn't among the answers.
              ...this.#guardFields(this.#attackPickGuard(state, pending)),
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
                          effect: readableEffect(triggerEffectOf(state, option, player.playerId, TABLE_DEPS)),
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
                    : // Wakanda Forever!'s sequence: each step is a different upgrade's "Special", named by the card.
                      pending.prompt.kind === "orderSpecials" && option.ref.kind === "ability"
                      ? faceUpName(state, option.ref.instanceId)
                      : option.ref.kind === "ability"
                        ? (abilityShortLabelOf(state, option.ref.instanceId, option.ref.abilityId, TABLE_DEPS) ??
                          `Use ${faceUpName(state, option.ref.instanceId)}`)
                        : option.ref.kind === "card" && pending.prompt.kind === "declareDefender"
                          ? "Defend"
                          : pending.prompt.kind === "declareDefender" && option.optionId === "decline"
                            ? "Don’t defend"
                            : optionLabelOf(state, option),
                // Every step of a revealed card's order is that one card: buttons, not the card picked twice. The
                // steps of Wakanda Forever! are upgrades tucked under the hero, too far under to pick in order: buttons.
                cardId:
                  pending.prompt.kind !== "orderWhenRevealed" &&
                  pending.prompt.kind !== "orderSpecials" &&
                  (option.ref.kind === "card" || option.ref.kind === "ability")
                    ? option.ref.instanceId
                    : null,
              })),
              canSkip: pending.minSelections === 0,
              canCancel: false,
              ...affectsOf(state, pending),
              min: pending.minSelections,
              max: pending.maxSelections,
              discardFromHand: pending.prompt.kind === "discardDownToHandSize",
              ...(pending.prompt.kind === "spendResources" ? { spend: true } : {}),
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
    // Encounter attachments on the player's own cards (All Tied Up, Media Coverage on the hero): the villain's cards,
    // drawn on their host, so the player sees why the form change is gone and can click them for their Actions.
    const onYours = [player.identity.instanceId, ...player.playArea].flatMap((host) =>
      (getInstance(state, host)?.attachments ?? []).filter((id) => ENCOUNTER_TYPES.has(cardOf(state, id)?.type ?? "")),
    );
    const enemyIds = new Set([
      state.mainScheme.instanceId,
      ...state.villainArea,
      ...(getInstance(state, villain.instanceId)?.attachments ?? []),
      ...hostile,
      ...onYours,
    ]);
    enemyIds.delete(villain.instanceId);
    for (const host of enemyIds) for (const id of getInstance(state, host)?.attachments ?? []) enemyIds.add(id);
    const searched = choice ? this.#searched(choice.options) : undefined;
    const asked = this.#eitherOrStep(choice && searched ? { ...choice, searched } : choice);
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
      heroHp: Math.max(0, remainingHitPoints(state, player.identity.instanceId, TABLE_DEPS) ?? 0),
      villainHp: Math.max(0, remainingHitPoints(state, villain.instanceId, TABLE_DEPS) ?? 0),
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
      choice: asked,
      turn: state.outcome
        ? "finished"
        : state.step.phase === "villain"
          ? "enemy"
          : state.step.kind === "turn" && !state.step.ended
            ? "player"
            : "ending",
      round: state.round,
      setup: state.step.phase === "setup",
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
    // A card played from hand: only when the play itself discards (the engine's example names a discard pick), not a
    // discard printed on a later ability of the card (Alpha Flight Station made free by Helicarrier costs no discard).
    if (entry.example.type === "playCard" && !entry.example.costChoices?.discard) return false;
    const cost =
      entry.action.kind === "useAbility"
        ? TABLE_DEPS.abilities[entry.action.abilityId]?.cost
        : playedAbilityRefs(cardOf(this.#game, source))
            .map((ref) => TABLE_DEPS.abilities[ref.id])
            .find((ability) => ability?.trigger.kind === "action" && ability.cost?.discardFromHand)?.cost;
    const discard = cost?.discardFromHand;
    if (!discard) return false;
    const candidates = handDiscardCandidates(this.#game, TABLE_DEPS, source, this.#game.players[0]!.playerId, cost);
    const max = Math.min(discard.max ?? candidates.length, candidates.length);
    this.#costDiscard = { entry, candidates, min: discard.min, max };
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
    const opened = beginPayment(this.#game, this.#game.players[0]!.playerId, entry.action, target, TABLE_DEPS);
    if (!opened) {
      // A free play has no resource picker. Keep the chosen attachment host and validate the empty payment.
      if (entry.example.type !== "playCard") return false;
      const result = this.#try({ ...entry.example, attachToInstanceId: target, payment: [] });
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
    // Spending an either-or's resources called off: back to its two halves.
    if (this.snapshot().choice?.eitherOr === "spend") {
      this.#eitherOrSpending = null;
      this.#view = null;
      return;
    }
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
    this.#accept(this.#apply(command));
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
      const ability = TABLE_DEPS.abilities[action.abilityId];
      if (ability?.trigger.kind !== "action") return [];
      const short = abilityShortLabelOf(this.#game, action.instanceId, action.abilityId, TABLE_DEPS) ?? "Use ability";
      // The exhaust icon on the button already says "exhaust", so the label is only what the action does.
      let does = short.replace(/^exhaust\b[^→·:]*[→·:]\s*/i, "");
      // A short label that is only the cost ("Exhaust", Aunt May's): what the card's text says it does after the
      // arrow ("heal 4 damage from Peter Parker").
      if (/^exhaust\b/i.test(does)) {
        const card = cardOf(this.#game, action.instanceId);
        const effect = card ? /→\s*([^.(]+)/.exec(plainRulesTextOf(card))?.[1]?.trim() : undefined;
        if (effect) does = effect;
      }
      const card = cardOf(this.#game, action.instanceId);
      const text = card ? plainRulesTextOf(card) : "";
      // "Choose a player. That player returns …", with one player at the table: what that player does (Stark Tower:
      // "Return the topmost Tech upgrade in your discard pile to your hand", where the label read "Choose a player").
      if (/^choose a player\b/i.test(does)) {
        const that = /That player (\w+?)s? ([^.]+)\./.exec(text);
        if (that) does = `${that[1]} ${that[2]}`.replace(/\btheir\b/g, "your");
      }
      // A cost that hurts the card itself (War Machine: "Exhaust War Machine and deal 2 damage to him →"): the label
      // says so, as an ally's attack says what it costs.
      const selfDamage = /\band deal (\d+) damage to (?:him|her|it)\b[^→]*→/i.exec(text)?.[1];
      const named =
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
      const label = selfDamage ? `${named} (takes ${selfDamage} damage)` : named;
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
      const profile = characterProfile(state, id as InstanceId, TABLE_DEPS);
      return `SCH ${profile?.sch ?? DRONE_BASE.sch} ATK ${profile?.atk ?? DRONE_BASE.atk} · ${DRONE_FACTS}`;
    }
    const card = cardOf(state, id as InstanceId);
    if (!card) return "";
    const identity = state.players[0]!.identity;
    // The face showing: the hero's current form, a flipped encounter card's other side (Criminal Enterprise turned
    // over to State of Madness reads State of Madness's text), else the card.
    const flipped = encounterFace(state, id as InstanceId);
    const face =
      card.type === "hero_identity" && id === identity.instanceId
        ? ((card as unknown as Record<string, unknown>)[identity.form === "hero" ? "hero" : "alterEgo"] as
            | typeof card
            | undefined)
        : flipped
          ? ({ ...card, ...flipped } as typeof card)
          : card;
    const profile = characterProfile(state, id as InstanceId, TABLE_DEPS);
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
    // Traits the hero has gained for now (Rocket Boots' Aerial): what cards that ask for a trait read. The hero only: a
    // villain's traits are on its stages, not its card, so every one of them would read as gained.
    const printedTraits = ((face as { traits?: readonly unknown[] } | undefined)?.traits ?? []).map(String);
    const gained = (id === identity.instanceId ? traitsOf(state, id as InstanceId, TABLE_DEPS) : [])
      .map(String)
      .filter((trait) => !printedTraits.includes(trait))
      .map((trait) => `Now ${trait.charAt(0) + trait.slice(1).toLowerCase()}`);
    // A printed [energy] icon reads as a word: "Spend a [energy] resource" is "Spend an energy resource".
    return [stats.join(" "), ...gained, text.replace(/\ba (?=energy\b)/g, "an "), ...icons].filter(Boolean).join(" · ");
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
   * A question a hero's setup ability asks before the first turn (Black Panther's Foresight: "Search your deck for a
   * Black Panther upgrade and add it to your hand"), named by the ability and what it does; the engine's own title is
   * only "Choose cards".
   */
  #setupAbilityTitle(pending: NonNullable<GameState["pendingChoice"]>): string | undefined {
    if (this.#game.step.phase !== "setup" || pending.prompt.kind === "mulligan") return undefined;
    const identity = this.#game.players[0]!.identity;
    const card = cardOf(this.#game, identity.instanceId) as unknown as Record<string, unknown> | undefined;
    const face = card?.[identity.form === "hero" ? "hero" : "alterEgo"] as Parameters<typeof plainRulesTextOf>[0];
    const name = face ? /([A-Z][\w' -]*?) — Setup:/.exec(plainRulesTextOf(face))?.[1] : undefined;
    return name ? this.#identityAbilityLabel(name) : undefined;
  }

  /**
   * The engine titles a pick of cards "Choose cards" (Shuri's search of the deck, Ancestral Knowledge's pick from the
   * discard pile): the asking card's own words say what the pick is for ("Search your deck for an upgrade and add it to
   * your hand"). The turn bar's eyebrow already names the card. It is the sentence that does the picking (search,
   * choose, shuffle, return, take): Masters of Mayhem's search for a minion comes after its attack sentence, and a card
   * with no such sentence keeps the engine's title.
   */
  #chooseCardsTitle(pending: NonNullable<GameState["pendingChoice"]>): string | undefined {
    if (pending.prompt.kind !== "chooseCards") return undefined;
    const source = choiceSourceOf(this.#game, pending)?.instanceId;
    const card = source ? cardOf(this.#game, source) : undefined;
    if (!card || card.type === "hero_identity") return undefined;
    const sentence = plainRulesTextOf(card)
      .replace(/^[^:]*:\s*/, "")
      .split(/\.(?:\s|$)/)
      .map((part) => part.replace(/^(?:Then,\s*)?(?:(?:After|When|If)\b[^,]*,\s*)?/i, "").trim())
      .find((part) => /\b(?:search|choose|shuffle|return|take)\b/i.test(part));
    return sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : undefined;
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
    return { form: player.identity.form, handSize: handSize(this.#game, player.playerId, TABLE_DEPS) };
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
    return ref ? abilityLabelOf(this.#game, cardId as InstanceId, ref.id, TABLE_DEPS) : null;
  }

  /** The damage an ally takes after attacking or thwarting (the small number beside its ATK and THW); 0 for others. */
  consequentialDamage(id: string, power: "attack" | "thwart"): number {
    const card = cardOf(this.#game, id as InstanceId);
    if (card?.type !== "ally" || isFacedownMinion(this.#game, id as InstanceId)) return 0;
    return card.consequentialDamage?.[power] ?? 0;
  }

  basicPower(id: string, stat: "atk" | "thw" | "rec"): number {
    return characterProfile(this.#game, id as InstanceId, TABLE_DEPS)?.[stat] ?? 0;
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
      const payment = beginPayment(this.#game, this.#game.players[0]!.playerId, entry.action, null, TABLE_DEPS);
      if (!payment) return false;
      this.#subject = entry.action.instanceId;
      this.#payment = payment;
      this.#view = null;
    } else this.#accept(this.#apply(entry.example));
    return true;
  }

  heroAction(kind: string): boolean {
    const entry = this.#heroEntries().find((e) => e.action.kind === kind);
    if (entry) return this.#usePower(entry);
    // One of the identity's own Action abilities (Rechannel, Commander).
    return this.fieldAction(this.#game.players[0]!.identity.instanceId, kind);
  }

  /**
   * Guard keeping an attack off the villain (RRG 1.8 "Guard", p. 21: "The engaged player cannot attack any villain";
   * other minions stay attackable): the villains `attacker` can't reach for guard alone among those not `offered`,
   * and the guard minions engaged with the player. Null when guard is not what keeps the villain out.
   */
  #guardFacts(
    state: GameState,
    attacker: InstanceId,
    offered: readonly string[],
    basic: boolean,
  ): { blocked: InstanceId[]; guards: InstanceId[] } | null {
    const blocked = state.villains
      .filter((villain) => !villain.defeated)
      .map((villain) => villain.instanceId)
      .filter(
        (id) =>
          !offered.includes(id) &&
          canAttack(state, attacker, id, TABLE_DEPS, basic, true) &&
          !canAttack(state, attacker, id, TABLE_DEPS, basic),
      );
    if (!blocked.length) return null;
    const playerId = state.players[0]!.playerId;
    const guards = state.players[0]!.playArea.filter(
      (id) =>
        shownType(state, id) === "minion" &&
        getInstance(state, id)?.engagedWith === playerId &&
        hasKeyword(state, id, "guard", TABLE_DEPS),
    );
    return guards.length ? { blocked, guards } : null;
  }

  /** A basic attack that guard narrows (`#guardFacts`). Null for any other power. */
  #guardBlocked(entry: LegalAction): { blocked: InstanceId[]; guards: InstanceId[] } | null {
    if (entry.action.kind !== "basicAttack") return null;
    return this.#guardFacts(this.#game, entry.action.instanceId, entry.targets, true);
  }

  /**
   * An attack card's or ability's enemy pick (Swinging Web Kick, "(attack): Deal 8 damage to an enemy") that guard
   * narrows: the engine's `chooseTarget` step for it asks for an enemy the player's identity can attack
   * (`attackableBy`), so a villain left out of it is left out by guard. Null for any other question.
   */
  #attackPickGuard(state: GameState, choice: NonNullable<GameState["pendingChoice"]>) {
    if (choice.prompt.kind !== "chooseTarget") return null;
    // The prompt names no ability; the effects frame asking it does.
    const frame = state.stack.find((each) => each.frameId === choice.frameId);
    const abilityId =
      choice.prompt.abilityId ?? (frame && "abilityId" in frame ? (frame.abilityId as string | undefined) : undefined);
    const ability = abilityId ? TABLE_DEPS.abilities[abilityId as keyof typeof TABLE_DEPS.abilities] : undefined;
    if (!ability || !asksAttackableEnemy(ability.effects, choice.prompt.slot)) return null;
    const offered = choice.options.flatMap((option) => (option.ref.kind === "card" ? [option.ref.instanceId] : []));
    return this.#guardFacts(state, state.players[0]!.identity.instanceId, offered, false);
  }

  /** The guard fields of a question (`BattleChoice.guard`), with the reason said in words. */
  #guardFields(
    guard: { blocked: InstanceId[]; guards: InstanceId[] } | null,
  ): Pick<BattleChoice, "guard" | "explanation" | "prompt"> | Record<string, never> {
    if (!guard) return {};
    const state = this.#game;
    const guards = guard.guards.map((id) => faceUpName(state, id));
    const villain = faceUpName(state, guard.blocked[0]!);
    const who =
      guards.length === 1 ? `${guards[0]} has` : `${guards.slice(0, -1).join(", ")} and ${guards.at(-1)} have`;
    return {
      prompt: "Choose an enemy to attack",
      guard,
      explanation: `${who} Guard: ${villain} can't be attacked until ${guards.length === 1 ? "it is" : "they are"} defeated.`,
    };
  }

  /** The attack pick's guard fields, for a basic attack. */
  #guardChoice(entry: LegalAction) {
    return this.#guardFields(this.#guardBlocked(entry));
  }

  #usePower(entry: LegalAction): boolean {
    // Guard narrowing the attack to its minion still asks: the pick shows why the villain can't be chosen.
    if (entry.targets.length > 1 || (entry.targets.length === 1 && this.#guardBlocked(entry))) {
      this.#targetPick = entry;
      this.#view = null;
    } else this.#accept(this.#apply(entry.example));
    return true;
  }

  #endTurnCommand(): Command | undefined {
    if (this.#subject || this.#targetPick || this.#actions.kind !== "turn") return;
    return this.#actions.legal.find((entry) => entry.action.kind === "endTurn")?.example;
  }

  endTurn(): boolean {
    const command = this.#endTurnCommand();
    if (!command) return false;
    this.#accept(this.#apply(command));
    return true;
  }

  /**
   * An either-or spend shown in two steps (`BattleChoice.eitherOr`): first its two halves as buttons, then, once
   * "Spend ..." is picked, the cards that pay it. Any other question passes through.
   */
  #eitherOrStep(choice: BattleChoice | null): BattleChoice | null {
    const pending = this.#game.pendingChoice;
    if (!choice || !pending || pending.prompt.kind !== "spendResources" || pending.prompt.required) return choice;
    if (choice.id !== pending.choiceId) return choice;
    const halves = /^Spend (.+?), or (.+)\?$/.exec(choice.prompt);
    if (!halves) return choice;
    if (this.#eitherOrSpending === pending.choiceId)
      return { ...choice, prompt: `Spend ${halves[1]}`, eitherOr: "spend", canSkip: false, canCancel: true };
    return {
      ...choice,
      prompt: "Choose one",
      eitherOr: "choose",
      payers: choice.options.flatMap((option) => (option.cardId ? [option.cardId] : [])),
      options: [
        { id: EITHER_SPEND, label: `Spend ${halves[1]}`, cardId: null },
        { id: EITHER_OTHERWISE, label: halves[2]!.charAt(0).toUpperCase() + halves[2]!.slice(1), cardId: null },
      ],
      min: 1,
      max: 1,
      canSkip: false,
      canCancel: false,
    };
  }

  /** An answer to an either-or spend's first step; null when `ids` isn't one. */
  #answerEitherOr(ids: readonly string[]): boolean | null {
    if (ids.length !== 1 || (ids[0] !== EITHER_SPEND && ids[0] !== EITHER_OTHERWISE)) return null;
    if (this.snapshot().choice?.eitherOr !== "choose") return false;
    if (ids[0] === EITHER_OTHERWISE) {
      this.#eitherOrSpending = null;
      return this.chooseMany([]);
    }
    this.#eitherOrSpending = this.#game.pendingChoice!.choiceId;
    this.#view = null;
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
          this.#apply(
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

  /**
   * For a spend the player may decline (Sonic Boom: "Either spend [energy][mental][physical] resources or exhaust each
   * character you control"): whether these picks pay it. The engine takes picks that don't pay as not spending, and
   * the "or" happens with the cards still in hand, so the table only lets a spend through that pays (an empty pick is
   * the decline). Null when the question isn't such a spend.
   *
   * Every card picked must be needed: one that could be left out and the rest still pay is refused, so the table
   * never spends cards past the cost (Adam, 2026-11-26: Sonic Boom asked for three and took six). A card making more
   * than is needed stays allowed: RRG 1.8 (Cost) lets a player generate resources beyond a cost, the excess lost.
   */
  spendPays(ids: readonly string[]): boolean | null {
    const choice = this.#game.pendingChoice;
    if (choice?.prompt.kind !== "spendResources" || choice.prompt.required) return null;
    if (ids.includes(EITHER_SPEND) || ids.includes(EITHER_OTHERWISE)) return null;
    if (!ids.length) return true;
    const prompt = choice.prompt;
    const pays = (picks: readonly string[]) => {
      const pool = paymentOptionsPool(this.#game, TABLE_DEPS, choice.playerId, picks, null);
      // A spend asking for several different types (none in the Core Set) is left to the engine.
      if (prompt.distinctTypes) return pool !== null;
      return pool !== null && satisfies(pool, combineRequirements(prompt.requirement, 0));
    };
    if (!pays(ids)) return false;
    return ids.length === 1 || ids.every((id) => !pays(ids.filter((other) => other !== id)));
  }

  /**
   * The symbols a spend that can be declined asks for, each lit once the picks pay it, and which cards not yet picked
   * would still pay one (Adam, 2026-11-26: "if we have the science symbol paid for then others with the science symbol
   * become not selectable"). A card is only pickable when it pays a symbol still unlit; once every symbol is lit,
   * none is. Null when the question isn't such a spend (or asks for several different types, left to the engine).
   */
  spendMeter(ids: readonly string[]): SpendMeter | null {
    const choice = this.#game.pendingChoice;
    if (choice?.prompt.kind !== "spendResources" || choice.prompt.required || choice.prompt.distinctTypes) return null;
    const picks = ids.filter((id) => id !== EITHER_SPEND && id !== EITHER_OTHERWISE);
    const req = combineRequirements(choice.prompt.requirement, 0);
    const poolOf = (list: readonly string[]) =>
      list.length ? paymentOptionsPool(this.#game, TABLE_DEPS, choice.playerId, list, null) : null;
    const filled = (pool: ReturnType<typeof poolOf>) => fillSpend(req, pool);
    const now = filled(poolOf(picks));
    const lit = (counts: SpendFill) => counts.wild + counts.energy + counts.mental + counts.physical + counts.any;
    const need: SpendNeed[] = [];
    const slots: [SpendNeed["type"], number, number][] = [
      ["wild", req.wild ?? 0, now.wild],
      ["energy", req.energy, now.energy],
      ["mental", req.mental, now.mental],
      ["physical", req.physical, now.physical],
      ["any", req.generic, now.any],
    ];
    for (const [type, asked, paid] of slots) for (let i = 0; i < asked; i++) need.push({ type, paid: i < paid });
    const useful = new Set<string>();
    for (const option of choice.options)
      if (!picks.includes(option.optionId) && lit(filled(poolOf([...picks, option.optionId]))) > lit(now))
        useful.add(option.optionId);
    // What each pick lit when it was picked: the symbols newly paid as the picks are added one by one.
    const paidBy = new Map<string, SpendNeed["type"][]>();
    let before = filled(null);
    picks.forEach((id, i) => {
      const after = filled(poolOf(picks.slice(0, i + 1)));
      const types: SpendNeed["type"][] = [];
      for (const type of ["wild", "energy", "mental", "physical", "any"] as const)
        for (let n = before[type]; n < after[type]; n++) types.push(type);
      paidBy.set(id, types);
      before = after;
    });
    return { need, useful, paidBy };
  }

  chooseMany(ids: readonly string[]): boolean {
    const answered = this.#answerEitherOr(ids);
    if (answered !== null) return answered;
    if (this.spendPays(ids) === false) return false;
    if (this.#costDiscard) {
      const { entry, candidates, min, max } = this.#costDiscard;
      if (ids.length < min || ids.length > max || ids.some((id) => !candidates.includes(id as InstanceId)))
        return false;
      if (entry.example.type !== "useAbility" && entry.example.type !== "playCard") return false;
      const result = this.#try({
        ...entry.example,
        costChoices: { ...entry.example.costChoices, discard: ids as InstanceId[] },
      });
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
    const result = this.#try({
      type: "resolveChoice",
      choiceId: choice.choiceId,
      playerId: choice.playerId,
      selectedOptionIds: ids,
    });
    if (!result.ok) return false;
    this.#accept(result);
    return true;
  }
}

/** How a card's ability is printed: "Forced Response", "Interrupt", "Action". */
function triggerLabel(abilityId: string): string {
  const trigger = TABLE_DEPS.abilities[abilityId]?.trigger;
  if (!trigger) return "Ability";
  if (trigger.kind === "response" || trigger.kind === "interrupt") {
    const kind = trigger.kind === "response" ? "Response" : "Interrupt";
    return "forced" in trigger && trigger.forced ? `Forced ${kind}` : kind;
  }
  if (trigger.kind === "action") return trigger.forced ? "Forced Action" : "Action";
  return "Ability";
}
