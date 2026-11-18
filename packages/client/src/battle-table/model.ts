import { CORE_DEPS, coreScenario } from "@mc/cards";
import {
  RESOURCE_TYPES,
  applyCommand,
  cardOf,
  createGame,
  getInstance,
  legalActions,
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
import { faceOf } from "../view/board-model.js";
import { promptTitleOf } from "../view/choice-source.js";
import { faceUpName, optionLabelOf, shortIdentityNameOf } from "../view/names.js";
import { beginPayment, paymentView, togglePayment, type PaymentState } from "../view/payment-model.js";

export interface BattleCard {
  id: string;
  name: string;
  art: string;
  type: string;
  playable: boolean;
  cost: number | null;
  reason: string | null;
}

export interface BattlePayment {
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
    kind: "handCard" | "resourceAbility";
  }[];
}

export interface BattleChoice {
  prompt: string;
  options: { id: string; label: string; cardId: string | null }[];
  canSkip: boolean;
  canCancel: boolean;
}

export interface BattleSnapshot {
  hand: BattleCard[];
  hero: BattleCard;
  villain: BattleCard;
  heroHp: number;
  villainHp: number;
  inPlay: BattleCard[];
  /** Bottom to top, so each paid card is placed on its predecessor. */
  discard: BattleCard[];
  payment: BattlePayment | null;
  choice: BattleChoice | null;
}

function apply(state: GameState, command: Command): GameState {
  const result = applyCommand(state, command, CORE_DEPS);
  if (!result.ok) throw Error(result.error.message);
  return result.state;
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
  const actions = legalActions(turn, mulligan.playerId, CORE_DEPS);
  const flip = actions.kind === "turn" && actions.legal.find((entry) => entry.action.kind === "changeForm");
  if (!flip) throw Error("Spider-Man could not change to hero form.");
  return apply(turn, flip.example);
}

export class BattleModel {
  #game!: GameState;
  #actions!: LegalActions;
  #plays = new Map<string, LegalAction>();
  #payment: PaymentState | null = null;
  #subject: InstanceId | null = null;
  #targetPick: LegalAction | null = null;
  #view: BattleSnapshot | null = null;

  reset(): void {
    this.#setGame(openingTurn());
  }

  #setGame(state: GameState): void {
    this.#game = state;
    this.#actions = legalActions(state, state.players[0]!.playerId, CORE_DEPS);
    this.#plays.clear();
    if (this.#actions.kind === "turn") {
      for (const entry of this.#actions.legal) {
        if (entry.action.kind === "playCard") this.#plays.set(entry.action.instanceId, entry);
      }
    }
    this.cancel();
  }

  #card(id: InstanceId): BattleCard {
    const state = this.#game;
    const viewer = state.players[0]!.playerId;
    const card = cardOf(state, id);
    const action = this.#plays.get(id);
    const blocked =
      this.#actions.kind === "turn" &&
      this.#actions.illegal.find((entry) => entry.action.kind === "playCard" && entry.action.instanceId === id);
    return {
      id,
      name: shortIdentityNameOf(state, id) ?? faceUpName(state, id),
      art: artFor(card, faceOf(state, id, { viewer, deps: CORE_DEPS }))?.url ?? "",
      type: card?.type ?? "card",
      playable: !!action,
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

  snapshot(): BattleSnapshot {
    if (this.#view) return this.#view;
    const state = this.#game;
    const player = state.players[0]!;
    const villain = state.villains[0]!;
    const priced = this.#priced();
    const payment =
      priced && this.#subject
        ? {
            subject: this.#card(this.#subject),
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
              kind: source.kind,
            })),
          }
        : null;
    const pending = state.pendingChoice;
    const choice = this.#targetPick
      ? {
          prompt: "Choose a card to attach to",
          options: this.#targetPick.targets.map((id) => ({ id, label: faceUpName(state, id), cardId: id })),
          canSkip: false,
          canCancel: true,
        }
      : pending
        ? {
            prompt: promptTitleOf(pending.prompt, CORE_DEPS, pending, state),
            options: pending.options.map((option) => ({
              id: option.optionId,
              label: optionLabelOf(state, option),
              cardId: option.ref.kind === "card" ? option.ref.instanceId : null,
            })),
            canSkip: pending.minSelections === 0,
            canCancel: false,
          }
        : null;
    const attached = getInstance(state, player.identity.instanceId)?.attachments ?? [];
    this.#view = {
      hero: this.#card(player.identity.instanceId),
      villain: this.#card(villain.instanceId),
      heroHp: remainingHitPoints(state, player.identity.instanceId, CORE_DEPS) ?? 0,
      villainHp: remainingHitPoints(state, villain.instanceId, CORE_DEPS) ?? 0,
      hand: player.hand.map((id) => this.#card(id)),
      discard: player.discard.map((id) => this.#card(id)).reverse(),
      inPlay: [...new Set([...player.playArea, ...attached])].map((id) => this.#card(id)),
      payment,
      choice,
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

  #openPayment(entry: LegalAction, target: InstanceId | null): boolean {
    if (entry.action.kind !== "playCard") return false;
    const opened = beginPayment(this.#game, this.#game.players[0]!.playerId, entry.action, target, CORE_DEPS);
    if (!opened) return false;
    this.#subject = entry.action.instanceId;
    this.#payment = opened;
    this.#view = null;
    return true;
  }

  toggle(id: string): void {
    if (!this.#payment || !this.#payment.query.sources.some((source) => source.optionId === id)) return;
    this.#payment = togglePayment(this.#payment, id);
    this.#view = null;
  }

  cancel(): void {
    this.#payment = null;
    this.#targetPick = null;
    this.#subject = null;
    this.#view = null;
  }

  pay(): boolean {
    const command = this.#priced()?.command;
    if (!command) return false;
    this.#setGame(apply(this.#game, command));
    return true;
  }

  choose(id: string | null): boolean {
    if (this.#targetPick) {
      const entry = this.#targetPick;
      const target = entry.targets.find((candidate) => candidate === id);
      if (!target || !this.#openPayment(entry, target)) return false;
      this.#targetPick = null;
      return true;
    }
    const choice = this.#game.pendingChoice;
    if (
      !choice ||
      (id === null ? choice.minSelections > 0 : !choice.options.some((option) => option.optionId === id))
    ) {
      return false;
    }
    const result = applyCommand(
      this.#game,
      {
        type: "resolveChoice",
        choiceId: choice.choiceId,
        playerId: choice.playerId,
        selectedOptionIds: id === null ? [] : [id],
      },
      CORE_DEPS,
    );
    if (!result.ok) return false;
    this.#setGame(result.state);
    return true;
  }
}
