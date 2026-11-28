/**
 * "Nothing happens in the game without the table showing it" (Adam, 2026-11-25): the watcher every driven game runs
 * under (the fuzz, the deck audits). Tests only.
 *
 * Each committed move (`observeCommits`, model.ts) is read three ways:
 *
 * 1. What changed in the game (a state diff of the cards the move touched): zone, facing, damage, threat, statuses,
 *    counters, exhausted, attachment, controller, tucked cards; the villain's stage, the main scheme's stage, the
 *    acceleration tokens; each character's ATK/THW/DEF/REC/SCH/hit points, keywords and traits; the hand size.
 *    Each change is shown by a beat naming the card (`BEAT_FIELDS` says which beats the table plays out and which
 *    only reach the dock's words), or by the table's standing picture changing for that card (`STANDING` says where).
 * 2. What happened with no change to see (`EVENT_RULES`): damage or threat prevented, a reveal cancelled, a search
 *    that found nothing, an ability that resolved, an effect that lasts. Each needs a beat naming its card.
 * 3. What stands while it lasts: every character's stats against its printed ones, on its markers at every move.
 *
 * Every result is put down to the card whose ability, play, reveal or activation was resolving (the engine's own
 * frames), which makes the per-card ledger (`docs/project/core-set-shown.md`, `core-set-shown.test.ts`).
 *
 * Classes: "table" (a card moves, a token or marker changes, a stamp or banner: the table plays it out), "log" (only
 * the dock's words say it: Adam said "visually", so this is NOT a pass until he has seen that list), "silent".
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";
import {
  cardOf,
  characterProfile,
  getInstance,
  handSize,
  keywordsOf,
  locateCard,
  printedProfile,
  traitsOf,
  type GameEvent,
  type GameState,
  type InstanceId,
} from "@mc/engine";
import { CORE_DEPS } from "@mc/cards";
import { watchQuestions } from "./question-watch.js";
import { observeCommits, type BattleBeat, type BattleCard, type BattleSnapshot, type CommittedMove } from "./model.js";

export type ShownClass = "table" | "log" | "silent";

/**
 * Every `BattleBeat` field and what `main.ts` (`present`) does with it. "table": it plays out on the table (a card
 * moves, a stamp, a strike, a marker, a banner). "meta": it only qualifies another field or the dock's words. A beat
 * with no "table" field is words in the dock and its feed only ("log"), unless it names an `actor`, whose card is
 * marked on the table while the words show (`markActor`). `shown-beats.test.ts` checks this list against model.ts
 * and main.ts.
 */
export const BEAT_FIELDS: Record<string, { cls: "table" | "meta"; where: string }> = {
  text: { cls: "meta", where: "the dock's title and its feed" },
  enemy: { cls: "meta", where: "the dock's colour (villain or hero)" },
  activity: { cls: "meta", where: "the dock's eyebrow in the villain phase" },
  actor: {
    cls: "meta",
    where: "the card is marked on the table while the words show (markActor): words, not a change",
  },
  round: { cls: "meta", where: "the round on a phase banner" },
  random: { cls: "meta", where: "with handDiscard/tucked: a light hops across the hand first" },
  penalty: { cls: "meta", where: "with encounterDeal: marks the deal as the run-out price" },
  returnedFrom: { cls: "meta", where: "with returned: where the cards fly from" },
  nemesis: { cls: "meta", where: "with intoEncounterDeck: the nemesis set's cards" },
  removedFromGame: { cls: "meta", where: "with leftPlay: the card evaporates instead of going to a pile" },
  millSource: { cls: "meta", where: "with milled: the card that did it, and the miss line" },
  droneWas: { cls: "meta", where: "with defeatedCard: the card under the Drone, named" },
  gameEnded: { cls: "meta", where: "ends the play-out; the game-over panel follows" },
  phase: { cls: "table", where: "the phase banner (Your turn / Villain phase)" },
  statusChange: { cls: "table", where: "a status card added to or taken off the card, with a ring" },
  enemyActivation: { cls: "table", where: "the enemy activates: it lifts and is stamped" },
  scheming: { cls: "table", where: "the enemy is stamped Schemes" },
  discardEvent: { cls: "table", where: "the event card flies to the discard pile" },
  interrupt: { cls: "table", where: "the card pulses (an interrupt), cancelling what it is held over" },
  cardFlip: { cls: "table", where: "the card turns over on the table to its other side, like the villain" },
  stayedExhausted: {
    cls: "table",
    where: "the card is stamped Can't ready with the card whose rule it is named under it (All Tied Up), which rings",
  },
  again: {
    cls: "table",
    where: "the revealed card is stamped Again with the card whose rule it is named under it, which rings",
  },
  interruptBy: {
    cls: "table",
    where: "the interrupting card is stamped Interrupt / Forced Interrupt, and what it interrupts Interrupted",
  },
  deflection: { cls: "table", where: "the attack is knocked away by the card, Blocked floats up" },
  modifier: { cls: "table", where: "a stat token on the card, with a ring" },
  attackAim: { cls: "table", where: "the attacker aims at its target" },
  stunnedAttempt: { cls: "table", where: "the stunned enemy strains, its stun goes" },
  turned: { cls: "table", where: "the card turns (exhausts or readies)" },
  draw: { cls: "table", where: "cards fly from the deck into the hand" },
  encounterDeal: { cls: "table", where: "an encounter card flies to the player facedown" },
  villainStage: { cls: "table", where: "the villain card turns to its next stage" },
  villainFlip: { cls: "table", where: "the villain card flips" },
  schemeAdvance: { cls: "table", where: "the main scheme turns to its next stage" },
  entersPlay: { cls: "table", where: "the card comes onto the table" },
  droneIn: { cls: "table", where: "the card leaves its pile facedown as a Drone" },
  defeat: { cls: "table", where: "the Defeated stamp and banner" },
  defeatedCard: { cls: "table", where: "the card flashes and leaves for its pile" },
  leftPlay: { cls: "table", where: "the card leaves the table for its pile" },
  handDiscard: { cls: "table", where: "the cards fly from the hand to the discard pile" },
  returned: { cls: "table", where: "the cards fly back into the hand" },
  milled: { cls: "table", where: "the deck's top cards turn up and go to the discard pile" },
  encounterMilled: { cls: "table", where: "the encounter deck's top cards turn up and go to its discard pile" },
  tucked: { cls: "table", where: "the cards go facedown under the card" },
  deckReset: { cls: "table", where: "the discard pile shuffles into a new deck" },
  intoEncounterDeck: { cls: "table", where: "the cards are shown and shuffled into the encounter deck" },
  encounterReset: { cls: "table", where: "the encounter discard pile shuffles into a new deck" },
  acceleration: { cls: "table", where: "an acceleration token on the main scheme, stamped" },
  overkill: { cls: "table", where: "the Overkill stamp on the card the damage spills onto" },
  discount: { cls: "table", where: "the cost stamp on the card that gave it" },
  nothingFound: { cls: "table", where: "the No target stamp on the card" },
  boostFor: { cls: "table", where: "the boost card lies facedown beside its enemy" },
  surge: { cls: "table", where: "the Surge! stamp, then the extra card" },
  reveal: { cls: "table", where: "the encounter card turns up in the middle of the table" },
  encounterResolved: { cls: "table", where: "the revealed card goes to the encounter discard pile" },
  activate: { cls: "table", where: "the card's ability is shown activating on it" },
  threat: { cls: "table", where: "threat flies onto or off the scheme" },
  hit: { cls: "table", where: "the strike, the damage burst and the hit-point label" },
};

/**
 * Where the table's standing picture shows a change on its own, with no beat: the snapshot the table draws differs
 * for that card (`BattleCard`, or which pile it lies in).
 */
export const STANDING: Record<string, string> = {
  zone: "the card is seen in a new place (hand, table, a discard pile, under a card, beside an enemy)",
  faceup: "the card is seen faceup or facedown",
  damage: "the damage marker or hit-point label on the card",
  threat: "the threat on the scheme",
  statuses: "the status markers on the card",
  counters: "the counters on the card",
  exhausted: "the card is drawn turned",
  attachedTo: "the card is drawn on its host",
  tucked: "the tucked count on the card",
  stats: "the stat tokens on the card (its markers)",
  villainStage: "the villain card's picture and name",
  side: "the card's picture and name are its other side's (swapped where it lies, unless a beat turns it over)",
  acceleration: "the acceleration marker on the main scheme",
};

/**
 * How a change to a card reaches the table, which `cls: "table"` alone does not say (Adam, 2026-11-28: Criminal
 * Enterprise became State of Madness "with no animation, it just teleported", and this watcher had called it shown):
 *
 * - "played": a beat of the kind that plays out that change names the card (`CHANGE_FIELDS`).
 * - "borrowed": some other beat names the card in the same move (a counter coming off credited for a flip).
 * - "repainted": no beat at all: the table's picture of the card simply differs afterwards. The table animates a few
 *   of these itself (a card turning as it exhausts, a card flying to a new place); the rest change where they lie.
 *
 * "borrowed" and "repainted" are listed per card in the shard (`unplayed`) and gated wherever a file has a
 * `shown-baseline/<file>.played.json`. They are what `.claude/skills/new-content` reads for a new pack.
 */
export type Seen = "played" | "borrowed" | "repainted";

/** The beat fields that play out each kind of change to a card. */
export const CHANGE_FIELDS: Record<string, readonly string[]> = {
  zone: [
    "entersPlay",
    "leftPlay",
    "defeatedCard",
    "discardEvent",
    "draw",
    "handDiscard",
    "returned",
    "milled",
    "encounterMilled",
    "tucked",
    "intoEncounterDeck",
    "encounterDeal",
    "reveal",
    "encounterResolved",
    "droneIn",
    "boostFor",
    "deckReset",
    "encounterReset",
  ],
  faceup: [
    "reveal",
    "boostFor",
    "droneIn",
    "cardFlip",
    "encounterDeal",
    "milled",
    "encounterMilled",
    "tucked",
    "handDiscard",
  ],
  // Healing is a statusChange named "damage" with a minus: the heal number floats off the card.
  damage: ["hit", "defeat", "defeatedCard", "statusChange"],
  threat: ["threat", "schemeAdvance", "defeatedCard"],
  // Tough used up is its own hit beat ("Tough prevents 3 damage"): the tough card lifts off.
  statuses: ["statusChange", "stunnedAttempt", "hit"],
  counters: ["statusChange"],
  exhausted: ["turned"],
  // Only a beat that turns the card over: with none, the picture swaps where it lies (Adam, 2026-11-28).
  side: ["cardFlip", "villainFlip"],
  // A revealed attachment is dealt, turned up, then flies onto its host (the table's "equip" flight, measured frame by
  // frame on All Tied Up, 2026-11-28).
  attachedTo: ["entersPlay", "leftPlay", "defeatedCard", "tucked", "reveal"],
  controller: ["entersPlay"],
  tucked: ["tucked", "leftPlay", "defeatedCard"],
};

type Rule =
  | { kind: "bookkeeping"; why: string }
  | { kind: "state"; why: string }
  | {
      kind: "beat";
      what: string;
      /** Only beats with one of these fields count as showing it. */
      fields?: readonly string[];
      /** A beat with one of these fields shows it whatever card it names (the canceller pulses over the card). */
      anyBeat?: readonly string[];
    };

const book = (why: string): Rule => ({ kind: "bookkeeping", why });
const state = (why = "checked as the change it makes"): Rule => ({ kind: "state", why });
const beat = (what: string, fields?: readonly string[], anyBeat?: readonly string[]): Rule => ({
  kind: "beat",
  what,
  ...(fields ? { fields } : {}),
  ...(anyBeat ? { anyBeat } : {}),
});

/**
 * Every engine event type the watched games have met, and how it must be shown. "bookkeeping": no game fact of its
 * own (the engine's stack, questions, payments). "state": checked as the state change it makes. "beat": nothing to
 * see in the state, so a beat must name its card. A type with no entry is reported, never passed.
 */
export const EVENT_RULES: Record<string, Rule> = {
  // The engine's own machinery.
  framePushed: book("the engine's stack"),
  framePopped: book("the engine's stack"),
  triggerEvent: book("the engine's timing points"),
  windowOpened: book("a timing window: what is used in it is checked"),
  choiceRequested: book("the question is the dock's"),
  choiceResolved: book("the player's own answer"),
  abilityUseRecorded: book("a use limit counted"),
  paymentCommitted: book("the payment screen showed it"),
  resourcesGenerated: book("the payment screen showed it"),
  costPartPaidBy: book("the payment screen showed it"),
  turnStarted: book("the phase banner shows the turn"),
  turnEnded: book("the phase banner shows the turn"),
  roundStarted: book("the phase banner shows the round"),
  stepChanged: book("the phase banner and the dock's eyebrow"),
  firstPlayerChanged: book("one player: always first"),
  gameEnded: book("the game-over panel"),
  playerEliminated: book("the game-over panel"),
  handRefilled: book("each card drawn is a change of its own"),
  attackResolved: book("the attack's damage is a change of its own"),
  schemeResolved: book("the scheme's threat is a change of its own"),
  defenderDeclared: book("the player's own answer"),
  defenseDeclined: book("the player's own answer"),
  attackAwaitsAbility: book("the attack waits for a question the dock asks"),
  attackResumed: book("the attack goes on: what it does is checked"),
  activationAwaitsAbility: book("the activation waits for a question the dock asks"),
  costDamageSettled: book("a cost the player chose to pay"),
  damageBeyondZeroLost: book("damage past the last hit point: the card is defeated"),
  deckStacked: book("set-up only"),
  setupOptionApplied: book("set-up only"),
  boostIconsCounted: book('the attack\'s numbers line says the boost ("2 SCH · 1 boost")'),
  targetChosen: book("the player's answer, or the only one there was: what it does to the card is checked"),
  optionChosen: book("the player's answer, or the only one there was: what it does is checked"),
  // Checked as the state change they make.
  cardMoved: state(),
  cardDrawn: state(),
  cardDiscardedFromHand: state(),
  cardDiscardedFromPlay: state(),
  cardDiscardedFromDeck: state(),
  cardDiscardedFromEncounterDeck: state(),
  encounterCardDealt: state(),
  boostCardDealt: state(),
  boostCardFlipped: state(),
  encounterCardRevealed: state(),
  cardPlayed: state(),
  cardPutIntoPlayFacedown: state(),
  threatPlaced: state(),
  threatRemoved: state(),
  damageDealt: state(),
  damagePlaced: state(),
  damageHealed: state(),
  statusGiven: state(),
  statusRemoved: state(),
  counterAdded: state(),
  counterRemoved: state(),
  cardExhausted: state(),
  cardReadied: state(),
  formChanged: state(),
  characterDefeated: state(),
  schemeDefeated: state(),
  mainSchemeAdvanced: state(),
  mainSchemeCompleted: state("the game ends: the game-over panel"),
  villainStageAdvanced: state(),
  villainStageRevealed: state(),
  villainFlipped: state(),
  // Only a beat that turns the card over counts: the words alone, or another beat on the same card in the same move
  // (the last infamy counter coming off), let Criminal Enterprise swap to State of Madness unseen (Adam, 2026-11-28).
  cardFlipped: beat("a card turned over to its other side", ["cardFlip"]),
  accelerationTokenAdded: state(),
  playerDeckReset: state(),
  cardTurnedFaceup: state(),
  cardTurnedFacedown: state(),
  // Nothing in the state to see: a beat must name the card.
  abilityResolved: beat("the ability fired"),
  enemyActivated: beat("the enemy activates", ["enemyActivation", "scheming", "attackAim", "stunnedAttempt"]),
  surgeTriggered: beat("surge", ["surge"]),
  overkillSpilled: beat("overkill", ["overkill"]),
  damagePrevented: beat("damage prevented"),
  threatPrevented: beat("threat prevented"),
  damageNotDealt: beat("damage not dealt"),
  damageReduced: beat("damage reduced"),
  damageIncreased: beat("damage increased"),
  damageDoubled: beat("damage doubled"),
  damageCapped: beat("damage capped"),
  healBlocked: beat("healing blocked"),
  threatRemovalBlocked: beat("threat removal blocked"),
  revealCancelled: beat("a revealed card cancelled", undefined, ["interrupt"]),
  revealReplaced: beat("a reveal replaced"),
  boostCancelled: beat("a boost cancelled"),
  boostIgnored: beat("a boost ignored"),
  boostWithheld: beat("a boost withheld"),
  activationBlocked: beat("an activation blocked"),
  activationCancelled: beat("an activation cancelled"),
  activationSkipped: beat("an activation skipped"),
  abilityIgnored: beat("an ability ignored"),
  abilityNotOffered: beat("an ability not offered"),
  interruptConditionLapsed: beat("an interrupt's condition lapsed"),
  retaliateIgnoredByRanged: beat("retaliate ignored by ranged"),
  keywordResolved: beat("a keyword resolved"),
  choiceFoundNothing: beat("a choice with nothing to choose", ["nothingFound"]),
  searchFoundNothing: beat("a search that found nothing", ["nothingFound"]),
  preThenUnresolved: beat("the text before a 'then' did not resolve"),
  thenSkipped: beat("the text after a 'then' was skipped"),
  cardsLookedAt: beat("cards looked at"),
  deckTopShown: beat("the deck's top card shown"),
  encounterTopShown: beat("the encounter deck's top card shown"),
  cardFound: beat("a card found by a search"),
  deckShuffled: beat("a deck shuffled", undefined, ["deckReset", "encounterReset", "intoEncounterDeck"]),
  lastingEffectAdded: beat("an effect that lasts begins"),
  lastingEffectEnded: beat("an effect that lasts ends"),
  playCostReduced: beat("a cost reduced", ["discount"]),
  discardRefused: beat("a discard refused"),
  uniqueEntryBlocked: beat("a unique card kept out"),
  putIntoPlayRefused: beat("a card kept out of play"),
  leavePlayBlocked: beat("a card kept in play"),
  basicPowerNotMade: beat("a basic power not made"),
  encounterCardPassed: beat("an encounter card passed on"),
};

/** The events that make each kind of change to a card: the change is the doing of whoever was resolving then. */
const CAUSES: Record<string, readonly string[]> = {
  zone: ["cardMoved", "cardDrawn", "cardDiscardedFromHand", "cardDiscardedFromPlay", "cardDiscardedFromDeck"],
  side: ["cardFlipped", "villainFlipped"],
  faceup: ["cardTurnedFaceup", "cardTurnedFacedown", "encounterCardRevealed", "boostCardFlipped", "cardMoved"],
  damage: ["damageDealt", "damagePlaced", "damageHealed"],
  threat: ["threatPlaced", "threatRemoved"],
  statuses: ["statusGiven", "statusRemoved"],
  counters: ["counterAdded", "counterRemoved", "countersMoved"],
  exhausted: ["cardExhausted", "cardReadied"],
  attachedTo: ["cardMoved", "cardDetached", "permanentAttachmentRehosted"],
  controller: ["controllerChanged"],
  tucked: ["cardMoved", "tuckedCardSpent"],
};

/** Meta fields of a beat that never count as naming a card. */
const NOT_NAMING = new Set(["text", "enemy", "activity", "round", "phase", "random", "penalty", "gameEnded"]);

function beatClass(b: BattleBeat): ShownClass {
  for (const [key, value] of Object.entries(b)) {
    if (value === undefined || value === null || value === false) continue;
    if (BEAT_FIELDS[key]?.cls === "table") return "table";
  }
  return b.text ? "log" : "silent";
}

/** The ids a beat names in its fields (not its words), deep. */
function namedIds(b: BattleBeat): Set<string> {
  const ids = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") ids.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const [key, value] of Object.entries(b)) if (!NOT_NAMING.has(key)) walk(value);
  return ids;
}

/** Where a card lies in the picture the table draws. */
function placeIn(snap: BattleSnapshot, id: string): string {
  if (snap.hero.id === id) return "hero";
  if (snap.villain.id === id) return "villain";
  const lists: [string, readonly { id: string }[]][] = [
    ["hand", snap.hand],
    ["play", snap.inPlay],
    ["enemy", snap.enemyCards],
    ["discard", snap.discard],
    ["encounterDiscard", snap.encounterDiscard],
    ["under", snap.under],
    ["boost", snap.facedownBoosts],
  ];
  for (const [name, list] of lists) if (list.some((c) => c.id === id)) return name;
  if (snap.facedownEncounters.includes(id)) return "dealt";
  return "hidden";
}

function cardIn(snap: BattleSnapshot, id: string): BattleCard | undefined {
  if (snap.hero.id === id) return snap.hero;
  if (snap.villain.id === id) return snap.villain;
  return [...snap.inPlay, ...snap.enemyCards, ...snap.hand, ...snap.discard, ...snap.encounterDiscard].find(
    (c) => c.id === id,
  );
}

const markersOf = (card: BattleCard | undefined) =>
  JSON.stringify([...(card?.markers ?? [])].sort((a, b) => a.name.localeCompare(b.name)));

/** The ledger row a resolving frame belongs to. */
interface Owner {
  readonly instanceId: string;
  readonly what: string;
}

function ownerOfFrame(frame: GameState["stack"][number]): Owner | null {
  switch (frame.kind) {
    case "ability":
      return { instanceId: frame.instanceId, what: frame.abilityId };
    case "reveal":
      return { instanceId: frame.instanceId, what: "revealed" };
    case "playCard":
      return { instanceId: frame.instanceId, what: "played" };
    case "enemyAttack":
    case "enemyScheme":
      return { instanceId: frame.enemyInstanceId, what: "activation" };
    // Effects from before the watch began (a setup ability, Foresight): the card whose text they are.
    case "effects":
      return frame.selfInstanceId ? { instanceId: frame.selfInstanceId, what: "effects" } : null;
    default:
      return null;
  }
}

function ownerOfDescription(description: string): Owner | null {
  let m = /^ability (\S+) on (\S+)$/.exec(description);
  if (m) return { instanceId: m[2]!, what: m[1]! };
  m = /^reveal (\S+) \(/.exec(description);
  if (m) return { instanceId: m[1]!, what: "revealed" };
  m = /^play (\S+) \(/.exec(description);
  if (m) return { instanceId: m[1]!, what: "played" };
  m = /^enemy (?:attack|scheme) by (\S+) \(/.exec(description);
  if (m) return { instanceId: m[1]!, what: "activation" };
  return null;
}

/** Every instance id an event mentions (its `…InstanceId` fields, `instanceIds`, a lasting effect's source). */
function idsOf(e: GameEvent, known: GameState["instances"]): string[] {
  const ids: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (typeof value === "string") {
      if (value in known) ids.push(value);
    } else if (depth < 6 && Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
    else if (depth < 6 && value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) if (k !== "type") walk(v, depth + 1);
  };
  walk(e, 0);
  return [...new Set(ids)];
}

/** One result: a change or an event, shown on the table, in the dock's words only, or not at all. */
export interface Result {
  readonly row: string;
  readonly kind: string;
  readonly cls: ShownClass;
  readonly how: string;
  /** A change to a card only: how it reached the table (`Seen`). */
  readonly seen?: Seen;
}

// ── Collected over this test file ─────────────────────────────────────────────────────────────────────────────────

/** Per ledger row: how often each class was seen, and what was missed. */
const rows = new Map<
  string,
  { table: number; log: number; silent: number; fired: number; unnamed: number; missed: Set<string> }
>();
/** Findings (log and silent), keyed for the baseline: row, kind, how. */
const findings = new Map<string, number>();
/** Changes that reached the table without a beat of their own kind ("borrowed", "repainted"): row, kind, seen. */
const unplayed = new Map<string, { times: number; how: string }>();
const unclassified = new Map<string, number>();
const eventCounts = new Map<string, number>();

function rowOf(key: string) {
  let row = rows.get(key);
  if (!row) rows.set(key, (row = { table: 0, log: 0, silent: 0, fired: 0, unnamed: 0, missed: new Set() }));
  return row;
}

function record(result: Result): void {
  const row = rowOf(result.row);
  row[result.cls]++;
  if (result.cls === "table" && result.seen && result.seen !== "played") {
    const key = `${result.row} | ${result.kind} | ${result.seen}`;
    unplayed.set(key, { times: (unplayed.get(key)?.times ?? 0) + 1, how: result.how });
  }
  if (result.cls !== "table") {
    row.missed.add(`${result.cls}: ${result.kind}`);
    const key = `${result.row} | ${result.kind} | ${result.cls}`;
    findings.set(key, (findings.get(key) ?? 0) + 1);
  }
}

/** The ledger row of a card: its code and what of it acted ("01075 | 01075.black-widow-interrupt"). */
function rowKey(state: GameState, owner: Owner | null): string {
  if (!owner) return "rules | game rules";
  const code = cardOf(state, owner.instanceId as InstanceId)?.id ?? "?";
  return `${code} | ${owner.what}`;
}

const CHARACTER_TYPES = new Set(["hero_identity", "alter_ego", "ally", "minion", "villain"]);

function statsOf(state: GameState, id: InstanceId) {
  const profile = characterProfile(state, id, CORE_DEPS);
  if (!profile) return null;
  return {
    stats: `ATK ${profile.atk} THW ${profile.thw} DEF ${profile.def} REC ${profile.rec} SCH ${profile.sch} HP ${profile.maxHp}`,
    keywords: keywordsOf(state, id, CORE_DEPS)
      .map((k) => JSON.stringify(k))
      .sort()
      .join(","),
    traits: [...traitsOf(state, id, CORE_DEPS)].sort().join(","),
  };
}

function zoneOf(state: GameState, id: InstanceId): string {
  const zone = locateCard(state, id);
  return zone ? zone.kind : "none";
}

/** An ability that resolved, waiting for its effects (in later moves, after a question) to be seen or not. */
interface Pending {
  readonly row: string;
  readonly id: string;
  readonly frames: Set<string>;
  shown: { cls: ShownClass; how: string; unnamed: boolean } | null;
  /** Something besides the engine's machinery happened while its frames were open. */
  acted: boolean;
}

/** What a game's watcher keeps between moves: whose each stack frame is, and the abilities still resolving. */
export interface Memory {
  readonly frameOwners: Map<string, Owner>;
  pending: Pending[];
}

export const newMemory = (): Memory => ({ frameOwners: new Map(), pending: [] });

const memories = new WeakMap<object, Memory>();

/** Reads one committed move; returns what to do once the move is in (the picture after it). */
function watch(move: CommittedMove) {
  const { before, after, events, beats } = move;
  for (const e of events) eventCounts.set(e.type, (eventCounts.get(e.type) ?? 0) + 1);
  const snapBefore = move.model.snapshot();
  return () => {
    const snapAfter = move.model.snapshot();
    // Each threat beat says what its scheme reads once it lands (`threat.to`); the table shows that number, so the last
    // one for each scheme must be the threat the game ends the move with.
    const lastThreat = new Map<string, number>();
    for (const b of beats) {
      if (b.threat) lastThreat.set(b.threat.scheme, b.threat.to);
      if (b.schemeAdvance) lastThreat.set(b.schemeAdvance.scheme, b.schemeAdvance.threat);
    }
    for (const [scheme, to] of lastThreat) {
      const real = after.instances[scheme]?.threat;
      if (real !== undefined && to !== real)
        throw new Error(`threat beats leave ${scheme} at ${to}, the game has ${real}`);
    }
    let memory = memories.get(move.model);
    if (!memory) memories.set(move.model, (memory = newMemory()));
    for (const result of judge(before, after, events, beats, snapBefore, snapAfter, memory)) {
      record(result);
      if (
        process.env.SHOWN_DEBUG &&
        result.cls !== "table" &&
        `${result.row} ${result.kind}`.includes(process.env.SHOWN_DEBUG)
      )
        appendFileSync(
          process.env.SHOWN_DEBUG_FILE ?? "shown-debug.log",
          `[shown] ${result.row} | ${result.kind} | ${result.cls} | ${result.how}
  stack before: ${before.stack.map((f) => `${f.frameId}:${f.kind}`).join(" ")}
  events: ${events.map((e) => (e.type === "framePushed" ? `push(${e.frameId}:${e.description})` : e.type === "framePopped" ? `pop(${e.frameId})` : e.type === "abilityResolved" ? `resolved(${e.abilityId})` : e.type)).join(" ")}
  beats: ${JSON.stringify(beats)}
`,
        );
    }
  };
}

/** Everything a move did, each judged shown on the table, in words only, or not at all. */
export function judge(
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  beats: readonly BattleBeat[],
  snapBefore: BattleSnapshot,
  snapAfter: BattleSnapshot,
  memory: Memory = newMemory(),
): Result[] {
  const results: Result[] = [];
  const known = { ...before.instances, ...after.instances };
  const classed = beats.map((b) => ({ beat: b, cls: beatClass(b), ids: namedIds(b) }));
  /** How a card is shown by this move's beats: by a beat naming it in its fields, else in words with its name. */
  const byBeat = (id: string, fields?: readonly string[]): { cls: ShownClass; how: string } | null => {
    const naming = classed.filter(
      (c) => c.ids.has(id) && (!fields || fields.some((f) => (c.beat as unknown as Record<string, unknown>)[f])),
    );
    const onTable = naming.find((c) => c.cls === "table");
    if (onTable) return { cls: "table", how: `beat: ${onTable.beat.text || Object.keys(onTable.beat).join(",")}` };
    if (naming.length) return { cls: "log", how: `words: ${naming[0]!.beat.text}` };
    const name = cardOf(after, id as InstanceId)?.name ?? cardOf(before, id as InstanceId)?.name;
    if (name) {
      const said = classed.find((c) => c.beat.text?.includes(name));
      if (said) return { cls: said.cls === "table" ? "table" : "log", how: `words: ${said.beat.text}` };
    }
    return null;
  };

  // Who is resolving at each event: the innermost frame that is an ability, a reveal, a play or an activation.
  // An ability's effects run in an "effects" frame pushed once it has resolved, often after a question, in a later move:
  // that frame is the ability's (remembered by its id across moves).
  // The engine lists its stack top first; this list is bottom first, pushed onto at its end.
  const stack: { frameId: string; owner: Owner | null }[] = [...before.stack].reverse().map((frame) => ({
    frameId: frame.frameId,
    owner: memory.frameOwners.get(frame.frameId) ?? ownerOfFrame(frame),
  }));
  const ownerAt: (Owner | null)[] = [];
  const current = () => [...stack].reverse().find((f) => f.owner)?.owner ?? null;
  let justResolved: Pending | null = null;
  for (const e of events) {
    if (e.type === "abilityResolved") {
      justResolved = {
        row: rowKey(after, { instanceId: e.instanceId, what: e.abilityId }),
        id: e.instanceId,
        frames: new Set(),
        shown: null,
        acted: false,
      };
      memory.pending.push(justResolved);
      rowOf(justResolved.row).fired++;
      // Still open (its target asked for after it resolved: Mockingbird's stun): its effects are its own frame's.
      for (const f of stack)
        if (f.owner?.instanceId === e.instanceId && f.owner.what === e.abilityId) justResolved.frames.add(f.frameId);
    }
    if (e.type === "framePushed") {
      let owner = ownerOfDescription(e.description);
      if (!owner && e.frame === "effects" && justResolved) {
        owner = { instanceId: justResolved.id, what: justResolved.row.split(" | ")[1]! };
        justResolved.frames.add(e.frameId);
        justResolved = null;
      }
      owner ??= current();
      if (owner) memory.frameOwners.set(e.frameId, owner);
      stack.push({ frameId: e.frameId, owner });
    }
    ownerAt.push(e.type === "abilityResolved" ? { instanceId: e.instanceId, what: e.abilityId } : current());
    // Anything of substance while an ability's frames are open is it acting (its effects may be in later moves).
    if (
      e.type !== "framePushed" &&
      e.type !== "framePopped" &&
      e.type !== "triggerEvent" &&
      e.type !== "abilityResolved"
    )
      for (const pending of memory.pending) if (stack.some((f) => pending.frames.has(f.frameId))) pending.acted = true;
    if (e.type === "framePopped") {
      const at = stack.findIndex((f) => f.frameId === e.frameId);
      if (at >= 0) stack.splice(at, 1);
    }
  }
  /**
   * The row a card's change belongs to: whoever was resolving at the last event of the kind that makes that change
   * and names the card (a status given, a card moved), else at the first event naming it at all.
   */
  const mentions = new Map<string, number[]>();
  events.forEach((e, i) => {
    for (const id of idsOf(e, known)) mentions.set(id, [...(mentions.get(id) ?? []), i]);
  });
  const rowFor = (id: string, change?: string) => {
    const at = mentions.get(id) ?? [];
    const causes = change ? CAUSES[change] : undefined;
    const cause = causes ? [...at].reverse().find((i) => causes.includes(events[i]!.type)) : undefined;
    const index = cause ?? at[0];
    return rowKey(after, index === undefined ? null : (ownerAt[index] ?? null));
  };
  /** Whoever was resolving last in this move: what the move as a whole did (a hand size changed) is theirs. */
  const lastOwner = [...ownerAt].reverse().find((o) => o) ?? null;

  // 1. Events with nothing in the state to see, and events of no known kind. An ability that resolved is judged after
  // the changes (2), since what it did may be what shows it.
  const lastingBefore = new Map(before.lastingEffects.map((effect) => [effect.id, effect]));
  events.forEach((e, i) => {
    const rule = EVENT_RULES[e.type];
    let row = rowKey(after, ownerAt[i] ?? null);
    if (e.type === "abilityResolved") return;
    if (e.type === "cardPlayed") rowOf(rowKey(after, { instanceId: e.instanceId, what: "played" })).fired++;
    if (e.type === "encounterCardRevealed")
      rowOf(rowKey(after, { instanceId: e.instanceId, what: "revealed" })).fired++;
    if (e.type === "enemyActivated")
      rowOf(rowKey(after, { instanceId: e.enemyInstanceId, what: "activation" })).fired++;
    // A keyword the engine reports firing (Retaliate, Quickstrike, Surge) is a row of its card's own.
    if (e.type === "keywordResolved" || e.type === "surgeTriggered") {
      row = rowKey(after, {
        instanceId: e.instanceId,
        what: `keyword ${e.type === "surgeTriggered" ? "surge" : e.keyword}`,
      });
      rowOf(row).fired++;
    }
    if (!rule) {
      unclassified.set(e.type, (unclassified.get(e.type) ?? 0) + 1);
      results.push({ row, kind: `event ${e.type} (no rule yet)`, cls: "silent", how: "" });
      return;
    }
    if (rule.kind !== "beat") return;
    // An effect that lasts is its card's: the one whose text it is, and the cards it applies to.
    const lasting =
      e.type === "lastingEffectAdded"
        ? e.effect
        : e.type === "lastingEffectEnded"
          ? lastingBefore.get(e.id)
          : undefined;
    const named = lasting ? idsOf(lasting as unknown as GameEvent, known) : idsOf(e, known);
    // Naming no card of its own (a cost reduction for the next card): it is the resolving card's doing.
    const owner = ownerAt[i]?.instanceId;
    const subject = named.length || !owner ? named : [owner];
    if (lasting && subject.length) row = rowKey(after, { instanceId: subject[0]!, what: "lasting effect" });
    // A cost reduction used up (Helicarrier's): the card it was used on costs less on the payment screen.
    if (e.type === "lastingEffectEnded" && lasting?.kind === "costReduction") {
      results.push({ row, kind: rule.what, cls: "table", how: "the next card's cost on the payment screen" });
      return;
    }
    const judged = subject.map((id) => byBeat(id, rule.fields)).filter((s) => s !== null);
    let shown: { cls: ShownClass; how: string } | null = judged.find((s) => s.cls === "table") ?? judged[0] ?? null;
    if (!shown || shown.cls !== "table") {
      const fields = rule.anyBeat ?? (!subject.length ? rule.fields : undefined);
      const hit = fields && classed.find((c) => fields.some((f) => (c.beat as unknown as Record<string, unknown>)[f]));
      if (hit) shown = { cls: hit.cls, how: `beat: ${hit.beat.text}` };
    }
    results.push({
      row,
      kind: rule.what,
      cls: shown?.cls ?? "silent",
      how: shown?.how ?? (lasting ? JSON.stringify(lasting).slice(0, 300) : ""),
    });
  });

  // 2. What changed in the game, card by card: the cards whose instance changed or that an event names.
  const candidates = new Set<string>(events.flatMap((e) => idsOf(e, known)));
  for (const id of Object.keys(after.instances)) if (after.instances[id] !== before.instances[id]) candidates.add(id);
  for (const id of candidates) {
    const was = getInstance(before, id as InstanceId);
    const is = getInstance(after, id as InstanceId);
    const changes: string[] = [];
    const zoneBefore = was ? zoneOf(before, id as InstanceId) : "none";
    const zoneAfter = is ? zoneOf(after, id as InstanceId) : "none";
    if (zoneBefore !== zoneAfter) changes.push("zone");
    if (was && is) {
      if (was.faceup !== is.faceup) changes.push("faceup");
      // Which side of a two-sided card is up (Criminal Enterprise / State of Madness).
      if (was.flipped !== is.flipped) changes.push("side");
      if (was.damage !== is.damage) changes.push("damage");
      if (was.threat !== is.threat) changes.push("threat");
      if (JSON.stringify(was.statuses) !== JSON.stringify(is.statuses)) changes.push("statuses");
      if (JSON.stringify(was.counters) !== JSON.stringify(is.counters)) changes.push("counters");
      if (was.exhausted !== is.exhausted) changes.push("exhausted");
      if (was.attachedTo !== is.attachedTo) changes.push("attachedTo");
      if (was.controllerId !== is.controllerId) changes.push("controller");
      if (was.tucked.length !== is.tucked.length) changes.push("tucked");
    }
    if (!changes.length) continue;
    const shownByBeat = byBeat(id);
    const cardBefore = cardIn(snapBefore, id);
    const cardAfter = cardIn(snapAfter, id);
    const placeBefore = placeIn(snapBefore, id);
    const placeAfter = placeIn(snapAfter, id);
    for (const change of changes) {
      const row = rowFor(id, change);
      const what =
        change === "zone"
          ? `${change} ${zoneBefore}→${zoneAfter}`
          : change === "faceup"
            ? `turned ${is?.faceup ? "faceup" : "facedown"} in ${zoneAfter}`
            : change;
      const fitting = CHANGE_FIELDS[change] ?? [];
      const played = classed.some(
        (c) =>
          c.cls === "table" &&
          c.ids.has(id) &&
          fitting.some((f) => {
            const value = (c.beat as unknown as Record<string, unknown>)[f];
            if (value === undefined || value === null || value === false) return false;
            // A status beat shows damage only when it is a heal, and a hit shows a status only when Tough took it.
            if (change === "damage" && f === "statusChange") return c.beat.statusChange?.name === "damage";
            if (change === "statuses" && f === "hit") return !!c.beat.hit?.tough;
            if ((change === "statuses" || change === "counters") && f === "statusChange")
              return c.beat.statusChange?.name !== "damage";
            return true;
          }),
      );
      if (shownByBeat?.cls === "table") {
        results.push({ row, kind: what, cls: "table", how: shownByBeat.how, seen: played ? "played" : "borrowed" });
        continue;
      }
      const standing =
        change === "side"
          ? cardBefore?.art !== cardAfter?.art || cardBefore?.name !== cardAfter?.name
            ? STANDING.side!
            : null
          : change === "zone" || change === "faceup"
            ? placeBefore !== placeAfter
              ? `${STANDING[change]} (${placeBefore}→${placeAfter})`
              : null
            : change === "damage"
              ? cardBefore?.hp !== cardAfter?.hp || markersOf(cardBefore) !== markersOf(cardAfter)
                ? STANDING.damage!
                : null
              : change === "threat"
                ? cardBefore?.threat !== cardAfter?.threat || markersOf(cardBefore) !== markersOf(cardAfter)
                  ? STANDING.threat!
                  : null
                : change === "statuses" || change === "counters" || change === "tucked"
                  ? markersOf(cardBefore) !== markersOf(cardAfter)
                    ? STANDING[change]!
                    : null
                  : change === "exhausted"
                    ? cardBefore?.exhausted !== cardAfter?.exhausted
                      ? STANDING.exhausted!
                      : null
                    : change === "attachedTo"
                      ? cardBefore?.attachedTo !== cardAfter?.attachedTo || placeBefore !== placeAfter
                        ? STANDING.attachedTo!
                        : null
                      : null;
      if (standing) results.push({ row, kind: what, cls: "table", how: `standing: ${standing}`, seen: "repainted" });
      else if (shownByBeat) results.push({ row, kind: what, cls: shownByBeat.cls, how: shownByBeat.how });
      else results.push({ row, kind: what, cls: "silent", how: "" });
    }
  }

  // The villain's stage, the main scheme's stage, acceleration.
  const villainBefore = before.villains[0];
  const villainAfter = after.villains[0];
  if (villainBefore && villainAfter && villainBefore.stageIndex !== villainAfter.stageIndex) {
    const named = classed.find((c) => c.beat.villainStage);
    results.push({
      row: rowFor(villainAfter.instanceId),
      kind: "villain stage",
      cls: named ? "table" : snapBefore.villain.name !== snapAfter.villain.name ? "table" : "silent",
      how: named ? "beat: villainStage" : `standing: ${STANDING.villainStage}`,
    });
  }
  if (before.mainScheme.stageIndex !== after.mainScheme.stageIndex) {
    const named = classed.find((c) => c.beat.schemeAdvance);
    results.push({
      row: rowFor(after.mainScheme.instanceId),
      kind: "main scheme stage",
      cls: named ? "table" : "silent",
      how: named ? "beat: schemeAdvance" : "",
    });
  }
  if (before.mainScheme.accelerationTokens !== after.mainScheme.accelerationTokens) {
    const named = classed.find((c) => c.beat.acceleration !== undefined);
    const marker =
      markersOf(cardIn(snapBefore, after.mainScheme.instanceId)) !==
      markersOf(cardIn(snapAfter, after.mainScheme.instanceId));
    results.push({
      row: rowFor(after.mainScheme.instanceId),
      kind: "acceleration",
      cls: named || marker ? "table" : "silent",
      how: named ? "beat: acceleration" : marker ? `standing: ${STANDING.acceleration}` : "",
    });
  }

  // Each character's stats, keywords and traits, against the move before (a card's own face changing is its picture).
  for (const id of new Set(
    [...snapAfter.inPlay, ...snapAfter.enemyCards, snapAfter.hero, snapAfter.villain].map((c) => c.id),
  )) {
    const card = cardOf(after, id as InstanceId);
    if (!card || !CHARACTER_TYPES.has(card.type) || !getInstance(before, id as InstanceId)) continue;
    if (cardIn(snapBefore, id)?.name !== cardIn(snapAfter, id)?.name) continue;
    if (zoneOf(before, id as InstanceId) !== zoneOf(after, id as InstanceId)) continue;
    const was = statsOf(before, id as InstanceId);
    const is = statsOf(after, id as InstanceId);
    if (!was || !is) continue;
    for (const part of ["stats", "keywords", "traits"] as const) {
      if (was[part] === is[part]) continue;
      const modifierBeat = classed.find((c) => c.beat.modifier?.id === id);
      const marker = markersOf(cardIn(snapBefore, id)) !== markersOf(cardIn(snapAfter, id));
      const shown = modifierBeat
        ? { cls: "table" as const, how: "beat: modifier" }
        : marker && part === "stats"
          ? { cls: "table" as const, how: `standing: ${STANDING.stats}` }
          : byBeat(id);
      results.push({ row: rowFor(id), kind: `${part} changed`, cls: shown?.cls ?? "silent", how: shown?.how ?? "" });
    }
  }
  // The hand size: the hero's own (Iron Man's grows with each Tech upgrade), shown nowhere on the table. A change of
  // form is the identity card turning over; a game that has just ended clears everything away.
  const player = after.players[0];
  const sameFace = before.players[0]?.identity.form === player?.identity.form;
  if (
    player &&
    sameFace &&
    !after.outcome &&
    handSize(before, player.playerId, CORE_DEPS) !== handSize(after, player.playerId, CORE_DEPS)
  )
    results.push({
      row: `${cardOf(after, player.identity.instanceId)?.id ?? "?"} | hand size`,
      kind: `hand size changed (by ${lastOwner ? rowKey(after, lastOwner).replace(" | ", " ") : "game rules"})`,
      cls: "silent",
      how: "",
    });

  // The abilities resolving: a beat names the card, or what it did shows on the table (the card itself unnamed: counted
  // apart in the ledger), or nothing shows at all. Judged once its last frame is gone, in whichever move that is.
  const open = new Set<string>(after.stack.map((frame) => frame.frameId));
  for (const pending of memory.pending) {
    if (pending.shown?.cls === "table") continue;
    const named = byBeat(pending.id);
    if (named?.cls === "table") pending.shown = { ...named, unnamed: false };
    else {
      const effect = results.find((r) => r.row === pending.row && r.cls === "table");
      if (effect) pending.shown = { cls: "table", how: `what it did shows (${effect.kind})`, unnamed: true };
      else if (named && !pending.shown) pending.shown = { ...named, unnamed: false };
    }
  }
  memory.pending = memory.pending.filter((pending) => {
    if ([...pending.frames].some((frame) => open.has(frame))) return true;
    results.push({
      row: pending.row,
      // Fired and did nothing (Assault's alter-ego half while the hero is in hero form): reported apart.
      kind: pending.acted || pending.shown ? "the ability fired" : "the ability fired and did nothing",
      cls: pending.shown?.cls ?? "silent",
      how: pending.shown?.how ?? "",
    });
    if (pending.shown?.unnamed) rowOf(pending.row).unnamed++;
    return false;
  });

  // 3. What stands while it lasts: every character's stats against its printed ones, on its markers.
  for (const card of [snapAfter.hero, snapAfter.villain, ...snapAfter.inPlay, ...snapAfter.enemyCards]) {
    const id = card.id as InstanceId;
    const printed = printedProfile(after, id);
    const profile = printed && characterProfile(after, id, CORE_DEPS);
    if (!printed || !profile || card.drone) continue;
    for (const stat of ["atk", "thw", "def", "sch"] as const) {
      if ((printed.missing as readonly string[]).includes(stat)) continue;
      const diff = profile[stat] - printed[stat];
      if (!diff) continue;
      const shown = card.markers.some((m) => m.name.toLowerCase() === stat && m.count === diff);
      if (!shown)
        results.push({
          row: `${cardOf(after, id)?.id ?? "?"} | standing`,
          kind: `${stat.toUpperCase()} ${diff > 0 ? "+" : ""}${diff} not on the card`,
          cls: "silent",
          how: "",
        });
    }
  }
  return results;
}

// ── The test file's hooks: watching, the shard, the baseline ──────────────────────────────────────────────────────

const BASELINE_DIR = new URL("./shown-baseline/", import.meta.url);

/**
 * Watch every committed move of this test file. With SHOWN_OUT set, write what was seen as a shard for the ledger.
 * `gate`: this file's findings must all be in its baseline (`shown-baseline/<file>.json`); a new one fails the file.
 * `SHOWN_BASELINE=update` writes the baseline instead. The fuzz is not gated: its random games reach old silent cases
 * as other changes move them, which is not something newly broken.
 */
export function watchThisFile(options: { name?: string; gate?: boolean } = {}): void {
  // The same games are watched for a question the table can only show plainly (question-check.ts).
  watchQuestions(options.name);
  beforeAll(() => observeCommits(watch));
  afterAll(() => {
    observeCommits(null);
    const file =
      options.name ??
      (expect.getState().testPath ?? "unknown")
        .split(/[\\/]/)
        .pop()!
        .replace(/\.test\.ts$/, "");
    const out = process.env.SHOWN_OUT;
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${file}.json`), JSON.stringify(shard(), null, 1) + "\n");
    }
    if (!options.gate) return;
    // Changes that were not played out, where this file keeps a list of the ones known (`<file>.played.json`).
    const playedPath = new URL(`${file}.played.json`, BASELINE_DIR);
    const notPlayed = [...unplayed.keys()].sort();
    if (process.env.SHOWN_PLAYED === "update") {
      mkdirSync(BASELINE_DIR, { recursive: true });
      writeFileSync(playedPath, JSON.stringify(notPlayed, null, 1) + "\n");
    } else if (existsSync(playedPath)) {
      const accepted = new Set(JSON.parse(readFileSync(playedPath, "utf8")) as string[]);
      expect(
        notPlayed.filter((key) => !accepted.has(key)),
        `A card now changes without the table playing that change out (shown-check.ts, "Seen"): it would swap or ` +
          `teleport. Give it a beat of its own kind, or if the table animates it itself, record it: ` +
          `SHOWN_PLAYED=update pnpm exec vitest run src/battle-table/${file}.test.ts`,
      ).toEqual([]);
    }
    const keys = [...findings.keys()].sort();
    const path = new URL(`${file}.json`, BASELINE_DIR);
    if (process.env.SHOWN_BASELINE === "update") {
      mkdirSync(BASELINE_DIR, { recursive: true });
      writeFileSync(path, JSON.stringify(keys, null, 1) + "\n");
      return;
    }
    let baseline: string[] = [];
    try {
      baseline = JSON.parse(readFileSync(path, "utf8")) as string[];
    } catch {
      // No baseline yet: every finding is new.
    }
    const known = new Set(baseline);
    const fresh = keys.filter((key) => !known.has(key));
    expect(
      fresh,
      `Something now happens without the table showing it (shown-check.ts). Show it, or if it is known and accepted, ` +
        `record it: SHOWN_BASELINE=update pnpm exec vitest run src/battle-table/${file}.test.ts`,
    ).toEqual([]);
  });
}

function shard() {
  const sorted = <T>(map: Map<string, T>) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
  return {
    rows: Object.fromEntries(
      [...rows]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, row]) => [key, { ...row, missed: [...row.missed].sort() }]),
    ),
    unplayed: sorted(unplayed),
    unclassified: sorted(unclassified),
    events: sorted(eventCounts),
  };
}
