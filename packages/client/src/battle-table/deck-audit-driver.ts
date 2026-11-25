/**
 * The driver the hero deck audits share (`deck-audit-captain-marvel.test.ts`, and the heroes after her): set-up steps
 * that rewrite the opening engine state, and a player that drives `BattleModel` the way `main.ts` does and keeps every
 * beat. Taken from Spider-Man's audit (`deck-audit-player.test.ts`, which keeps its own copy), with the hero and
 * villain as options of the deal. Test code only: nothing outside tests imports it.
 */
import { expect, vi } from "vitest";
import { watchThisFile } from "./shown-check.js";
import * as engine from "@mc/engine";
import {
  BattleModel,
  type BattleBeat,
  type BattleCard,
  type BattleSnapshot,
  type HeroId,
  type VillainId,
} from "./model.js";

// Every audit that drives the table through this driver is watched for anything happening unseen (`shown-check.ts`).
watchThisFile({ gate: true });

export type Setup = (state: engine.GameState) => engine.GameState;
export type Id = engine.InstanceId;
export const codeOf = (s: engine.GameState, id: string) => s.instances[id as Id]?.cardId;

/** Replace the hand with exactly these printed codes (taken from deck/hand/discard); the rest of the hand goes to the deck. */
export const handOf =
  (...codes: string[]): Setup =>
  (state) => {
    const p = state.players[0]!;
    const pool = [...p.hand, ...p.deck, ...p.discard];
    const hand: Id[] = [];
    for (const code of codes) {
      const id = pool.find((i) => codeOf(state, i) === code && !hand.includes(i));
      if (!id) throw Error(`no ${code} available for the hand`);
      hand.push(id);
    }
    return {
      ...state,
      players: [
        {
          ...p,
          hand,
          deck: [...p.deck.filter((i) => !hand.includes(i)), ...p.hand.filter((i) => !hand.includes(i))],
          discard: p.discard.filter((i) => !hand.includes(i)),
        },
      ],
    };
  };

/** Put these codes on top of the player's deck, in order. */
export const deckTop =
  (...codes: string[]): Setup =>
  (state) => {
    const p = state.players[0]!;
    const top: Id[] = [];
    for (const code of codes) {
      const id = p.deck.find((i) => codeOf(state, i) === code && !top.includes(i));
      if (!id) throw Error(`no ${code} in deck`);
      top.push(id);
    }
    return { ...state, players: [{ ...p, deck: [...top, ...p.deck.filter((i) => !top.includes(i))] }] };
  };

/** Put these codes in the player's discard pile, the last one on top (Pepper Potts reads the top card). */
export const discardTop =
  (...codes: string[]): Setup =>
  (state) => {
    const p = state.players[0]!;
    const moved: Id[] = [];
    for (const code of codes) {
      const id = [...p.deck, ...p.hand].find((i) => codeOf(state, i) === code && !moved.includes(i));
      if (!id) throw Error(`no ${code} for the discard pile`);
      moved.push(id);
    }
    const strip = (list: readonly Id[]) => list.filter((i) => !moved.includes(i));
    return {
      ...state,
      players: [{ ...p, deck: strip(p.deck), hand: strip(p.hand), discard: [...strip(p.discard), ...moved] }],
    };
  };

/** Stack the encounter deck (first = next to be drawn: the boost card before the dealt card). */
export const encounterTop =
  (...codes: string[]): Setup =>
  (state) => {
    const piles = engine.activeEncounterDeck(state);
    const top: Id[] = [];
    for (const code of codes) {
      const id = piles.deck.find((i) => codeOf(state, i) === code && !top.includes(i));
      if (!id) throw Error(`no ${code} in encounter deck`);
      top.push(id);
    }
    const deck = [...top, ...piles.deck.filter((i) => !top.includes(i))];
    return {
      ...state,
      encounterDecks: { ...state.encounterDecks, [engine.activeEncounterDeckId(state)]: { ...piles, deck } },
    };
  };

/** Engage a minion with the player (taken from the encounter deck). */
export const engageMinion =
  (code: string): Setup =>
  (state) => {
    const piles = engine.activeEncounterDeck(state);
    const id = piles.deck.find((i) => codeOf(state, i) === code)!;
    const p = state.players[0]!;
    return {
      ...state,
      players: [{ ...p, playArea: [...p.playArea, id] }],
      instances: { ...state.instances, [id]: { ...state.instances[id]!, faceup: true, engagedWith: p.playerId } },
      encounterDecks: {
        ...state.encounterDecks,
        [engine.activeEncounterDeckId(state)]: { ...piles, deck: piles.deck.filter((i) => i !== id) },
      },
    };
  };

/** Put a player card straight into play (context only: the card under test is always played through the UI). */
export const inPlay =
  (code: string): Setup =>
  (state) => {
    const p = state.players[0]!;
    const id = [...p.hand, ...p.deck].find((i) => codeOf(state, i) === code)!;
    if (!id) throw Error(`no ${code} to put in play`);
    return {
      ...state,
      players: [
        {
          ...p,
          hand: p.hand.filter((i) => i !== id),
          deck: p.deck.filter((i) => i !== id),
          playArea: [...p.playArea, id],
        },
      ],
      instances: { ...state.instances, [id]: { ...state.instances[id]!, faceup: true } },
    };
  };

export const patchByCode =
  (which: "hero" | "villain" | "scheme", patch: Partial<engine.GameState["instances"][string]>): Setup =>
  (state) => {
    const id =
      which === "hero"
        ? state.players[0]!.identity.instanceId
        : which === "villain"
          ? state.villains[0]!.instanceId
          : state.mainScheme.instanceId;
    return { ...state, instances: { ...state.instances, [id]: { ...state.instances[id]!, ...patch } } };
  };

export const patchCard =
  (code: string, patch: Partial<engine.GameState["instances"][string]>): Setup =>
  (state) => {
    const id = (Object.keys(state.instances) as Id[]).find(
      (i) =>
        codeOf(state, i) === code && state.instances[i]!.faceup !== false && state.players[0]!.playArea.includes(i),
    );
    if (!id) throw Error(`no ${code} in play to patch`);
    return { ...state, instances: { ...state.instances, [id]: { ...state.instances[id]!, ...patch } } };
  };

export const compose =
  (...steps: Setup[]): Setup =>
  (state) =>
    steps.reduce((s, step) => step(s), state);

/** Deal `hero` against `villain` (Rhino unless given), with the set-up steps applied to the opening state. */
export function scenarioOf(deal: { hero: HeroId; villain?: VillainId }, ...steps: Setup[]) {
  const setup = compose(...steps);
  const create = engine.createGame;
  const mock = vi.spyOn(engine, "createGame").mockImplementationOnce((...args) => {
    const result = create(...args);
    return result.ok ? { ...result, state: setup(result.state) } : result;
  });
  const battle = new BattleModel();
  try {
    battle.reset(deal);
  } finally {
    mock.mockRestore();
  }
  return new Player(battle);
}

export type Choice = NonNullable<BattleSnapshot["choice"]>;

/** Drives the BattleModel exactly like main.ts does and keeps every beat from every committed move. */
export class Player {
  beats: BattleBeat[] = [];
  #last: readonly BattleBeat[] = [];
  constructor(readonly battle: BattleModel) {
    this.#last = battle.snapshot().beats;
  }
  get snap() {
    return this.battle.snapshot();
  }
  /** Beats since the last mark(). */
  mark() {
    this.beats = [];
  }
  #collect() {
    const beats = this.battle.snapshot().beats;
    if (beats !== this.#last) {
      this.#last = beats;
      this.beats.push(...beats);
    }
  }
  run<T>(work: () => T): T {
    const result = work();
    this.#collect();
    return result;
  }
  card(name: string, where: "hand" | "inPlay" | "discard" | "enemyCards" = "hand"): BattleCard {
    const found = this.snap[where].find((c) => c.name === name);
    if (!found) throw Error(`${name} is not in ${where}: ${this.snap[where].map((c) => c.name).join(", ")}`);
    return found;
  }
  has(name: string, where: "hand" | "inPlay" | "discard" | "enemyCards") {
    return this.snap[where].some((c) => c.name === name);
  }
  form() {
    return this.run(() => this.battle.heroAction("changeForm"));
  }
  /** Spend the named hand cards, or spend until the payment can be made. Returns the payment seen before pay(). */
  spend(...labels: string[]) {
    const seen = this.snap.payment!;
    if (labels.length) {
      for (const label of labels) {
        const source = this.snap.payment!.sources.find((s) => s.label === label && !s.selected);
        if (!source) throw Error(`no unselected source ${label}: ${this.snap.payment!.sources.map((s) => s.label)}`);
        this.battle.toggle(source.id);
      }
    } else {
      for (const source of this.snap.payment!.sources) {
        if (this.snap.payment!.canPay) break;
        if (source.available && !source.selected) this.battle.toggle(source.id);
      }
    }
    return seen;
  }
  /** pick -> (target choice) -> payment -> pay, as the hand does it. */
  play(name: string, opts: { pay?: string[]; target?: string } = {}) {
    const card = this.card(name);
    expect(this.battle.pick(card.id), `pick ${name}`).toBe(true);
    if (opts.target) {
      const options = this.snap.choice!.options;
      const target = options.find((o) => o.cardId === opts.target);
      if (!target) throw Error(`target ${opts.target} not offered: ${JSON.stringify(options)}`);
      expect(this.battle.choose(target.id)).toBe(true);
    }
    if (this.snap.payment) {
      this.spend(...(opts.pay ?? []));
      expect(this.snap.payment!.canPay, `can pay ${name}: ${JSON.stringify(this.snap.payment)}`).toBe(true);
      expect(this.run(() => this.battle.pay())).toBe(true);
    } else this.#collect();
    return card;
  }
  ability(name: string, where: "inPlay" | "hand" = "inPlay") {
    const card = this.card(name, where);
    const actions = this.battle.fieldActions(card.id);
    expect(actions.length, `${name} actions`).toBeGreaterThan(0);
    return { card, kind: actions[0]!.kind, label: actions[0]!.label, actions };
  }
  /** Use a field ability. Pays with the named cards when the ability has a payment. */
  use(name: string, pay: string[] = []) {
    const { card, kind } = this.ability(name);
    expect(this.run(() => this.battle.fieldAction(card.id, kind))).toBe(true);
    if (this.snap.payment) {
      this.spend(...pay);
      expect(this.run(() => this.battle.pay())).toBe(true);
    }
    return card;
  }
  /** Answer a single-pick choice (targets, options) by its card or its label. */
  choose(match: { card?: string; label?: string | RegExp }) {
    const choice = this.snap.choice!;
    const option = choice.options.find(
      (o) =>
        (match.card === undefined || o.cardId === match.card) &&
        (match.label === undefined ||
          (typeof match.label === "string" ? o.label === match.label : match.label.test(o.label))),
    );
    if (!option) throw Error(`no option ${JSON.stringify(match)} in ${JSON.stringify(choice.options)}`);
    expect(this.run(() => this.battle.choose(option.id))).toBe(true);
  }
  end() {
    expect(this.run(() => this.battle.endTurn())).toBe(true);
  }
  /**
   * Play out the villain phase until the player has a normal turn again (or the game ends / the policy stops).
   * `offers` decides each trigger offer (by card name) like the Yes/No dialog; defaults decline everything.
   */
  drive(
    policy: {
      accept?: (offer: NonNullable<Choice["offers"]>[number]) => boolean;
      defend?: (choice: Choice) => string | "decline";
      pick?: (choice: Choice) => string[] | undefined;
      /** Card names never discarded when the hand-size prompt comes. */
      keep?: string[];
      stopWhen?: (snap: BattleSnapshot) => boolean;
    } = {},
  ) {
    for (let i = 0; i < 60; i++) {
      const s = this.snap;
      if (policy.stopWhen?.(s)) return s;
      const choice = s.choice;
      if (s.payment && !choice) return s;
      if (!choice) return s;
      if (choice.offers?.length) {
        const accepted = choice.offers.filter((o) => policy.accept?.(o) ?? false).map((o) => o.id);
        expect(this.run(() => this.battle.chooseMany(accepted.slice(0, choice.max)))).toBe(true);
        continue;
      }
      const custom = policy.pick?.(choice);
      if (custom) {
        expect(this.run(() => this.battle.chooseMany(custom))).toBe(true);
        continue;
      }
      if (choice.defense) {
        const answer = policy.defend?.(choice) ?? "decline";
        expect(this.run(() => this.battle.chooseMany([answer]))).toBe(true);
        continue;
      }
      const rank = (o: Choice["options"][number]) => (policy.keep?.includes(o.label) ? 1 : 0);
      const picks = [...choice.options]
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, choice.min)
        .map((o) => o.id);
      expect(
        this.run(() => this.battle.chooseMany(picks)),
        JSON.stringify(choice),
      ).toBe(true);
    }
    throw Error("villain phase did not settle: " + JSON.stringify(this.snap.choice));
  }
}

export const beat = (p: Player, f: (b: BattleBeat) => boolean) => p.beats.findIndex(f);

// Encounter cards: stacking the encounter deck, the hero's nemesis set, a villain phase played out.

/** Stack the encounter deck from anywhere (deck, discard, the hero's set-aside nemesis set), first = next to be drawn. */
export const stack =
  (...codes: string[]): Setup =>
  (state) => {
    const key = engine.activeEncounterDeckId(state);
    const piles = engine.activeEncounterDeck(state);
    const p = state.players[0]!;
    const used: Id[] = [];
    for (const code of codes) {
      const id = [...piles.deck, ...piles.discard, ...p.setAside, ...state.encounterSetAside].find(
        (i) => codeOf(state, i) === code && !used.includes(i),
      );
      if (!id) throw Error(`no ${code} to stack`);
      used.push(id);
    }
    const strip = (list: readonly Id[]) => list.filter((i) => !used.includes(i));
    return {
      ...state,
      players: [{ ...p, setAside: strip(p.setAside) }],
      encounterSetAside: strip(state.encounterSetAside),
      encounterDecks: {
        ...state.encounterDecks,
        [key]: { ...piles, deck: [...used, ...strip(piles.deck)], discard: strip(piles.discard) },
      },
    };
  };

/** Put a card of the hero's set-aside nemesis set into play: a side scheme by the villain (with threat), a minion engaged. */
export const nemesisInPlay =
  (code: string, threat = 0): Setup =>
  (state) => {
    const p = state.players[0]!;
    const id = p.setAside.find((i) => codeOf(state, i) === code);
    if (!id) throw Error(`no ${code} set aside`);
    const scheme = engine.cardOf(state, id)?.type === "side_scheme";
    return {
      ...state,
      players: [
        { ...p, setAside: p.setAside.filter((i) => i !== id), playArea: scheme ? p.playArea : [...p.playArea, id] },
      ],
      villainArea: scheme ? [...state.villainArea, id] : state.villainArea,
      instances: {
        ...state.instances,
        [id]: { ...state.instances[id]!, faceup: true, ...(scheme ? { threat } : { engagedWith: p.playerId }) },
      },
    };
  };

/** Rhino's boost card first (Advance: no boost icons), then the card under test, then inert fillers. */
export const villainPhaseDeals = (...codes: string[]) => stack("01104", ...codes, "01108", "01101");

/**
 * End the turn and play out the villain phase, keeping the questions it asks with their options' words. `answer` picks
 * an option by its words; a question it doesn't pick for (-1) gets the driver's default, and attacks go undefended.
 */
export function villainPhase(p: Player, answer: (labels: string[]) => number = () => -1) {
  const asked: { prompt: string; source?: string | undefined; labels: string[] }[] = [];
  p.mark();
  p.end();
  p.drive({
    defend: () => "decline",
    pick: (choice) => {
      const labels = choice.options.map((o) => o.label);
      asked.push({ prompt: choice.prompt, source: choice.sourceTitle, labels });
      if (choice.defense || choice.discardFromHand || choice.mulligan) return undefined;
      if (choice.ordered) return choice.options.map((o) => o.id);
      const at = answer(labels);
      return at >= 0 ? [choice.options[at]!.id] : undefined;
    },
  });
  return asked;
}
