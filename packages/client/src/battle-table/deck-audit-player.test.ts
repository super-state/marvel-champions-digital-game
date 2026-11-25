import { expect, test, vi } from "vitest";
import * as engine from "@mc/engine";
import { BattleModel, type BattleBeat, type BattleCard, type BattleSnapshot } from "./model.js";

// ---------------------------------------------------------------------------------------------------------------
// Setup helpers (engine state rewriting, as effect-presentation.test.ts does) and a player-driver around BattleModel.
// ---------------------------------------------------------------------------------------------------------------
type Setup = (state: engine.GameState) => engine.GameState;
type Id = engine.InstanceId;
const codeOf = (s: engine.GameState, id: string) => s.instances[id as Id]?.cardId;

/** Replace the hand with exactly these printed codes (taken from deck/hand/discard); the rest of the hand goes to the deck. */
const handOf =
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
const deckTop =
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

/** Stack the encounter deck (first = next to be drawn: the boost card before the dealt card). */
const encounterTop =
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
const engageMinion =
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
const inPlay =
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

const patchByCode =
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

const patchCard =
  (code: string, patch: Partial<engine.GameState["instances"][string]>): Setup =>
  (state) => {
    const id = (Object.keys(state.instances) as Id[]).find(
      (i) =>
        codeOf(state, i) === code && state.instances[i]!.faceup !== false && state.players[0]!.playArea.includes(i),
    );
    if (!id) throw Error(`no ${code} in play to patch`);
    return { ...state, instances: { ...state.instances, [id]: { ...state.instances[id]!, ...patch } } };
  };

const compose =
  (...steps: Setup[]): Setup =>
  (state) =>
    steps.reduce((s, step) => step(s), state);

function scenario(...steps: Setup[]) {
  const setup = compose(...steps);
  const create = engine.createGame;
  const mock = vi.spyOn(engine, "createGame").mockImplementationOnce((...args) => {
    const result = create(...args);
    return result.ok ? { ...result, state: setup(result.state) } : result;
  });
  const battle = new BattleModel();
  try {
    battle.reset();
  } finally {
    mock.mockRestore();
  }
  return new Player(battle);
}

type Choice = NonNullable<BattleSnapshot["choice"]>;

/** Drives the BattleModel exactly like main.ts does and keeps every beat from every committed move. */
class Player {
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

const beat = (p: Player, f: (b: BattleBeat) => boolean) => p.beats.findIndex(f);

// ---------------------------------------------------------------------------------------------------------------

// 01001 Spider-Man identity ---------------------------------------------------------------------------------------

test("01001 identity: Change to Spider-Man / Peter Parker swaps form, once per turn (RRG 'Form, Change Form' p.21)", () => {
  const p = scenario();
  expect(p.snap.hero.name).toBe("Peter Parker");
  expect(p.snap.heroActions.map((a) => a.label)).toContain("Change to Spider-Man");
  expect(p.form()).toBe(true);
  expect(p.snap.hero.name).toBe("Spider-Man");
  expect(p.snap.hero.exhausted).toBe(false);
  // hero form offers attack (thwart only once there is threat to remove); recover is an alter-ego power
  expect(p.snap.heroActions.map((a) => a.kind)).toContain("basicAttack");
  expect(p.snap.heroActions.map((a) => a.kind)).not.toContain("basicRecover");
  // once per turn: the change action is gone now, and a second try is refused
  expect(p.snap.heroActions.map((a) => a.kind)).not.toContain("changeForm");
  expect(p.battle.heroAction("changeForm")).toBe(false);
  // Hero form has no Recover? (it does: basic recover is available in both forms)
  p.end();
  p.drive();
  expect(p.snap.turn).toBe("player");
  // the new turn offers the change again, back to Peter Parker
  expect(p.snap.heroActions.map((a) => a.label)).toContain("Change to Peter Parker");
  expect(p.form()).toBe(true);
  expect(p.snap.hero.name).toBe("Peter Parker");
});

test("01001 identity: basic attack hits Rhino for the hero's ATK, exhausts the hero and shows the hit", () => {
  const p = scenario();
  p.form();
  const atk = p.battle.basicPower(p.snap.hero.id, "atk");
  expect(atk).toBeGreaterThan(0);
  const before = p.snap.villainHp;
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  expect(p.snap.villainHp).toBe(before - atk);
  expect(p.snap.hero.exhausted).toBe(true);
  expect(p.snap.heroActions).toEqual([]);
  const hit = beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === atk);
  expect(hit).toBeGreaterThanOrEqual(0);
  expect(p.beats[hit]!.hit!.source).toBe(p.snap.hero.id);
});

test("01001 identity: basic attack with two legal targets lists both, hits the chosen minion and defeats it", () => {
  const p = scenario(engageMinion("01110"));
  p.form();
  const minion = p.card("Hydra Bomber", "enemyCards");
  p.mark();
  expect(p.battle.heroAction("basicAttack")).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.prompt).toMatch(/attack/i);
  expect(choice.options.map((o) => o.cardId).sort()).toEqual([minion.id, p.snap.villain.id].sort());
  expect(choice.canCancel).toBe(true);
  const villainHp = p.snap.villainHp;
  p.choose({ card: minion.id });
  expect(p.snap.villainHp).toBe(villainHp);
  expect(p.has("Hydra Bomber", "enemyCards")).toBe(false);
  expect(beat(p, (b) => b.defeatedCard === minion.id)).toBeGreaterThanOrEqual(0);
  expect(p.snap.hero.exhausted).toBe(true);
});

test("01001 identity: basic thwart removes the hero's THW from the main scheme and shows the threat change", () => {
  const p = scenario(patchByCode("scheme", { threat: 5 }));
  p.form();
  const thw = p.battle.basicPower(p.snap.hero.id, "thw");
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicThwart"))).toBe(true);
  expect(p.card("The Break-In!", "enemyCards").threat).toBe(5 - thw);
  expect(p.snap.hero.exhausted).toBe(true);
  const b = beat(p, (x) => x.threat?.delta === -thw);
  expect(b).toBeGreaterThanOrEqual(0);
});

test("01001 identity: basic thwart with a main and a side scheme in play asks which scheme", () => {
  // Peter Parker: the villain schemes and Bomb Scare comes down; then it is the hero's turn again.
  const p = scenario(encounterTop("01186", "01109"), patchByCode("scheme", { threat: 2 }));
  p.end();
  p.drive();
  const side = p.card("Bomb Scare", "enemyCards");
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  expect(side.threat).toBeGreaterThan(0);
  expect(p.battle.heroAction("basicThwart")).toBe(false); // alter-ego has no thwart (hero form only)
  p.form();
  expect(p.battle.heroAction("basicThwart")).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.prompt).toMatch(/thwart/i);
  expect(choice.options.map((o) => o.cardId).sort()).toEqual([main.id, side.id].sort());
  const sideBefore = side.threat!;
  const mainBefore = main.threat!;
  p.mark();
  p.choose({ card: side.id });
  expect(p.card("Bomb Scare", "enemyCards").threat).toBeLessThan(sideBefore);
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBe(mainBefore);
});

test("01001 identity: basic recover (alter-ego power) heals REC damage, exhausts, and is not offered in hero form", () => {
  const p = scenario(patchByCode("hero", { damage: 5 }));
  const rec = p.battle.basicPower(p.snap.hero.id, "rec");
  const before = p.snap.heroHp;
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicRecover"))).toBe(true);
  expect(p.snap.heroHp).toBe(before + rec);
  expect(p.snap.hero.exhausted).toBe(true);
  expect(beat(p, (b) => b.statusChange?.name === "damage" && b.statusChange.delta === -rec)).toBeGreaterThanOrEqual(0);
  const q = scenario(patchByCode("hero", { damage: 5 }));
  q.form();
  expect(q.battle.heroAction("basicRecover")).toBe(false);
});

// Spider-Sense / defending / hand size ------------------------------------------------------------------------------

test.each([true, false])(
  "01001a Spider-Sense interrupt (accept=%s): draws 1 when the villain attacks you",
  (accept) => {
    const p = scenario(encounterTop("01186", "01108"));
    p.form();
    p.end();
    const at = p.drive({ stopWhen: (s) => !!s.choice?.offers?.length });
    const offer = at.choice!.offers![0]!;
    expect(offer.cardId).toBe(at.hero.id);
    expect(offer.question).toMatch(/interrupt/i);
    expect(offer.effect).toMatch(/draw/i);
    expect(at.choice!.prompt).toMatch(/attack/i);
    const hand = at.hand.length;
    const deck = at.deckCount;
    p.mark();
    expect(p.run(() => p.battle.chooseMany(accept ? [offer.id] : []))).toBe(true);
    if (accept) {
      expect(p.snap.hand.length).toBe(hand + 1);
      expect(p.snap.deckCount).toBe(deck - 1);
      expect(beat(p, (b) => !!b.draw?.length)).toBeGreaterThanOrEqual(0);
      expect(beat(p, (b) => b.interrupt === at.hero.id)).toBeGreaterThanOrEqual(0);
      expect(p.snap.drawn).toHaveLength(1);
    } else {
      expect(p.snap.hand.length).toBe(hand);
      expect(p.snap.deckCount).toBe(deck);
      expect(beat(p, (b) => !!b.draw?.length)).toBe(-1);
    }
  },
);

const atDefense = (p: Player) => p.drive({ stopWhen: (s) => !!s.choice?.defense });

test("01001 defending: the hero can defend Rhino's attack (exhausts, takes the damage) or decline (stays ready)", () => {
  for (const defend of [true, false]) {
    const p = scenario(encounterTop("01186", "01108"));
    p.form();
    p.end();
    const s = atDefense(p);
    expect(s.choice!.defense!.attacker).toBe("Rhino");
    expect(s.choice!.prompt).toBe("Choose a defender");
    const hero = s.choice!.options.find((o) => o.cardId === s.hero.id)!;
    expect(hero.label).toBe("Defend");
    const none = s.choice!.options.find((o) => o.cardId === null)!;
    expect(none.label).toBe("Don’t defend");
    p.mark();
    p.choose(defend ? { card: s.hero.id } : { label: "Don’t defend" });
    // RRG "Defend" / DEF: a defending hero's DEF (Spider-Man 3) reduces the damage, so Rhino's 2 are absorbed; undefended takes 2.
    // (docs/rulings post RRG 1.7: "Your hero still has a DEF value even if it wasn't used to reduce damage dealt.")
    const hits = p.beats.filter((b) => b.hit?.target === s.hero.id);
    expect(hits.map((b) => b.hit!.amount)).toEqual([defend ? 0 : 2]);
    expect(p.snap.heroHp).toBe(defend ? 10 : 8);
    expect(p.snap.hero.markers.find((m) => m.name === "damage")?.count ?? 0).toBe(defend ? 0 : 2);
    if (defend) {
      expect(p.beats.some((b) => /defends/.test(b.text))).toBe(true);
      expect(p.beats.some((b) => b.turned?.id === s.hero.id && b.turned.exhausted)).toBe(true);
    } else expect(p.beats.some((b) => /undefended/.test(b.text))).toBe(true);
  }
});

test("01058/01059 defending: an ally defends instead of the hero and takes the damage", () => {
  const p = scenario(inPlay("01059"), encounterTop("01186", "01108"));
  p.form();
  p.end();
  const s = atDefense(p);
  const jessica = p.card("Jessica Jones", "inPlay");
  expect(s.choice!.options.map((o) => o.cardId).filter(Boolean)).toEqual(
    expect.arrayContaining([jessica.id, s.hero.id]),
  );
  p.mark();
  p.choose({ card: jessica.id });
  expect(p.card("Jessica Jones", "inPlay")).toMatchObject({ exhausted: true });
  expect(p.card("Jessica Jones", "inPlay").markers).toContainEqual({ name: "damage", count: 2 });
  expect(p.snap.heroHp).toBe(10);
  expect(beat(p, (b) => b.hit?.target === jessica.id && b.hit.amount === 2)).toBeGreaterThanOrEqual(0);
});

test("01002 Black Cat defending Rhino: 2 damage defeats her (2 HP) and she leaves play to the discard", () => {
  const p = scenario(inPlay("01002"), encounterTop("01186", "01108"));
  p.form();
  p.end();
  atDefense(p);
  const cat = p.card("Black Cat", "inPlay");
  p.mark();
  p.choose({ card: cat.id });
  expect(p.has("Black Cat", "inPlay")).toBe(false);
  expect(p.has("Black Cat", "discard")).toBe(true);
  expect(p.snap.heroHp).toBe(10);
  // the player is shown the 2 damage landing on her before she vanishes
  expect(beat(p, (b) => b.hit?.target === cat.id && b.hit.amount === 2)).toBeGreaterThanOrEqual(0);
  // the ally's defeat is announced (the beat exists since model.ts started emitting defeatedCard for allies)
  expect(beat(p, (b) => b.defeatedCard === cat.id)).toBeGreaterThan(beat(p, (b) => b.hit?.target === cat.id));
});

test("hand size: ending the turn over the hand limit asks to discard down, and the cards go to the discard pile", () => {
  const p = scenario(handOf("01090", "01088", "01089", "01005", "01087", "01086", "01085", "01003"));
  expect(p.snap.hand).toHaveLength(8);
  p.end();
  const s = p.drive({ stopWhen: (x) => !!x.choice?.discardFromHand });
  const choice = s.choice!;
  expect(choice.discardFromHand).toBe(true);
  const over = s.hand.length - 6;
  expect(choice.min).toBe(over);
  const picks = choice.options.slice(0, over).map((o) => o.id);
  expect(p.run(() => p.battle.chooseMany(picks))).toBe(true);
  expect(p.snap.hand.length).toBe(6);
  expect(p.snap.discard.length).toBe(over);
});

// 01004 Enhanced Spider-Sense: the only cost-1 interrupt, so it goes through the trigger-window payment sheet ----------

function toEnhanced(): Player {
  const p = scenario(handOf("01004", "01090", "01088", "01089", "01087", "01086"), encounterTop("01186", "01105"));
  p.form();
  p.end();
  const at = p.drive({
    keep: ["Enhanced Spider-Sense"],
    stopWhen: (x) => !!x.choice?.offers?.some((o) => /Enhanced/.test(o.question)),
  });
  expect(at.choice!.prompt).toBe("“I'm Tough!” is about to be revealed".replace("“", '"').replace("”", '"'));
  return p;
}

test("01004 Enhanced Spider-Sense: accepting, paying with a hand card cancels the treachery's When Revealed", () => {
  const p = toEnhanced();
  const offer = p.snap.choice!.offers!.find((o) => /Enhanced/.test(o.question))!;
  expect(offer.question).toBe("Interrupt with Enhanced Spider-Sense?");
  expect(offer.effect).toMatch(/cancel/i);
  p.mark();
  expect(p.run(() => p.battle.chooseMany([offer.id]))).toBe(true);
  const pay = p.snap.payment!;
  expect(pay).toBeTruthy();
  expect(pay.subject.name).toBe("Enhanced Spider-Sense");
  expect(pay.required).toBe(1);
  expect(pay.canPay).toBe(false);
  expect(p.snap.choice).toBeNull();
  const energy = pay.sources.find((s) => s.label === "Energy")!;
  const hand = p.snap.hand.length;
  p.battle.toggle(energy.id);
  expect(p.snap.payment).toMatchObject({ canPay: true, paid: 2 });
  expect(p.snap.payment!.discards).toEqual([energy.cardId]);
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.snap.payment).toBeNull();
  // "I'm Tough!" was cancelled: Rhino has no tough status; the treachery and the event are discarded
  expect(p.snap.villain.markers.some((m) => m.name === "tough")).toBe(false);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain('"I\'m Tough!"');
  expect(p.has("Enhanced Spider-Sense", "discard")).toBe(true);
  expect(p.has("Energy", "discard")).toBe(true);
  expect(p.snap.hand.length).toBe(hand - 2);
  expect(beat(p, (b) => b.activate?.card === offer.cardId)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.interrupt === offer.cardId)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.statusChange?.name === "tough")).toBe(-1);
});

test("01004 Enhanced Spider-Sense: declining lets the treachery resolve (Rhino gains tough)", () => {
  const p = toEnhanced();
  p.mark();
  expect(p.run(() => p.battle.chooseMany([]))).toBe(true);
  expect(p.snap.villain.markers.some((m) => m.name === "tough")).toBe(true);
  expect(p.has("Enhanced Spider-Sense", "hand")).toBe(true);
  expect(beat(p, (b) => b.statusChange?.name === "tough" && b.statusChange.delta === 1)).toBeGreaterThanOrEqual(0);
});

test("01004 Enhanced Spider-Sense: backing out of the payment sheet with Cancel does not play it and the treachery resolves", () => {
  const p = toEnhanced();
  const offer = p.snap.choice!.offers![0]!;
  p.battle.chooseMany([offer.id]);
  expect(p.snap.payment).toBeTruthy();
  p.battle.toggle(p.snap.payment!.sources[0]!.id);
  p.run(() => p.battle.cancel());
  expect(p.snap.payment).toBeNull();
  expect(p.has("Enhanced Spider-Sense", "hand")).toBe(true);
  expect(p.snap.villain.markers).toContainEqual({ name: "tough", count: 1 });
});

// Hero events: attacks and thwarts ------------------------------------------------------------------------------------

test("01005 Swinging Web Kick: pay 3, 8 damage to Rhino, event shown, discarded, hero stays ready", () => {
  const p = scenario(handOf("01005", "01090", "01088", "01089", "01087", "01086"));
  p.form();
  const before = p.snap.villainHp;
  const kick = p.card("Swinging Web Kick");
  expect(kick.cost).toBe(3);
  p.mark();
  p.play("Swinging Web Kick", { pay: ["Strength", "Haymaker"] });
  expect(p.snap.villainHp).toBe(before - 8);
  expect(p.has("Swinging Web Kick", "discard")).toBe(true);
  expect(p.has("Swinging Web Kick", "hand")).toBe(false);
  expect(p.snap.hero.exhausted).toBe(false); // a labeled attack event does not exhaust the hero (RRG "Labeled Ability")
  const act = beat(p, (b) => b.activate?.card === kick.id);
  const hit = beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === 8);
  expect(act).toBeGreaterThanOrEqual(0);
  expect(hit).toBeGreaterThan(act);
  expect(p.beats[hit]!.hit!.source).toBe(p.snap.hero.id);
  expect(beat(p, (b) => b.discardEvent === kick.id)).toBeGreaterThan(hit);
  expect(p.snap.discard.map((c) => c.name)).toEqual(expect.arrayContaining(["Strength", "Haymaker"]));
});

test("01005 Swinging Web Kick with Rhino and a minion engaged lists both and 8 damage defeats the chosen minion", () => {
  const p = scenario(handOf("01005", "01090", "01088", "01089", "01087", "01086"), engageMinion("01110"));
  p.form();
  const minion = p.card("Hydra Bomber", "enemyCards");
  const before = p.snap.villainHp;
  expect(p.battle.pick(p.card("Swinging Web Kick").id)).toBe(true);
  // the target is chosen when the card resolves (after payment) for events: pay first
  p.spend("Strength", "Haymaker");
  expect(p.run(() => p.battle.pay())).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.options.map((o) => o.cardId).sort()).toEqual([minion.id, p.snap.villain.id].sort());
  expect(choice.prompt).toMatch(/attack|enemy|target/i);
  p.mark();
  p.choose({ card: minion.id });
  expect(p.snap.villainHp).toBe(before);
  expect(p.has("Hydra Bomber", "enemyCards")).toBe(false);
  expect(beat(p, (b) => b.defeatedCard === minion.id)).toBeGreaterThanOrEqual(0);
  expect(
    beat(p, (b) => b.hit?.target === minion.id && b.hit.amount > 0 && b.hit.source === p.snap.hero.id),
  ).toBeGreaterThanOrEqual(0);
});

test("01087 Haymaker: pay 2, 3 damage to Rhino", () => {
  const p = scenario(handOf("01087", "01090", "01088", "01089", "01086", "01085"));
  p.form();
  const before = p.snap.villainHp;
  const card = p.card("Haymaker");
  expect(card.cost).toBe(2);
  p.mark();
  p.play("Haymaker", { pay: ["Strength"] });
  expect(p.snap.villainHp).toBe(before - 3);
  expect(p.has("Haymaker", "discard")).toBe(true);
  expect(beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === 3)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.activate?.card === card.id)).toBeGreaterThanOrEqual(0);
});

test("01087 Haymaker is refused in alter-ego form with a clear reason", () => {
  const p = scenario(handOf("01087", "01090", "01088", "01089", "01086", "01085"));
  const card = p.card("Haymaker");
  expect(card.playable).toBe(false);
  expect(card.requiresHeroForm).toBe(true);
  expect(card.reason).toMatch(/hero form/i);
  expect(p.battle.pick(card.id)).toBe(false);
});

test.each([
  ["Energy (energy)", "Energy", 3],
  ["Genius (mental)", "Genius", 4],
])(
  "01060 For Justice!: paid with %s removes %i threat (4 only when paid with a mental resource)",
  (_n, payWith, removed) => {
    const p = scenario(
      handOf("01060", "01090", "01088", "01089", "01086", "01085"),
      patchByCode("scheme", { threat: 6 }),
    );
    p.form();
    p.mark();
    p.play("For Justice!", { pay: [payWith] });
    expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(6 - removed);
    expect(beat(p, (b) => b.threat?.delta === -removed)).toBeGreaterThanOrEqual(0);
    expect(p.has("For Justice!", "discard")).toBe(true);
    expect(p.snap.hero.exhausted).toBe(false);
  },
);

test("01060 For Justice! with a main and a side scheme asks which scheme to remove threat from", () => {
  const p = scenario(
    handOf("01060", "01090", "01088", "01089", "01086", "01085"),
    encounterTop("01186", "01109"),
    patchByCode("scheme", { threat: 1 }),
  );
  p.end();
  p.drive({ keep: ["For Justice!"] });
  p.form();
  const side = p.card("Bomb Scare", "enemyCards");
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  p.battle.pick(p.card("For Justice!").id);
  p.spend("Energy");
  p.run(() => p.battle.pay());
  const ch = p.snap.choice!;
  expect(ch.options.map((o) => o.cardId).sort()).toEqual([main.id, side.id].sort());
  const sideBefore = side.threat!;
  p.mark();
  p.choose({ card: side.id });
  // Bomb Scare had 3 threat: all removed, so the side scheme is defeated (and the player sees it leave)
  expect(sideBefore).toBe(3);
  expect(p.has("Bomb Scare", "enemyCards")).toBe(false);
  expect(beat(p, (b) => b.defeatedCard === side.id)).toBeGreaterThanOrEqual(0);
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBe(main.threat);
});

test("01062 The Power of Justice doubles its resources while paying for a Justice card only", () => {
  const p = scenario(
    handOf("01062", "01060", "01087", "01090", "01088", "01089"),
    patchByCode("scheme", { threat: 3 }),
  );
  p.form();
  p.battle.pick(p.card("Haymaker").id); // basic card: no doubling
  const basic = p.snap.payment!.sources.find((s) => s.label === "The Power of Justice")!;
  p.battle.cancel();
  p.battle.pick(p.card("For Justice!").id); // Justice card: doubled
  const justice = p.snap.payment!.sources.find((s) => s.label === "The Power of Justice")!;
  expect(justice.icons.length).toBe(basic.icons.length * 2);
  // so a single Power of Justice pays the whole cost 2 of For Justice!
  p.battle.toggle(justice.id);
  expect(p.snap.payment).toMatchObject({ canPay: true });
});

// Interrupts in the villain phase ---------------------------------------------------------------------------------------

const GR = /Great Responsibility/;
function toGreatResponsibility() {
  const p = scenario(handOf("01061", "01090", "01088", "01089", "01087", "01086"), encounterTop("01186", "01108"));
  p.form();
  p.end();
  const at = p.drive({
    keep: ["Great Responsibility"],
    stopWhen: (x) => !!x.choice?.offers?.some((o) => GR.test(o.question)),
  });
  return { p, at };
}

test("01061 Great Responsibility: accepting makes the hero take the threat as damage instead", () => {
  const { p, at } = toGreatResponsibility();
  const offer = at.choice!.offers!.find((o) => GR.test(o.question))!;
  expect(offer.question).toBe("Interrupt with Great Responsibility?");
  expect(offer.effect).toMatch(/damage/i);
  const main = at.enemyCards.find((c) => c.type === "main_scheme")!;
  // The window says what is about to happen before it asks: the main scheme is about to get its threat.
  expect(at.choice!.event).toMatchObject({ kind: "placeThreat", subject: main.id, amount: 1, before: true });
  expect(at.choice!.prompt).toMatch(/is about to get 1 threat$/);
  p.mark();
  p.run(() => p.battle.chooseMany([offer.id]));
  if (p.snap.payment) {
    // cost 0: nothing to spend
    expect(p.snap.payment.required).toBe(0);
    p.spend();
    expect(p.run(() => p.battle.pay())).toBe(true);
  }
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBe(main.threat);
  expect(beat(p, (b) => b.hit?.target === at.hero.id && b.hit.amount === 1)).toBeGreaterThanOrEqual(0);
  expect(p.has("Great Responsibility", "discard")).toBe(true);
});

test("01061 Great Responsibility: declining lets the threat land on the scheme", () => {
  const { p, at } = toGreatResponsibility();
  const main = at.enemyCards.find((c) => c.type === "main_scheme")!;
  p.mark();
  p.run(() => p.battle.chooseMany([]));
  p.drive({ keep: ["Great Responsibility"] });
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBeGreaterThan(main.threat!);
  expect(p.has("Great Responsibility", "hand")).toBe(true);
});

const BF = /Backflip/;
function toBackflip(...steps: Setup[]) {
  const p = scenario(
    handOf("01003", "01090", "01088", "01089", "01087", "01086"),
    encounterTop("01186", "01108"),
    ...steps,
  );
  p.form();
  p.end();
  return p;
}

test.each([true, false])(
  "01003 Backflip (accept=%s): undefended Rhino attack, prevents all of the damage",
  (accept) => {
    const p = toBackflip();
    p.drive({ keep: ["Backflip"], stopWhen: (s) => !!s.choice?.defense });
    p.choose({ label: "Don’t defend" });
    const at = p.snap;
    const offer = at.choice?.offers?.find((o) => BF.test(o.question));
    expect(offer, JSON.stringify(at.choice)).toBeTruthy();
    expect(offer!.question).toBe("Interrupt with Backflip?");
    expect(offer!.effect).toMatch(/prevent/i);
    p.mark();
    p.run(() => p.battle.chooseMany(accept ? [offer!.id] : []));
    if (p.snap.payment) {
      p.spend();
      p.run(() => p.battle.pay());
    }
    if (accept) {
      expect(p.snap.heroHp).toBe(10);
      expect(p.has("Backflip", "discard")).toBe(true);
      expect(beat(p, (b) => b.deflection?.card === offer!.cardId && b.deflection.amount === 2)).toBeGreaterThanOrEqual(
        0,
      );
      expect(beat(p, (b) => b.hit?.target === at.hero.id && b.hit.amount > 0)).toBe(-1);
    } else {
      expect(p.snap.heroHp).toBe(8);
      expect(p.has("Backflip", "hand")).toBe(true);
    }
  },
);

test("01003 Backflip is not offered when a hero's DEF already absorbed the whole attack (no damage to prevent)", () => {
  const p = toBackflip();
  p.drive({ keep: ["Backflip"], stopWhen: (s) => !!s.choice?.defense });
  p.choose({ card: p.snap.hero.id });
  const rest = p.drive({ keep: ["Backflip"], accept: (o) => BF.test(o.question) });
  expect(p.beats.some((b) => b.interrupt === p.card("Backflip").id)).toBe(false);
  expect(rest.heroHp).toBe(10);
});

test("01003 Backflip is not offered when an ally defends (the damage is not yours)", () => {
  const p = toBackflip(inPlay("01059"));
  p.drive({ keep: ["Backflip"], stopWhen: (s) => !!s.choice?.defense });
  p.choose({ card: p.card("Jessica Jones", "inPlay").id });
  p.drive({ keep: ["Backflip"], accept: (o) => BF.test(o.question) });
  expect(p.beats.some((b) => b.deflection)).toBe(false);
  expect(p.has("Backflip", "hand")).toBe(true);
  expect(p.card("Jessica Jones", "inPlay").markers).toContainEqual({ name: "damage", count: 2 });
});

// 01009 Webbed Up -----------------------------------------------------------------------------------------------------

const WU_HAND = ["01009", "01090", "01088", "01089", "01087", "01086"];

test("01009 Webbed Up: hero form only (clear reason in alter-ego), one legal host means no target prompt", () => {
  const p = scenario(handOf(...WU_HAND));
  const wu = p.card("Webbed Up");
  expect(wu).toMatchObject({ playable: false, requiresHeroForm: true });
  expect(wu.reason).toMatch(/hero form/i);
  p.form();
  expect(p.card("Webbed Up")).toMatchObject({ playable: true, cost: 4 });
  expect(p.battle.pick(wu.id)).toBe(true);
  expect(p.snap.choice).toBeNull(); // Rhino is the only enemy: the host is automatic
  expect(p.snap.payment!.required).toBe(4);
  p.spend("Strength", "Energy");
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.card("Webbed Up", "enemyCards").attachedTo).toBe(p.snap.villain.id);
});

test("01009 Webbed Up: with Rhino and a minion the host is chosen; the attacker it is attached to loses the attack and is stunned", () => {
  const p = scenario(handOf(...WU_HAND), engageMinion("01110"), encounterTop("01186", "01108"));
  p.form();
  const rhino = p.snap.villain.id;
  const bomber = p.card("Hydra Bomber", "enemyCards");
  expect(p.battle.pick(p.card("Webbed Up").id)).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.prompt).toBe("Choose a card to attach to");
  expect(choice.options.map((o) => o.cardId).sort()).toEqual([bomber.id, rhino].sort());
  p.choose({ card: rhino });
  p.spend("Strength", "Energy");
  p.run(() => p.battle.pay());
  expect(p.card("Webbed Up", "enemyCards").attachedTo).toBe(rhino);
  const webId = p.card("Webbed Up", "enemyCards").id;
  p.mark();
  p.end();
  p.drive({ keep: ["Strength"] });
  // the forced interrupt replaced Rhino's attack: Webbed Up is discarded, Rhino is stunned, the hero is not hit by Rhino
  expect(p.has("Webbed Up", "enemyCards")).toBe(false);
  expect(p.snap.discard.map((c) => c.id)).toContain(webId);
  expect(p.snap.villain.markers).toContainEqual({ name: "stunned", count: 1 });
  expect(beat(p, (b) => b.interrupt === webId)).toBeGreaterThanOrEqual(0);
  expect(
    beat(p, (b) => b.statusChange?.id === rhino && b.statusChange.name === "stunned" && b.statusChange.delta === 1),
  ).toBeGreaterThan(beat(p, (b) => b.interrupt === webId));
  expect(p.beats.some((b) => b.hit?.source === rhino)).toBe(false);
  // only the engaged Hydra Bomber (ATK 1) hurt him
  expect(p.snap.heroHp).toBe(9);
});

test("01009 Webbed Up: Max 1 per enemy — a second copy can only be attached to the other enemy", () => {
  const p = scenario(
    handOf("01009", "01009", "01090", "01088", "01089", "01087", "01086", "01085"),
    engageMinion("01110"),
  );
  p.form();
  const rhino = p.snap.villain.id;
  p.play("Webbed Up", { target: rhino, pay: ["Strength", "Energy"] });
  expect(p.card("Webbed Up", "enemyCards").attachedTo).toBe(rhino);
  const second = p.card("Webbed Up");
  expect(p.battle.pick(second.id)).toBe(true);
  expect(p.snap.choice).toBeNull(); // Rhino is no longer a legal host: the minion is automatic
  p.spend("Genius", "Haymaker", "First Aid");
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(
    p.snap.enemyCards
      .filter((c) => c.name === "Webbed Up")
      .map((c) => c.attachedTo)
      .sort(),
  ).toEqual([rhino, p.card("Hydra Bomber", "enemyCards").id].sort());
});

test("01009 Webbed Up: a second copy is not playable when Rhino already has one and no other enemy is there", () => {
  const p = scenario(handOf("01009", "01009", "01090", "01088", "01089", "01087", "01086", "01085"));
  p.form();
  p.play("Webbed Up", { pay: ["Strength", "Energy"] });
  const second = p.card("Webbed Up");
  expect(second.playable).toBe(false);
  expect(second.reason).toBeTruthy();
  expect(p.battle.pick(second.id)).toBe(false);
});

// Resource abilities as payment sources: Scientist (01001b) and Web-Shooter (01008) ---------------------------------------

const resourceSources = (p: Player) => (p.snap.payment?.sources ?? []).filter((s) => s.kind === "resourceAbility");

test("01001b Scientist: Peter Parker can pay with a mental resource ability once per round, and not in hero form", () => {
  const p = scenario(handOf("01006", "01063", "01064", "01090", "01088", "01089"));
  // 1. alter-ego: Scientist is offered as a source and pays a cost-1 card without discarding anything
  const hand = p.snap.hand.length;
  p.battle.pick(p.card("Aunt May").id);
  const [sci] = resourceSources(p);
  expect(sci).toMatchObject({ icons: ["mental"], available: true, selected: false });
  expect(sci!.cardId).toBe(p.snap.hero.id);
  p.battle.toggle(sci!.id);
  expect(p.snap.payment).toMatchObject({ canPay: true, discards: [] });
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.has("Aunt May", "inPlay")).toBe(true);
  expect(p.snap.hand.length).toBe(hand - 1); // only May left the hand
  // 2. once per round: it is gone for the next card this round
  p.battle.pick(p.card("Interrogation Room").id);
  expect(resourceSources(p)).toEqual([]);
  p.battle.cancel();
  // 3. a new round gives it back
  p.end();
  p.drive({ keep: ["Interrogation Room"] });
  p.battle.pick(p.card("Interrogation Room").id);
  expect(resourceSources(p)).toHaveLength(1);
  p.battle.cancel();
  // 4. hero form: Scientist belongs to the alter-ego
  p.form();
  p.battle.pick(p.card("Interrogation Room").id);
  expect(resourceSources(p)).toEqual([]);
});

test("01008 Web-Shooter: enters with 3 web counters; its resource ability exhausts it, removes a counter and pays any cost-1 card", () => {
  const p = scenario(handOf("01008", "01063", "01006", "01090", "01088", "01089"));
  p.form();
  const shooter = p.play("Web-Shooter", { pay: ["Strength"] });
  expect(p.card("Web-Shooter", "inPlay")).toMatchObject({ exhausted: false, markers: [{ name: "web", count: 3 }] });
  // as a payment source
  p.battle.pick(p.card("Interrogation Room").id);
  const [web] = resourceSources(p);
  expect(web).toMatchObject({ cardId: shooter.id, icons: ["wild"], available: true });
  p.battle.toggle(web!.id);
  expect(p.snap.payment).toMatchObject({ canPay: true, discards: [] });
  const hand = p.snap.hand.length;
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.has("Interrogation Room", "inPlay")).toBe(true);
  expect(p.snap.hand.length).toBe(hand - 1);
  expect(p.card("Web-Shooter", "inPlay")).toMatchObject({ exhausted: true, markers: [{ name: "web", count: 2 }] });
  expect(beat(p, (b) => b.turned?.id === shooter.id && b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  expect(
    beat(p, (b) => b.statusChange?.id === shooter.id && b.statusChange.name === "web" && b.statusChange.delta === -1),
  ).toBeGreaterThanOrEqual(0);
  // exhausted: it cannot pay for the next card
  p.battle.pick(p.card("Aunt May").id);
  expect(resourceSources(p).every((s) => !s.available)).toBe(true);
});

test("01008 Web-Shooter: the third use removes the last web counter and discards it (Uses keyword)", () => {
  const p = scenario(handOf("01008", "01063", "01006", "01064", "01090", "01088"));
  p.form();
  p.play("Web-Shooter", { pay: ["Strength"] });
  const web = () => p.snap.inPlay.find((c) => c.name === "Web-Shooter");
  for (const [round, card, extra] of [
    [1, "Interrogation Room", []],
    [2, "Aunt May", []],
    [3, "Surveillance Team", ["Energy"]],
  ] as const) {
    if (round > 1) {
      p.end();
      p.drive({
        keep: ["Aunt May", "Surveillance Team", "Interrogation Room"],
        defend: (c) => c.options.find((o) => o.cardId)?.id ?? "decline",
      });
      expect(web()).toMatchObject({ exhausted: false });
      if (p.snap.hero.name !== "Spider-Man") p.form();
    }
    p.battle.pick(p.card(card).id);
    const src = resourceSources(p)[0]!;
    p.battle.toggle(src.id);
    p.spend(...extra);
    p.mark();
    expect(
      p.run(() => p.battle.pay()),
      `${card} paid with Web-Shooter`,
    ).toBe(true);
    if (round < 3) expect(web()!.markers).toContainEqual({ name: "web", count: 3 - round });
  }
  expect(web()).toBeUndefined();
  expect(p.has("Web-Shooter", "discard")).toBe(true);
});

// Alter-ego supports and upgrades ------------------------------------------------------------------------------------------

test("01006 Aunt May: alter-ego action exhausts her and heals Peter Parker for 4; not usable in hero form", () => {
  const p = scenario(handOf("01006", "01090", "01088", "01089", "01087", "01086"), patchByCode("hero", { damage: 6 }));
  p.play("Aunt May", { pay: ["Strength"] });
  expect(p.snap.heroHp).toBe(4);
  const may = p.ability("Aunt May");
  expect(may.label).toMatch(/heal|exhaust|aunt may|use/i);
  p.mark();
  expect(p.run(() => p.battle.fieldAction(may.card.id, may.kind))).toBe(true);
  expect(p.snap.heroHp).toBe(8);
  expect(p.card("Aunt May", "inPlay").exhausted).toBe(true);
  expect(
    beat(
      p,
      (b) => b.statusChange?.id === p.snap.hero.id && b.statusChange.name === "damage" && b.statusChange.delta === -4,
    ),
  ).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.turned?.id === may.card.id && b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  expect(p.battle.fieldActions(may.card.id)).toEqual([]);
});

test("01006 Aunt May: the action is not offered in hero form", () => {
  const p = scenario(inPlay("01006"), patchByCode("hero", { damage: 6 }));
  expect(p.battle.fieldActions(p.card("Aunt May", "inPlay").id).length).toBe(1);
  p.form();
  expect(p.battle.fieldActions(p.card("Aunt May", "inPlay").id)).toEqual([]);
});

test("01065 Heroic Intuition: +1 THW to the hero (shown), Max 1 per player blocks the second copy", () => {
  const p = scenario(handOf("01065", "01065", "01090", "01088", "01089", "01087"));
  p.form();
  const thw = p.battle.basicPower(p.snap.hero.id, "thw");
  p.mark();
  p.play("Heroic Intuition", { pay: ["Strength"] });
  expect(p.battle.basicPower(p.snap.hero.id, "thw")).toBe(thw + 1);
  expect(p.snap.hero.markers).toContainEqual({ name: "THW", count: 1 });
  expect(
    beat(p, (b) => b.modifier?.id === p.snap.hero.id && b.modifier.name === "THW" && b.modifier.count === 1),
  ).toBeGreaterThanOrEqual(0);
  expect(p.snap.inPlay.map((c) => c.name)).toContain("Heroic Intuition");
  const second = p.card("Heroic Intuition");
  expect(second.playable).toBe(false);
  expect(second.reason).toBeTruthy();
  expect(p.battle.pick(second.id)).toBe(false);
});

test("01065 Heroic Intuition: the extra THW is what the basic thwart removes", () => {
  const p = scenario(inPlay("01065"), patchByCode("scheme", { threat: 5 }));
  p.form();
  p.mark();
  p.battle.heroAction("basicThwart");
  p.run(() => 0);
  expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(5 - 2);
});

// Hero-phase responses ------------------------------------------------------------------------------------------------

test.each([true, false])(
  "01063 Interrogation Room (accept=%s): after you defeat a minion, exhaust it to remove 1 threat",
  (accept) => {
    const p = scenario(inPlay("01063"), engageMinion("01110"), patchByCode("scheme", { threat: 3 }));
    p.form();
    const minion = p.card("Hydra Bomber", "enemyCards");
    p.battle.heroAction("basicAttack");
    p.mark();
    p.choose({ card: minion.id });
    const choice = p.snap.choice!;
    expect(choice.offers).toHaveLength(1);
    const offer = choice.offers![0]!;
    expect(offer.cardId).toBe(p.card("Interrogation Room", "inPlay").id);
    expect(offer.question).toBe("Respond with Interrogation Room?");
    expect(offer.effect).toMatch(/threat/i);
    expect(p.has("Hydra Bomber", "enemyCards")).toBe(false);
    p.mark();
    p.run(() => p.battle.chooseMany(accept ? [offer.id] : []));
    const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
    expect(p.snap.choice).toBeNull();
    if (accept) {
      expect(main.threat).toBe(2);
      expect(p.card("Interrogation Room", "inPlay").exhausted).toBe(true);
      expect(beat(p, (b) => b.threat?.delta === -1)).toBeGreaterThanOrEqual(0);
      expect(beat(p, (b) => b.turned?.id === offer.cardId && b.turned.exhausted)).toBeGreaterThanOrEqual(0);
    } else {
      expect(main.threat).toBe(3);
      expect(p.card("Interrogation Room", "inPlay").exhausted).toBe(false);
    }
  },
);

test("01063 Interrogation Room does not respond to Rhino being hit (only a minion's defeat)", () => {
  const p = scenario(inPlay("01063"), patchByCode("scheme", { threat: 3 }));
  p.form();
  p.battle.heroAction("basicAttack");
  expect(p.snap.choice).toBeNull();
});

test("01064 Surveillance Team: enters with 3 snoop counters; the action spends one and removes 1 threat (Uses discard: see Web-Shooter)", () => {
  const p = scenario(
    handOf("01064", "01090", "01088", "01089", "01087", "01086"),
    patchByCode("scheme", { threat: 3 }),
  );
  p.play("Surveillance Team", { pay: ["Strength"] });
  expect(p.card("Surveillance Team", "inPlay").markers).toContainEqual({ name: "snoop", count: 3 });
  p.use("Surveillance Team");
  expect(p.card("Surveillance Team", "inPlay").markers).toContainEqual({ name: "snoop", count: 2 });
  expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(2);
});

test("01091 Avengers Mansion: pay 4, then exhaust to draw a card (shown), once per ready", () => {
  const p = scenario(handOf("01091", "01090", "01088", "01089", "01087", "01086"));
  const mansion = p.play("Avengers Mansion", { pay: ["Strength", "Energy"] });
  expect(mansion.cost).toBe(4);
  expect(p.has("Avengers Mansion", "inPlay")).toBe(true);
  const hand = p.snap.hand.length;
  const deck = p.snap.deckCount;
  p.mark();
  const ab = p.ability("Avengers Mansion");
  expect(p.run(() => p.battle.fieldAction(ab.card.id, ab.kind))).toBe(true);
  expect(p.snap.hand.length).toBe(hand + 1);
  expect(p.snap.deckCount).toBe(deck - 1);
  expect(p.card("Avengers Mansion", "inPlay").exhausted).toBe(true);
  expect(beat(p, (b) => !!b.draw?.length)).toBeGreaterThanOrEqual(0);
  expect(p.battle.fieldActions(ab.card.id)).toEqual([]);
});

test("01092 Helicarrier: the discount applies to the next card only", () => {
  const p = scenario(handOf("01092", "01006", "01063", "01090", "01088", "01089"));
  p.play("Helicarrier", { pay: ["Strength", "Energy"] });
  const hc = p.ability("Helicarrier");
  expect(hc.label).toBe("Next card costs 1 less");
  p.run(() => p.battle.fieldAction(hc.card.id, hc.kind));
  expect(p.snap.hand.find((c) => c.name === "Aunt May")!.cost).toBe(0);
  expect(p.snap.hand.find((c) => c.name === "Interrogation Room")!.cost).toBe(0); // both show the discount until one is played
  p.play("Aunt May"); // free: no payment sheet
  expect(p.snap.payment).toBeNull();
  expect(p.has("Aunt May", "inPlay")).toBe(true);
  expect(p.snap.hand.find((c) => c.name === "Interrogation Room")!.cost).toBe(1);
  expect(p.card("Helicarrier", "inPlay").exhausted).toBe(true);
});

const EM = /Emergency/;
test.each([true, false])(
  "01085 Emergency (accept=%s): reduces the threat Rhino places when he schemes by 1",
  (accept) => {
    const p = scenario(handOf("01085", "01090", "01088", "01089", "01087", "01086"), encounterTop("01186", "01108"));
    p.end();
    const at = p.drive({ keep: ["Emergency"], stopWhen: (s) => !!s.choice?.offers?.some((o) => EM.test(o.question)) });
    const offer = at.choice!.offers!.find((o) => EM.test(o.question))!;
    expect(offer.question).toBe("Interrupt with Emergency?");
    expect(offer.effect).toMatch(/threat/i);
    const before = at.enemyCards.find((c) => c.type === "main_scheme")!.threat!;
    p.mark();
    p.run(() => p.battle.chooseMany(accept ? [offer.id] : []));
    if (p.snap.payment) {
      p.spend();
      p.run(() => p.battle.pay());
    }
    p.drive({ keep: ["Emergency"] });
    const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
    // Rhino's SCH 1 + 0 boost is cut to 0 by Emergency
    expect(main.threat).toBe(before + (accept ? 0 : 1));
    if (accept) {
      expect(p.has("Emergency", "discard")).toBe(true);
      expect(beat(p, (b) => b.activate?.card === offer.cardId)).toBeGreaterThanOrEqual(0);
    } else expect(p.has("Emergency", "hand")).toBe(true);
  },
);

test("01086 First Aid: heal 2 from any character: lists hero, ally and enemies, heals the chosen one", () => {
  const p = scenario(
    handOf("01086", "01090", "01088", "01089", "01087", "01085"),
    inPlay("01059"),
    patchCard("01059", { damage: 2 }),
    patchByCode("hero", { damage: 4 }),
    patchByCode("villain", { damage: 3 }),
  );
  p.battle.pick(p.card("First Aid").id);
  expect(p.snap.choice).toBeNull();
  p.spend("Strength");
  p.run(() => p.battle.pay());
  const choice = p.snap.choice!;
  const ids = choice.options.map((o) => o.cardId);
  expect(ids).toEqual(
    expect.arrayContaining([p.snap.hero.id, p.card("Jessica Jones", "inPlay").id, p.snap.villain.id]),
  );
  p.mark();
  p.choose({ card: p.card("Jessica Jones", "inPlay").id });
  expect(p.card("Jessica Jones", "inPlay").markers.find((m) => m.name === "damage")?.count ?? 0).toBe(0);
  expect(p.snap.heroHp).toBe(6);
  expect(p.snap.villainHp).toBe(14 - 3);
  expect(beat(p, (b) => b.statusChange?.name === "damage" && b.statusChange.delta === -2)).toBeGreaterThanOrEqual(0);
  expect(p.has("First Aid", "discard")).toBe(true);
});

test("01086 First Aid heals the hero for exactly 2", () => {
  const p = scenario(handOf("01086", "01090", "01088", "01089", "01087", "01085"), patchByCode("hero", { damage: 4 }));
  p.play("First Aid", { pay: ["Strength"] });
  if (p.snap.choice) p.choose({ card: p.snap.hero.id });
  expect(p.snap.heroHp).toBe(8);
});

// Allies -----------------------------------------------------------------------------------------------------------------

test("01002 Black Cat: after you play her, mill 2 and add the mental-resource cards to your hand", () => {
  const p = scenario(handOf("01002", "01090", "01088", "01087", "01086", "01085"), deckTop("01064", "01089"));
  const deck = p.snap.deckCount;
  p.mark();
  p.play("Black Cat", { pay: ["Strength"] });
  expect(p.has("Black Cat", "inPlay")).toBe(true);
  expect(p.snap.deckCount).toBe(deck - 2);
  // Surveillance Team (printed mental) and Genius (printed mental resource) both come to hand
  expect(p.has("Surveillance Team", "hand")).toBe(true);
  expect(p.has("Genius", "hand")).toBe(true);
  expect(p.has("Surveillance Team", "discard")).toBe(false);
});

test("01002 Black Cat: a non-mental card milled stays in the discard pile", () => {
  const p = scenario(handOf("01002", "01090", "01088", "01087", "01086", "01085"), deckTop("01063", "01062"));
  p.play("Black Cat", { pay: ["Strength"] });
  expect(p.snap.discard.map((c) => c.name)).toEqual(
    expect.arrayContaining(["Interrogation Room", "The Power of Justice"]),
  );
  expect(p.has("Interrogation Room", "hand")).toBe(false);
  expect(p.has("The Power of Justice", "hand")).toBe(false);
});

test("01002 Black Cat: the card added to hand is shown coming back (a 'Return to your hand' beat)", () => {
  const p = scenario(handOf("01002", "01090", "01088", "01087", "01086", "01085"), deckTop("01064", "01063"));
  p.mark();
  p.play("Black Cat", { pay: ["Strength"] });
  const team = p.card("Surveillance Team").id;
  expect(beat(p, (b) => !!b.returned?.includes(team))).toBeGreaterThanOrEqual(0);
});

test("01002 Black Cat: a milled non-mental card is shown going to the discard pile (beat)", () => {
  const p = scenario(handOf("01002", "01090", "01088", "01087", "01086", "01085"), deckTop("01064", "01063"));
  p.mark();
  p.play("Black Cat", { pay: ["Strength"] });
  expect(p.has("Interrogation Room", "discard")).toBe(true);
  const room = p.card("Interrogation Room", "discard");
  expect(p.beats.some((b) => b.milled?.includes(room.id))).toBe(true);
});

test("01002 Black Cat thwart / attack: THW 1 with 1 consequential damage; ATK 1 with none", () => {
  const p = scenario(inPlay("01002"), patchByCode("scheme", { threat: 3 }));
  const cat = p.card("Black Cat", "inPlay");
  const acts = p.battle.fieldActions(cat.id);
  expect(acts.map((a) => a.label).sort()).toEqual(["Attack", "Thwart"]);
  p.mark();
  expect(p.run(() => p.battle.fieldAction(cat.id, "basicThwart"))).toBe(true);
  expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(2);
  expect(p.card("Black Cat", "inPlay")).toMatchObject({ exhausted: true });
  expect(p.card("Black Cat", "inPlay").markers).toContainEqual({ name: "damage", count: 1 });
  expect(beat(p, (b) => b.threat?.delta === -1)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.hit?.target === cat.id && b.hit.amount === 1)).toBeGreaterThanOrEqual(0);
});

test("01002 Black Cat attack: 1 damage to Rhino, no consequential damage back", () => {
  const p = scenario(inPlay("01002"));
  const cat = p.card("Black Cat", "inPlay");
  const before = p.snap.villainHp;
  p.mark();
  expect(p.run(() => p.battle.fieldAction(cat.id, "basicAttack"))).toBe(true);
  expect(p.snap.villainHp).toBe(before - 1);
  expect(p.card("Black Cat", "inPlay").markers.find((m) => m.name === "damage")).toBeUndefined();
  expect(p.card("Black Cat", "inPlay").exhausted).toBe(true);
  expect(
    beat(p, (b) => b.hit?.source === cat.id && b.hit.target === p.snap.villain.id && b.hit.amount === 1),
  ).toBeGreaterThanOrEqual(0);
});

test("01059 Jessica Jones: +1 THW per side scheme in play (shown), thwart removes 2, 1 consequential damage", () => {
  const p = scenario(inPlay("01059"), encounterTop("01186", "01108"), patchByCode("scheme", { threat: 1 }));
  p.end();
  p.drive();
  const jessica = p.card("Jessica Jones", "inPlay");
  expect(jessica.markers).toContainEqual({ name: "THW", count: 1 });
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  // Crowd Control (crisis) blocks removing threat from the main scheme: thwart the side scheme instead
  p.mark();
  expect(p.run(() => p.battle.fieldAction(jessica.id, "basicThwart"))).toBe(true);
  expect(p.snap.choice).toBeNull(); // crisis leaves Crowd Control as the only legal scheme
  const crowd = p.snap.enemyCards.find((c) => c.name === "Crowd Control");
  expect(crowd).toBeUndefined(); // its 2 threat were all removed by THW 1 + 1
  expect(beat(p, (b) => b.threat?.delta === -2)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => !!b.defeatedCard)).toBeGreaterThanOrEqual(0);
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBe(main.threat);
  expect(p.card("Jessica Jones", "inPlay").markers.some((m) => m.name === "THW")).toBe(false);
  expect(p.card("Jessica Jones", "inPlay").exhausted).toBe(true);
  expect(p.card("Jessica Jones", "inPlay").markers).toContainEqual({ name: "damage", count: 1 });
});

test("01059 Jessica Jones: with no side scheme she has her printed THW 1", () => {
  const p = scenario(inPlay("01059"), patchByCode("scheme", { threat: 3 }));
  const jessica = p.card("Jessica Jones", "inPlay");
  expect(jessica.markers.some((m) => m.name === "THW")).toBe(false);
  p.battle.fieldAction(jessica.id, "basicThwart");
  expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(2);
});

test.each([true, false])(
  "01058 Daredevil (accept=%s): after he thwarts, deal 1 damage to an enemy of your choice",
  (accept) => {
    const p = scenario(inPlay("01058"), engageMinion("01110"), patchByCode("scheme", { threat: 3 }));
    const dd = p.card("Daredevil", "inPlay");
    const bomber = p.card("Hydra Bomber", "enemyCards");
    const rhinoHp = p.snap.villainHp;
    p.mark();
    expect(p.run(() => p.battle.fieldAction(dd.id, "basicThwart"))).toBe(true);
    expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(1);
    const choice = p.snap.choice!;
    expect(choice.offers).toHaveLength(1);
    expect(choice.offers![0]).toMatchObject({ cardId: dd.id, question: "Respond with Daredevil?" });
    expect(choice.offers![0]!.effect).toMatch(/damage/i);
    p.run(() => p.battle.chooseMany(accept ? [choice.offers![0]!.id] : []));
    if (!accept) {
      expect(p.snap.choice).toBeNull();
      expect(p.card("Daredevil", "inPlay").markers).toContainEqual({ name: "damage", count: 1 });
      expect(p.snap.villainHp).toBe(rhinoHp);
      expect(p.card("Hydra Bomber", "enemyCards").markers.find((m) => m.name === "damage")).toBeUndefined();
      return;
    }
    const target = p.snap.choice!;
    expect(target.options.map((o) => o.cardId).sort()).toEqual([bomber.id, p.snap.villain.id].sort());
    p.mark();
    p.choose({ card: bomber.id });
    expect(p.snap.villainHp).toBe(rhinoHp);
    expect(p.card("Hydra Bomber", "enemyCards").markers).toContainEqual({ name: "damage", count: 1 });
    expect(p.card("Daredevil", "inPlay").markers).toContainEqual({ name: "damage", count: 1 }); // consequential damage follows the response
    expect(beat(p, (b) => b.hit?.target === bomber.id && b.hit.amount === 1)).toBeGreaterThanOrEqual(0);
  },
);

test("01058 Daredevil: attacking is not a thwart, so no response; 2 ATK, 1 consequential damage", () => {
  const p = scenario(inPlay("01058"));
  const dd = p.card("Daredevil", "inPlay");
  const before = p.snap.villainHp;
  p.run(() => p.battle.fieldAction(dd.id, "basicAttack"));
  expect(p.snap.choice).toBeNull();
  expect(p.snap.villainHp).toBe(before - 2);
  expect(p.card("Daredevil", "inPlay").markers).toContainEqual({ name: "damage", count: 1 });
});

test.each([true, false])("01083 Mockingbird (accept=%s): after she enters play, stun an enemy", (accept) => {
  const p = scenario(handOf("01083", "01090", "01088", "01087", "01086", "01085"), engageMinion("01110"));
  const bomber = p.card("Hydra Bomber", "enemyCards");
  p.mark();
  p.play("Mockingbird", { pay: ["Strength", "Haymaker"] });
  const choice = p.snap.choice!;
  expect(choice.offers).toHaveLength(1);
  expect(choice.offers![0]).toMatchObject({ question: "Respond with Mockingbird?" });
  expect(choice.offers![0]!.effect).toMatch(/stun/i);
  p.run(() => p.battle.chooseMany(accept ? [choice.offers![0]!.id] : []));
  if (!accept) {
    expect(p.snap.choice).toBeNull();
    expect(p.snap.villain.markers.some((m) => m.name === "stunned")).toBe(false);
    return;
  }
  const target = p.snap.choice!;
  expect(target.options.map((o) => o.cardId).sort()).toEqual([bomber.id, p.snap.villain.id].sort());
  p.mark();
  p.choose({ card: bomber.id });
  expect(p.card("Hydra Bomber", "enemyCards").markers).toContainEqual({ name: "stunned", count: 1 });
  expect(p.snap.villain.markers.some((m) => m.name === "stunned")).toBe(false);
  expect(
    beat(p, (b) => b.statusChange?.id === bomber.id && b.statusChange.name === "stunned" && b.statusChange.delta === 1),
  ).toBeGreaterThanOrEqual(0);
});

// 01084 Nick Fury -----------------------------------------------------------------------------------------------------------

function playFury(...steps: Setup[]) {
  const p = scenario(
    handOf("01084", "01090", "01088", "01087", "01086", "01085"),
    patchByCode("scheme", { threat: 3 }),
    ...steps,
  );
  p.mark();
  p.play("Nick Fury", { pay: ["Strength", "Energy"] });
  return p;
}

test("01084 Nick Fury: forced response offers the three modes, each resolving (labels, results, beats)", () => {
  for (const [label, check] of [
    [
      /Remove 2 threat/i,
      (p: Player) => {
        expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(1);
        expect(beat(p, (b) => b.threat?.delta === -2)).toBeGreaterThanOrEqual(0);
      },
    ],
    [
      /Draw 3/i,
      (p: Player) => {
        expect(p.snap.hand.length).toBe(3 + 3);
        expect(p.snap.drawn).toHaveLength(3);
        expect(p.beats.find((b) => b.draw)?.draw).toHaveLength(3);
      },
    ],
    [
      /4 damage/i,
      (p: Player) => {
        expect(p.snap.villainHp).toBe(14 - 4);
        expect(beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === 4)).toBeGreaterThanOrEqual(0);
      },
    ],
  ] as const) {
    const p = playFury();
    const choice = p.snap.choice!;
    expect(choice.options).toHaveLength(3);
    expect(choice.min).toBe(1);
    expect(choice.canSkip).toBe(false);
    expect(choice.offers).toBeUndefined(); // forced: no yes/no, just the mode
    p.mark();
    p.choose({ label });
    check(p);
    expect(p.has("Nick Fury", "inPlay")).toBe(true);
  }
});

test("01084 Nick Fury: if he is still in play at the end of the round he is discarded", () => {
  const p = playFury();
  p.choose({ label: /Draw 3/i });
  p.mark();
  p.end();
  p.drive({ keep: ["Nick Fury"] });
  expect(p.has("Nick Fury", "inPlay")).toBe(false);
  expect(p.has("Nick Fury", "discard")).toBe(true);
});

test("01084 Nick Fury: the player is shown him being discarded at end of round (leftPlay beat)", () => {
  const p = playFury();
  p.choose({ label: /Draw 3/i });
  const fury = p.card("Nick Fury", "inPlay").id;
  p.mark();
  p.end();
  p.drive({ keep: ["Nick Fury"] });
  expect(p.has("Nick Fury", "discard")).toBe(true);
  expect(beat(p, (b) => b.leftPlay === fury)).toBeGreaterThanOrEqual(0);
});

test("01084 Nick Fury: 'remove 2 threat' is not offered when no scheme has threat", () => {
  const p = scenario(handOf("01084", "01090", "01088", "01087", "01086", "01085"));
  p.play("Nick Fury", { pay: ["Strength", "Energy"] });
  const labels = p.snap.choice!.options.map((o) => o.label);
  expect(labels.some((l) => /Remove 2 threat/i.test(l))).toBe(false);
});

// Resources and keyword/timing interactions ----------------------------------------------------------------------------------

test("01088/01089/01090 resource cards cannot be played, show their icons, and pay for cards when spent", () => {
  const p = scenario(handOf("01088", "01089", "01090", "01087", "01086", "01085"));
  p.form();
  for (const [name, icon] of [
    ["Energy", "energy"],
    ["Genius", "mental"],
    ["Strength", "physical"],
  ] as const) {
    const card = p.card(name);
    expect(card).toMatchObject({ playable: false, type: "resource" });
    expect(card.reason).toBe("Spend this card to pay for another card.");
    expect(p.battle.pick(card.id)).toBe(false);
    p.battle.pick(p.card("Haymaker").id);
    const source = p.snap.payment!.sources.find((s) => s.label === name)!;
    expect(source.icons).toEqual([icon, icon]);
    p.battle.toggle(source.id);
    expect(p.snap.payment).toMatchObject({ canPay: true, discards: [source.cardId] });
    p.battle.cancel();
    expect(p.snap.payment).toBeNull();
  }
  p.play("Haymaker", { pay: ["Energy"] });
  expect(p.snap.discard.map((c) => c.name)).toContain("Energy");
});

test("01001a Spider-Sense is only for the villain's own attack: a minion's attack gives no second offer", () => {
  const p = scenario(engageMinion("01110"), encounterTop("01186", "01108"));
  p.form();
  p.end();
  let offers = 0;
  p.drive({
    accept: (o) => {
      if (/Spider-Sense/.test(o.question)) offers++;
      return false;
    },
  });
  expect(offers).toBe(1);
  expect(p.beats.some((b) => b.hit?.source === p.card("Hydra Bomber", "enemyCards").id)).toBe(true); // the minion did attack
});

test("01004 Enhanced Spider-Sense is not offered for a treachery flipped as a boost card (it is not 'revealed')", () => {
  const p = scenario(handOf("01004", "01090", "01088", "01089", "01087", "01086"), encounterTop("01105", "01108"));
  p.form();
  p.end();
  const asked: string[] = [];
  p.drive({
    keep: ["Enhanced Spider-Sense"],
    accept: (o) => {
      asked.push(o.question);
      return false;
    },
  });
  expect(asked.filter((q) => /Enhanced/.test(q))).toEqual([]);
  expect(p.beats.some((b) => b.reveal?.boost && /Tough/.test(b.reveal.name))).toBe(true);
  expect(p.has("Enhanced Spider-Sense", "hand")).toBe(true);
});

test("01061 Great Responsibility is a Hero Interrupt: not offered in alter-ego form", () => {
  const p = scenario(handOf("01061", "01090", "01088", "01089", "01087", "01086"), encounterTop("01186", "01108"));
  const asked: string[] = [];
  p.end();
  p.drive({
    keep: ["Great Responsibility"],
    accept: (o) => {
      asked.push(o.question);
      return false;
    },
  });
  expect(asked.filter((q) => /Great Responsibility/.test(q))).toEqual([]);
});

test("01008 Web-Shooter can pay for Enhanced Spider-Sense inside the interrupt window (no hand card spent)", () => {
  const p = scenario(handOf("01008", "01004", "01090", "01088", "01089", "01087"), encounterTop("01186", "01105"));
  p.form();
  p.play("Web-Shooter", { pay: ["Strength"] });
  p.end();
  const at = p.drive({
    keep: ["Enhanced Spider-Sense"],
    stopWhen: (x) => !!x.choice?.offers?.some((o) => /Enhanced/.test(o.question)),
  });
  const offer = at.choice!.offers!.find((o) => /Enhanced/.test(o.question))!;
  p.run(() => p.battle.chooseMany([offer.id]));
  const web = resourceSources(p).find((s) => s.cardId === p.card("Web-Shooter", "inPlay").id)!;
  expect(web).toMatchObject({ available: true, icons: ["wild"] });
  const hand = p.snap.hand.length;
  p.battle.toggle(web.id);
  expect(p.snap.payment).toMatchObject({ canPay: true });
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.snap.hand.length).toBe(hand - 1); // only the event itself left the hand
  expect(p.card("Web-Shooter", "inPlay")).toMatchObject({ exhausted: true });
  expect(p.card("Web-Shooter", "inPlay").markers).toContainEqual({ name: "web", count: 2 });
  expect(p.snap.villain.markers.some((m) => m.name === "tough")).toBe(false);
  expect(p.has("Enhanced Spider-Sense", "discard")).toBe(true);
});

// Card-vs-keyword interactions through the table ---------------------------------------------------------------------------

test("Guard (Hydra Mercenary) + 01005 Swinging Web Kick: the attack event can only target the guard, not Rhino", () => {
  const p = scenario(handOf("01005", "01090", "01088", "01089", "01087", "01086"), engageMinion("01101"));
  p.form();
  const guard = p.card("Hydra Mercenary", "enemyCards");
  const rhinoHp = p.snap.villainHp;
  p.battle.pick(p.card("Swinging Web Kick").id);
  p.spend("Strength", "Haymaker");
  p.run(() => p.battle.pay());
  // One legal target, still asked, saying why Rhino isn't one (Adam, 2026-11-25).
  expect(p.snap.choice?.prompt).toBe("Choose an enemy to attack");
  expect(p.snap.choice?.options.map((o) => o.cardId)).toEqual([guard.id]);
  expect(p.snap.choice?.guard).toEqual({ blocked: [p.snap.villain.id], guards: [guard.id] });
  expect(p.snap.choice?.explanation).toBe("Hydra Mercenary has Guard: Rhino can't be attacked until it is defeated.");
  // The guard takes the 8 (HP 3) and dies.
  p.choose({ card: guard.id });
  expect(p.snap.villainHp).toBe(rhinoHp);
  expect(p.has("Hydra Mercenary", "enemyCards")).toBe(false);
});

test("Guard (Hydra Mercenary): the hero's basic attack is forced onto the guard", () => {
  const p = scenario(engageMinion("01101"));
  p.form();
  const guard = p.card("Hydra Mercenary", "enemyCards");
  const rhinoHp = p.snap.villainHp;
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  // Asked anyway, with the guard as the only answer, so the table can say why Rhino is out of reach (Adam, 2026-11-25).
  expect(p.snap.choice?.options.map((o) => o.cardId)).toEqual([guard.id]);
  expect(p.snap.choice?.guard?.guards).toEqual([guard.id]);
  p.choose({ card: guard.id });
  expect(p.snap.choice).toBeNull();
  expect(p.snap.villainHp).toBe(rhinoHp);
  expect(p.card("Hydra Mercenary", "enemyCards").markers).toContainEqual({ name: "damage", count: 2 });
  expect(beat(p, (b) => b.hit?.target === guard.id && b.hit.amount === 2)).toBeGreaterThanOrEqual(0);
});

test("Guard does not restrict 01058 Daredevil's 'deal 1 damage' response (not an attack): Rhino is a legal target", () => {
  const p = scenario(inPlay("01058"), engageMinion("01101"), patchByCode("scheme", { threat: 3 }));
  const dd = p.card("Daredevil", "inPlay");
  p.battle.fieldAction(dd.id, "basicThwart");
  p.run(() => p.battle.chooseMany([p.snap.choice!.offers![0]!.id]));
  const ids = p.snap.choice!.options.map((o) => o.cardId);
  expect(ids).toContain(p.snap.villain.id);
});

test("Toughness (Sandman) vs 01087 Haymaker: the tough status absorbs the whole hit and is shown", () => {
  const p = scenario(
    handOf("01087", "01090", "01088", "01089", "01086", "01085"),
    engageMinion("01102"),
    patchCard("01102", { statuses: { tough: 1, stunned: 0, confused: 0 } }),
  );
  p.form();
  const sandman = p.card("Sandman", "enemyCards");
  expect(sandman.markers).toContainEqual({ name: "tough", count: 1 });
  p.battle.pick(p.card("Haymaker").id);
  p.spend("Strength");
  p.run(() => p.battle.pay());
  p.mark();
  p.choose({ card: sandman.id });
  const after = p.card("Sandman", "enemyCards");
  expect(after.markers.some((m) => m.name === "tough")).toBe(false);
  expect(after.markers.some((m) => m.name === "damage")).toBe(false);
  expect(
    beat(p, (b) => b.hit?.target === sandman.id && b.hit.tough === true && b.hit.source === p.snap.hero.id),
  ).toBeGreaterThanOrEqual(0);
});

test("ally basic attack with Rhino and a minion engaged asks which enemy", () => {
  const p = scenario(inPlay("01002"), engageMinion("01110"), patchByCode("scheme", { threat: 3 }));
  const cat = p.card("Black Cat", "inPlay");
  const bomber = p.card("Hydra Bomber", "enemyCards");
  expect(p.battle.fieldAction(cat.id, "basicAttack")).toBe(true);
  expect(p.snap.choice!.prompt).toMatch(/attack/i);
  expect(p.snap.choice!.options.map((o) => o.cardId).sort()).toEqual([bomber.id, p.snap.villain.id].sort());
  p.mark();
  p.choose({ card: bomber.id });
  expect(p.card("Hydra Bomber", "enemyCards").markers).toContainEqual({ name: "damage", count: 1 });
  expect(p.card("Black Cat", "inPlay").exhausted).toBe(true);
  expect(p.battle.fieldActions(cat.id)).toEqual([]);
});

test("ally thwart with a main and a side scheme asks which scheme, and removes threat from the chosen one", () => {
  const p = scenario(inPlay("01002"), encounterTop("01186", "01109"), patchByCode("scheme", { threat: 1 }));
  p.end();
  p.drive();
  const cat = p.card("Black Cat", "inPlay");
  const side = p.card("Bomb Scare", "enemyCards");
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  expect(p.battle.fieldAction(cat.id, "basicThwart")).toBe(true);
  expect(p.snap.choice!.prompt).toMatch(/thwart/i);
  expect(p.snap.choice!.options.map((o) => o.cardId).sort()).toEqual([main.id, side.id].sort());
  p.mark();
  p.choose({ card: side.id });
  expect(p.card("Bomb Scare", "enemyCards").threat).toBe(side.threat! - 1);
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBe(main.threat);
  expect(beat(p, (b) => b.threat?.scheme === side.id && b.threat.delta === -1)).toBeGreaterThanOrEqual(0);
});

test("Crisis (Crowd Control): For Justice! and basic thwart can only remove threat from the side scheme, not the main scheme", () => {
  const p = scenario(
    handOf("01060", "01090", "01088", "01089", "01087", "01086"),
    encounterTop("01186", "01108"),
    patchByCode("scheme", { threat: 1 }),
  );
  p.end();
  p.drive({ keep: ["For Justice!"] });
  p.form();
  const crowd = p.card("Crowd Control", "enemyCards");
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  expect(main.threat).toBeGreaterThan(0);
  // basic thwart: only one legal scheme, so no prompt; it hits Crowd Control
  expect(p.battle.heroAction("basicThwart")).toBe(true);
  expect(p.snap.choice).toBeNull();
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBe(main.threat);
  expect(p.card("Crowd Control", "enemyCards").threat).toBe(crowd.threat! - 1);
  // For Justice!: same
  p.play("For Justice!", { pay: ["Energy"] });
  if (p.snap.choice) {
    expect(p.snap.choice.options.map((o) => o.cardId)).toEqual([crowd.id]);
    p.choose({ card: crowd.id });
  }
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBe(main.threat);
});

// Play from hand / extra beats / wild resources / cancel paths --------------------------------------------------------------

test("01058 Daredevil: played from hand for 4 and ready to thwart at once", () => {
  const p = scenario(
    handOf("01058", "01090", "01088", "01087", "01086", "01085"),
    patchByCode("scheme", { threat: 3 }),
  );
  expect(p.card("Daredevil").cost).toBe(4);
  p.play("Daredevil", { pay: ["Strength", "Energy"] });
  expect(p.card("Daredevil", "inPlay")).toMatchObject({ exhausted: false });
  expect(
    p.battle
      .fieldActions(p.card("Daredevil", "inPlay").id)
      .map((a) => a.label)
      .sort(),
  ).toEqual(["Attack", "Thwart"]);
});

test("01007 Spider-Tracer: attached minion's defeat removes 3 threat with an interrupt beat", () => {
  const p = scenario(
    handOf("01007", "01090", "01088", "01087", "01086", "01085"),
    engageMinion("01110"),
    patchByCode("scheme", { threat: 5 }),
  );
  p.form();
  const minion = p.card("Hydra Bomber", "enemyCards");
  p.play("Spider-Tracer", { pay: ["Energy"] });
  const tracer = p.card("Spider-Tracer", "enemyCards");
  expect(tracer.attachedTo).toBe(minion.id);
  p.battle.heroAction("basicAttack");
  p.mark();
  p.choose({ card: minion.id });
  expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(2);
  expect(beat(p, (b) => b.interrupt === tracer.id)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.threat?.delta === -3)).toBeGreaterThanOrEqual(0);
});

test("01093 Tenacity: readies the exhausted hero and shows the ready beat", () => {
  const p = scenario(handOf("01093", "01090", "01088", "01087", "01086", "01085"));
  p.form();
  p.battle.heroAction("basicAttack");
  expect(p.snap.hero.exhausted).toBe(true);
  p.battle.pick(p.card("Tenacity").id);
  p.spend("Energy");
  p.run(() => p.battle.pay());
  const t = p.ability("Tenacity", "inPlay");
  p.mark();
  p.battle.fieldAction(t.card.id, t.kind);
  p.spend("Strength");
  p.run(() => p.battle.pay());
  expect(p.snap.hero.exhausted).toBe(false);
  expect(beat(p, (b) => b.turned?.id === p.snap.hero.id && b.turned.exhausted === false)).toBeGreaterThanOrEqual(0);
});

test("Wild resources: Power of Justice alone pays For Justice! and Web-Shooter's wild pays Tenacity's physical cost", () => {
  const a = scenario(
    handOf("01062", "01060", "01090", "01088", "01087", "01086"),
    patchByCode("scheme", { threat: 6 }),
  );
  a.form();
  a.play("For Justice!", { pay: ["The Power of Justice"] });
  // A wild resource counts as every type (RRG "Resources", from engine comments; PDF unreadable here), so it is "paid with mental": 4 removed.
  expect(a.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(2);

  const p = scenario(handOf("01008", "01093", "01090", "01088", "01087", "01086"));
  p.form();
  p.play("Web-Shooter", { pay: ["Strength"] });
  p.battle.heroAction("basicAttack");
  p.play("Tenacity", { pay: ["Energy"] });
  const t = p.ability("Tenacity");
  p.battle.fieldAction(t.card.id, t.kind);
  const web = (p.snap.payment?.sources ?? []).find((s) => s.kind === "resourceAbility");
  expect(web).toBeDefined();
  expect(web!.available).toBe(true);
  p.battle.toggle(web!.id);
  expect(p.snap.payment!.canPay).toBe(true);
  p.run(() => p.battle.pay());
  expect(p.snap.hero.exhausted).toBe(false);
});

test("Cancel paths: backing out of the host prompt and of the payment sheet leaves the card in hand and playable again", () => {
  const p = scenario(handOf(...WU_HAND), engageMinion("01110"));
  p.form();
  const wu = p.card("Webbed Up").id;
  p.battle.pick(wu);
  expect(p.snap.choice!.canCancel).toBe(true);
  p.run(() => p.battle.cancel());
  expect(p.snap.choice).toBeNull();
  expect(p.has("Webbed Up", "hand")).toBe(true);
  p.battle.pick(wu);
  p.choose({ card: p.snap.villain.id });
  p.spend("Strength");
  p.run(() => p.battle.cancel());
  expect(p.snap.payment).toBeNull();
  expect(p.has("Webbed Up", "hand")).toBe(true);
  expect(p.battle.pick(wu)).toBe(true);
  expect(p.snap.choice!.options).toHaveLength(2);
});

// The prompt itself stays generic ("Choose a target"); the dock names its card from choiceSource.
test("Follow-up prompts name the card that is asking", () => {
  const p = scenario(inPlay("01058"), engageMinion("01110"), patchByCode("scheme", { threat: 3 }));
  p.battle.fieldAction(p.card("Daredevil", "inPlay").id, "basicThwart");
  p.run(() => p.battle.chooseMany([p.snap.choice!.offers![0]!.id]));
  expect(p.snap.choiceSource).toBe(p.card("Daredevil", "inPlay").id);
});
