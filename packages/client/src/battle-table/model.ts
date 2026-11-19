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
  legalActions,
  paymentOptionsPool,
  readsOverpaid,
  playCostOf,
  remainingHitPoints,
  type Command,
  type GameState,
  type InstanceId,
  type LegalAction,
  type LegalActions,
  type ResourceType,
} from "@mc/engine";
import { artFor } from "../art/art-source.js";
import { abilityShortLabelOf } from "../view/ability-label.js";
import {
  countersOf,
  faceOf,
  isLandscapeType,
  printedStatsOf,
  profileStatTiles,
  schemePanel,
} from "../view/board-model.js";
import { triggerEffectOf, triggerWindowContextOf } from "../view/trigger-window-context.js";
import { choiceSourcePanelOf } from "../view/choice-source-panel.js";
import { choiceSourceOf, promptTitleOf } from "../view/choice-source.js";
import { faceUpName, optionLabelOf, shortIdentityNameOf } from "../view/names.js";
import { beginPayment, paymentView, togglePayment, type PaymentState } from "../view/payment-model.js";

import { paymentSheetView } from "../view/payment-sheet.js";

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
}

export interface BattlePayment {
  ability: boolean;
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

export interface BattleChoice {
  prompt: string;
  explanation?: string;
  sourceTitle?: string;
  offers?: { id: string; cardId: string; question: string; effect: string | null }[];
  defense?: { attacker: string; target: string };
  decline?: string;
  options: { id: string; label: string; cardId: string | null }[];
  canSkip: boolean;
  canCancel: boolean;
  min: number;
  max: number;
  discardFromHand: boolean;
}

export interface BattleBeat {
  text: string;
  enemy: boolean;
  activity?: string;
  statusChange?: { id: string; name: string; delta: number };
  enemyActivation?: string;
  discardEvent?: string;
  interrupt?: string;
  deflection?: { card: string; amount: number };
  modifier?: { id: string; name: string; count: number };
  attackAim?: { source: string; target: string };
  turned?: { id: string; exhausted: boolean };
  draw?: string[];
  encounterDeal?: string;
  villainStage?: number;
  villainFlip?: boolean;
  defeat?: string;
  defeatedCard?: string;
  reveal?: {
    id: string;
    name: string;
    art: string;
    landscape: boolean;
    boost: { icons: number; enemy: string } | null;
  };
  actor?: string | null;
  phase?: "hero" | "villain";
  gameEnded?: true;
  activate?: { card: string; hero: string };
  threat?: { scheme: string; delta: number };
  hit?: { source: string | null; target: string; amount: number; tough?: boolean };
}

export interface BattleSnapshot {
  beats: readonly BattleBeat[];
  enemyCards: BattleCard[];
  hand: BattleCard[];
  deckCount: number;
  encounterCount: number;
  encounterDiscard: BattleCard[];
  facedownEncounters: readonly string[];
  choiceSource: string | null;
  drawn: readonly string[];
  hero: BattleCard;
  villain: BattleCard;
  heroActions: { kind: string; label: string }[];
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

function statModifiers(state: GameState, id: InstanceId) {
  const profile = characterProfile(state, id, CORE_DEPS);
  if (!profile) return [];
  const printed = printedStatsOf(state, id);
  const modifiers = profileStatTiles(profile, printed, ["thw", "atk", "def", "sch", "rec"], undefined, undefined)
    .filter((tile) => tile.bonus !== 0)
    .map((tile) => ({ name: tile.label, count: tile.bonus }));
  if (printed && profile.maxHp !== printed.maxHp) modifiers.push({ name: "HP", count: profile.maxHp - printed.maxHp });
  return modifiers;
}

function apply(state: GameState, command: Command) {
  const result = applyCommand(state, command, CORE_DEPS);
  if (!result.ok) throw Error(result.error.message);
  return result;
}

/** An isolated, repeatable opening turn. Seed 75 deals Swinging Web Kick, Strength and several priced permanents. */
function openingTurn(): GameState {
  const created = createGame(
    coreScenario("rhino", {
      seed: 75,
      players: [{ starterDeckId: "core-spider-man-justice" }],
    }),
    CORE_DEPS,
  );
  if (!created.ok) throw Error(created.error.message);
  const state = created.state;
  const mulligan = state.pendingChoice;
  if (mulligan?.prompt.kind !== "mulligan") throw Error("Expected Spider-Man's opening hand.");
  const turn = apply(state, {
    type: "resolveChoice",
    playerId: mulligan.playerId,
    choiceId: mulligan.choiceId,
    selectedOptionIds: [],
  });
  return turn.state;
}

export class BattleModel {
  #game!: GameState;
  #actions!: LegalActions;
  #plays = new Map<string, LegalAction>();
  #windowPicks: string[] = [];
  #payment: PaymentState | null = null;
  #subject: InstanceId | null = null;
  #targetPick: LegalAction | null = null;
  #view: BattleSnapshot | null = null;

  #beats: BattleBeat[] = [];
  #villainActivity = "";
  #drawn: readonly string[] = [];
  #handOrder: InstanceId[] = [];

  #history: { game: GameState; handOrder: InstanceId[]; activity: string; beats: BattleBeat[] }[] = [];

  get canUndo(): boolean {
    return this.#history.length > 0;
  }

  undo(): boolean {
    const previous = this.#history.pop();
    if (!previous) return false;
    this.#handOrder = previous.handOrder;
    this.#villainActivity = previous.activity;
    this.#beats = previous.beats;
    this.#setGame(previous.game, []);
    return true;
  }

  reset(): void {
    this.#history = [];
    this.#villainActivity = "";
    this.#beats = [];
    const opening = openingTurn();
    this.#setGame(opening, opening.players[0]!.hand);
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
    const name = (id: InstanceId) => shortIdentityNameOf(result.state, id) ?? faceUpName(result.state, id);
    this.#beats = [];
    const toughAttacks = new Set<string>();
    for (const e of events) {
      const before = this.#beats.length;
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
        if (villainPhase !== enemy)
          this.#beats.push({
            enemy: villainPhase,
            text: villainPhase ? "Villain Phase" : "Hero Phase",
            phase: villainPhase ? "villain" : "hero",
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
      } else if (e.type === "villainFlipped") {
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          villainFlip: true,
          text: `${name(e.instanceId)} · Side ${e.to.toUpperCase()}`,
        });
      } else if (e.type === "characterDefeated" || e.type === "schemeDefeated") {
        const type = cardOf(result.state, e.instanceId)?.type ?? cardOf(this.#game, e.instanceId)?.type;
        if (type === "villain" && e.type === "characterDefeated") {
          const defeat = `${name(e.instanceId)} defeated`;
          this.#beats.push({ enemy, actor: e.instanceId, text: defeat, defeat });
        } else if (e.type === "schemeDefeated" || type === "minion") {
          this.#beats.push({ enemy, defeatedCard: e.instanceId, text: "" });
        }
      } else if (e.type === "encounterCardDealt" || e.type === "boostCardDealt") {
        this.#beats.push({
          enemy,
          text:
            e.type === "boostCardDealt" ? `Deal a boost card to ${name(e.enemyInstanceId)}` : "Deal an encounter card",
          encounterDeal: e.instanceId,
        });
      } else if (e.type === "encounterCardRevealed" || e.type === "boostCardFlipped") {
        const card = cardOf(result.state, e.instanceId) ?? cardOf(this.#game, e.instanceId);
        if (card?.type === "villain" && e.type === "encounterCardRevealed") continue;
        const title = card?.name ?? name(e.instanceId);
        this.#beats.push({
          enemy,
          text: e.type === "boostCardFlipped" ? `Boost card · ${title}` : `Reveal ${title}`,
          reveal: {
            id: e.instanceId,
            name: title,
            boost: e.type === "boostCardFlipped" ? { icons: e.boostIcons, enemy: e.enemyInstanceId } : null,
            art: artFor(card, { kind: "front" })?.url ?? "",
            landscape: isLandscapeType(card?.type ?? ""),
          },
        });
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
      } else if (e.type === "damagePrevented" && e.preventerInstanceId && e.amount > 0) {
        this.#beats.push({
          enemy,
          actor: e.preventerInstanceId,
          text: `${name(e.preventerInstanceId)} prevents ${e.amount} damage`,
          deflection: { card: e.preventerInstanceId, amount: e.amount },
        });
      } else if ((e.type === "damageDealt" || (e.type === "damagePrevented" && e.reason === "tough")) && e.amount > 0) {
        const tough = e.type === "damagePrevented";
        const sourceId = tough ? (e.attackSourceInstanceId ?? null) : e.sourceInstanceId;
        const source = sourceId && cardOf(result.state, sourceId);
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
        this.#beats.push({
          enemy,
          actor: e.instanceId,
          statusChange: { id: e.instanceId, name: e.status, delta: e.type === "statusGiven" ? 1 : -1 },
          text: `${name(e.instanceId)} ${e.type === "statusGiven" ? "gains" : "loses"} ${e.status}`,
        });
      } else if (e.type === "cardExhausted" || e.type === "cardReadied") {
        const exhausted = e.type === "cardExhausted";
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
            ? `${e.sourceInstanceId ? name(e.sourceInstanceId) + " places" : "Place"} ${e.amount} threat on ${name(e.schemeInstanceId)}`
            : `Remove ${e.amount} threat from ${name(e.schemeInstanceId)}`,
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
                : `Target: ${name(result.state.mainScheme.instanceId)}`;
            if (e.activation === "attack") {
              const target = result.state.players.find((p) => p.playerId === e.playerId)?.identity.instanceId;
              if (target) {
                this.#beats.push({
                  enemy,
                  actor,
                  text: `Target: ${name(target)}`,
                  attackAim: { source: actor, target },
                });
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
      if (e.type === "enemyActivated" && this.#beats.length > before)
        this.#beats.at(-1)!.enemyActivation = e.enemyInstanceId;
      if (enemy && this.#beats.length > before) this.#beats[this.#beats.length - 1]!.activity = this.#villainActivity;
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
      ].filter((id) => ["hero_identity", "ally", "villain", "minion"].includes(cardOf(s, id)?.type ?? ""));
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
    this.#setGame(result.state, drawn);
  }

  #card(id: InstanceId): BattleCard {
    const state = this.#game;
    const viewer = state.players[0]!.playerId;
    const card = cardOf(state, id);
    const action = this.#plays.get(id);
    const blocked =
      this.#actions.kind === "turn" &&
      this.#actions.illegal.find((entry) => entry.action.kind === "playCard" && entry.action.instanceId === id);
    const instance = getInstance(state, id);
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
      ...(card?.type === "minion" ? { hp: remainingHitPoints(state, id, CORE_DEPS) ?? 0 } : {}),
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
        card?.type === "resource" ? "Spend this card to pay for another card." : (blocked && blocked.message) || null,
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
    const canAdd =
      !priced?.command ||
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
            subject: this.#card(this.#subject),
            ability: this.#payment?.action.kind === "useAbility",
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
    const choice = this.#targetPick
      ? {
          prompt:
            this.#targetPick.action.kind === "basicAttack"
              ? "Choose an enemy to attack"
              : this.#targetPick.action.kind === "basicThwart"
                ? "Choose a scheme to thwart"
                : "Choose a card to attach to",
          options: this.#targetPick.targets.map((id) => ({ id, label: faceUpName(state, id), cardId: id })),
          canSkip: false,
          canCancel: true,
          min: 1,
          max: 1,
          discardFromHand: false,
        }
      : pending
        ? {
            prompt: trigger?.headline ?? promptTitleOf(pending.prompt, CORE_DEPS, pending, state),
            ...(pending.prompt.kind === "declareDefender"
              ? {
                  prompt: pending.options.some((o) => o.ref.kind === "card")
                    ? "Choose a defender"
                    : "No defender available",
                  defense: {
                    attacker: faceUpName(state, pending.prompt.attack.enemyInstanceId),
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
            ...(trigger && pending.prompt.kind === "chooseTriggers"
              ? {
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
                        question: `${verb} with ${name}?`,
                        effect: triggerEffectOf(state, option, player.playerId, CORE_DEPS),
                      },
                    ];
                  }),
                }
              : {}),
            options: pending.options.map((option) => ({
              id: option.optionId,
              label:
                option.ref.kind === "ability"
                  ? (abilityShortLabelOf(state, option.ref.instanceId, option.ref.abilityId, CORE_DEPS) ??
                    "Use ability")
                  : option.ref.kind === "card" && pending.prompt.kind === "declareDefender"
                    ? "Defend"
                    : pending.prompt.kind === "declareDefender" && option.optionId === "decline"
                      ? "Don’t defend"
                      : optionLabelOf(state, option),
              cardId: option.ref.kind === "card" || option.ref.kind === "ability" ? option.ref.instanceId : null,
            })),
            canSkip: pending.minSelections === 0,
            canCancel: false,
            min: pending.minSelections,
            max: pending.maxSelections,
            discardFromHand: pending.prompt.kind === "discardDownToHandSize",
          }
        : null;
    const attached = getInstance(state, player.identity.instanceId)?.attachments ?? [];
    const hostile = player.playArea.filter((id) =>
      ["minion", "attachment", "side_scheme", "environment", "obligation", "treachery"].includes(
        cardOf(state, id)?.type ?? "",
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
      enemyCards: [...enemyIds].map((id) => this.#card(id)),
      hero: this.#card(player.identity.instanceId),
      villain: this.#card(villain.instanceId),
      heroActions: this.#heroEntries().map(({ action }) => ({
        kind: action.kind,
        label:
          action.kind === "changeForm"
            ? player.identity.form === "hero"
              ? "Change to Peter Parker"
              : "Change to Spider-Man"
            : action.kind === "basicAttack"
              ? "Attack"
              : action.kind === "basicThwart"
                ? "Thwart"
                : "Recover",
      })),
      heroHp: remainingHitPoints(state, player.identity.instanceId, CORE_DEPS) ?? 0,
      villainHp: remainingHitPoints(state, villain.instanceId, CORE_DEPS) ?? 0,
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
    return this.#openPayment(entry, entry.targets[0] ?? null);
  }

  isTargetedAttachment(id: string): boolean {
    return (this.#plays.get(id)?.targets.length ?? 0) > 0;
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
      const label =
        action.abilityId === "01092.helicarrier-action"
          ? "Exhaust · Next card costs 1 less"
          : (abilityShortLabelOf(this.#game, action.instanceId, action.abilityId, CORE_DEPS) ?? "Use ability");
      return [{ kind: String(action.abilityId), label, exhausts: !!ability.cost?.exhaustSelf, entry }];
    });
  }

  #allyPowers(id: string) {
    if (this.#subject || this.#targetPick || this.#actions.kind !== "turn") return [];
    return this.#actions.legal.filter(
      ({ action }) =>
        (action.kind === "basicAttack" || action.kind === "basicThwart") &&
        action.instanceId === id &&
        cardOf(this.#game, action.instanceId)?.type === "ally",
    );
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
    return entry ? this.#usePower(entry) : false;
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
