import { beforeEach, describe, expect, test } from "vitest";
import * as engine from "@mc/engine";
import {
  BattleModel,
  formWhenRevealed,
  isModuleId,
  MODULES,
  recommendedModule,
  VILLAINS,
  whenRevealedMissesHeroes,
  type BattleSnapshot,
} from "./model.js";
import { arrangeScene } from "./debug-scenes.js";

describe("Peter Parker and Rhino's practice turn", () => {
  let battle: BattleModel;

  beforeEach(() => {
    battle = new BattleModel();
    battle.reset();
  });

  function pick(name: string) {
    const card = battle.snapshot().hand.find((candidate) => candidate.name === name)!;
    expect(battle.pick(card.id)).toBe(true);
    return card;
  }

  function spend(label: string) {
    const source = battle.snapshot().payment!.sources.find((candidate) => candidate.label === label)!;
    expect(source).toBeDefined();
    battle.toggle(source.id);
    return source;
  }

  test("undo restores one committed move, including payment, hand order and End Turn", () => {
    const opening = battle.snapshot();
    expect(battle.undo()).toBe(false);
    battle.heroAction("changeForm");
    pick("Helicarrier");
    spend("Strength");
    spend("Jessica Jones");
    expect(battle.pay()).toBe(true);
    const paid = battle.snapshot();
    expect(battle.endTurn()).toBe(true);
    expect(battle.undo()).toBe(true);
    expect(battle.snapshot()).toMatchObject({
      inPlay: paid.inPlay,
      discard: paid.discard,
      hand: paid.hand,
      choice: null,
    });
    expect(battle.undo()).toBe(true);
    expect(battle.snapshot()).toMatchObject({ inPlay: [], discard: [], payment: null, hero: { name: "Spider-Man" } });
    expect(battle.snapshot().hand.map((c) => c.id)).toEqual(opening.hand.map((c) => c.id));
    expect(battle.undo()).toBe(true);
    expect(battle.snapshot().hero).toEqual(opening.hero);
    expect(battle.canUndo).toBe(false);
    battle.endTurn();
    battle.reset();
    expect(battle.canUndo).toBe(false);
  });

  test("shows the basic attack impact before turning the attacker sideways", () => {
    battle.heroAction("changeForm");
    const hero = battle.snapshot().hero.id;
    expect(battle.heroAction("basicAttack")).toBe(true);
    const { beats } = battle.snapshot();
    const impact = beats.findIndex((beat) => beat.hit?.source === hero);
    expect(impact).toBeGreaterThanOrEqual(0);
    expect(beats.findIndex((beat) => beat.turned?.id === hero && beat.turned.exhausted)).toBeGreaterThan(impact);
    expect(battle.snapshot().hero.exhausted).toBe(true);
  });

  test("Spider-Man stays exhausted after defending Rhino and cannot also defend Hydra Bomber", () => {
    battle.heroAction("changeForm");
    const hero = battle.snapshot().hero.id;
    const defended: string[] = [];
    const attackHits: string[] = [];
    for (let round = 1; round <= 2; round++) {
      expect(battle.endTurn()).toBe(true);
      for (let step = 0; step < 24; step++) {
        const { beats, choice, turn } = battle.snapshot();
        for (const beat of beats) if (beat.hit?.target === hero && beat.activity) attackHits.push(beat.activity);
        if (turn === "player" && !choice) break;
        expect(choice).toBeTruthy();
        if (!choice) break;
        if (choice.defense) {
          const defender = choice.options.find((opt) => opt.cardId === hero);
          expect(defender).toBeDefined();
          defended.push(choice.defense.attacker);
          expect(battle.choose(defender!.id)).toBe(true);
        } else {
          const options = choice.options.filter((o) => o.label === "Strength" && choice.discardFromHand);
          const picks = options.length ? [options[0]!] : choice.options.slice(0, choice.min);
          expect(battle.chooseMany(picks.map((opt) => opt.id))).toBe(true);
        }
      }
      expect(battle.snapshot().hero.exhausted).toBe(true);
    }
    expect(defended).toEqual(["Rhino", "Rhino"]);
    expect(attackHits).toContain("Hydra Bomber attacks");
  });

  test("ends the player turn, resolves the enemy turn, and starts the next round", () => {
    expect(battle.snapshot()).toMatchObject({ turn: "player", round: 1, canEndTurn: true });
    expect(battle.heroAction("changeForm")).toBe(true);
    expect(battle.endTurn()).toBe(true);
    expect(battle.snapshot()).toMatchObject({
      turn: "ending",
      canEndTurn: false,
      choice: { discardFromHand: true, min: 1 },
    });
    expect(battle.endTurn()).toBe(false);
    const strength = battle.snapshot().choice!.options.find((option) => option.label === "Strength")!;
    expect(battle.chooseMany([])).toBe(false);
    expect(battle.chooseMany([strength.id])).toBe(true);
    expect(battle.snapshot()).toMatchObject({ turn: "enemy", canEndTurn: false });
    for (let i = 0; i < 12 && battle.snapshot().turn === "enemy"; i++) {
      const choice = battle.snapshot().choice!;
      expect(choice).not.toBeNull();
      expect(battle.chooseMany(choice.options.slice(0, choice.min).map((option) => option.id))).toBe(true);
    }
    expect(battle.snapshot()).toMatchObject({ turn: "player", round: 2, canEndTurn: true });
    expect(battle.snapshot().heroHp).toBeLessThan(10);
    expect(battle.snapshot().discard.some((card) => card.name === "Strength")).toBe(true);
  });

  test("deals the same visible cards after reset and identifies cards that only pay", () => {
    const opening = battle.snapshot();
    expect(opening.hero.name).toContain("Peter Parker");
    expect(opening.villain.name).toContain("Rhino");
    expect(opening.heroHp).toBe(10);
    expect(opening.villainHp).toBe(14);
    expect(opening.hand).toHaveLength(6);
    expect(opening.discard).toEqual([]);
    expect(opening.hand.every((card) => card.art.includes("/card-art/") && !card.art.includes("back"))).toBe(true);
    const strength = opening.hand.find((card) => card.name === "Strength")!;
    expect(strength).toMatchObject({ playable: false, type: "resource" });
    expect(battle.pick(strength.id)).toBe(false);
    battle.reset();
    expect(battle.snapshot()).toEqual(opening);
  });

  test("a newly played ally can attack, exhausts and takes consequential damage", () => {
    const ally = pick("Jessica Jones");
    spend("Strength");
    spend("Heroic Intuition");
    expect(battle.pay()).toBe(true);
    expect(battle.fieldActions(ally.id)).toContainEqual({ kind: "basicAttack", label: "Attack" });
    expect(battle.fieldAction(ally.id, "basicAttack")).toBe(true);
    const board = battle.snapshot();
    expect(board.villainHp).toBeLessThan(14);
    expect(board.inPlay.find((c) => c.id === ally.id)).toMatchObject({
      exhausted: true,
      markers: [{ name: "damage", count: 1 }],
    });
    expect(battle.fieldAction(ally.id, "basicAttack")).toBe(false);
  });

  test("can exhaust a newly played Helicarrier to discount the next play", () => {
    const carrier = pick("Helicarrier");
    spend("Strength");
    spend("Jessica Jones");
    expect(battle.pay()).toBe(true);
    const [action] = battle.fieldActions(carrier.id);
    expect(action).toBeDefined();
    expect(battle.fieldAction(carrier.id, action!.kind)).toBe(true);
    expect(battle.snapshot().inPlay.find((c) => c.id === carrier.id)?.exhausted).toBe(true);
    expect(battle.fieldActions(carrier.id)).toEqual([]);
    pick("Heroic Intuition");
    expect(battle.snapshot().payment?.required).toBe(1);
  });

  test("requires manual payment and commits only the chosen resources to play a support", () => {
    const subject = pick("Helicarrier");
    let priced = battle.snapshot().payment!;
    expect(priced).toMatchObject({ subject, paid: 0, required: 3, canPay: false });
    expect(priced.sources.some((source) => source.cardId === subject.id)).toBe(false);
    expect(battle.pay()).toBe(false);
    const strength = spend("Strength");
    expect(strength.icons).toEqual(["physical", "physical"]);
    expect(battle.snapshot().payment).toMatchObject({ paid: 2, canPay: false });
    expect(battle.pay()).toBe(false);
    const extra = spend("Heroic Intuition");
    expect(extra.icons).toHaveLength(1);
    priced = battle.snapshot().payment!;
    expect(priced).toMatchObject({ paid: 3, required: 3, canPay: true });
    const spare = priced.sources.find((s) => !s.selected)!;
    expect(spare.available).toBe(false);
    battle.toggle(spare.id);
    expect(battle.snapshot().payment!.paid).toBe(3);
    battle.toggle(extra.id);
    expect(battle.snapshot().payment!.sources.find((s) => s.id === spare.id)?.available).toBe(true);
    battle.toggle(extra.id);
    expect(battle.snapshot().hand).toHaveLength(6);
    expect(battle.pay()).toBe(true);
    expect(battle.pay()).toBe(false);
    const result = battle.snapshot();
    expect(result.hand).toHaveLength(3);
    expect(result.hand.some((card) => [subject.id, extra.cardId, strength.cardId].includes(card.id))).toBe(false);
    expect(result.inPlay.some((card) => card.id === subject.id)).toBe(true);
    expect(result.discard.map((card) => card.id)).toEqual([strength.cardId, extra.cardId]);
  });

  test("deselecting or cancelling a staged card leaves the original hand intact", () => {
    const opening = battle.snapshot();
    pick("Heroic Intuition");
    spend("Strength");
    expect(battle.snapshot().payment?.canPay).toBe(true);
    spend("Strength");
    expect(battle.snapshot().payment?.paid).toBe(0);
    expect(battle.snapshot().payment?.discards).toEqual([]);
    spend("Strength");
    battle.cancel();
    expect(battle.snapshot()).toEqual(opening);
  });

  test("reselecting a source moves its card to the top of the proposed and committed discard stack", () => {
    pick("Helicarrier");
    const strength = spend("Strength");
    const intuition = spend("Heroic Intuition");
    spend("Strength");
    spend("Strength");
    const proposed = [intuition.cardId, strength.cardId];
    const before = battle.snapshot();
    expect(before.payment?.discards).toEqual(proposed);
    expect(before.discard).toHaveLength(0);
    expect(battle.pay()).toBe(true);
    const { discard } = battle.snapshot();
    expect(discard.map((card) => card.id)).toEqual(proposed);
    expect(discard.map((card) => card.name)).toEqual(["Heroic Intuition", "Strength"]);
    for (const card of discard) {
      expect(card.art).toBe(before.hand.find((source) => source.id === card.id)!.art);
    }
  });

  test("paying for Swinging Web Kick allows the real engine to damage Rhino", () => {
    expect(battle.heroAction("changeForm")).toBe(true);
    const kick = pick("Swinging Web Kick");
    const strength = spend("Strength");
    const intuition = spend("Heroic Intuition");
    expect(battle.pay()).toBe(true);
    expect(battle.snapshot().choice).toBeNull();
    expect(
      battle
        .snapshot()
        .beats.some((beat) => beat.hit?.target === battle.snapshot().villain.id && beat.hit.amount === 8),
    ).toBe(true);
    expect(battle.snapshot().villainHp).toBe(6);
    expect(battle.snapshot().inPlay.some((card) => card.name === "Swinging Web Kick")).toBe(false);
    expect(battle.snapshot().discard.map((card) => card.id)).toEqual([strength.cardId, intuition.cardId, kick.id]);
    expect(battle.snapshot().discard.at(-1)?.art).toBe(kick.art);
  });
});

describe("the opening hand", () => {
  test("a dealt game waits on the mulligan, swaps the picked cards and then starts the hero phase", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 75, mulligan: true });
    const opening = battle.snapshot();
    expect(opening.choice).toMatchObject({ mulligan: true, min: 0, max: opening.hand.length });
    expect(opening.canEndTurn).toBe(false);
    const picks = opening.choice!.options.slice(0, 2);
    const swapped = picks.map((option) => option.cardId!);
    expect(battle.chooseMany(picks.map((option) => option.id))).toBe(true);

    const after = battle.snapshot();
    expect(after.choice).toBeNull();
    expect(after.turn).toBe("player");
    expect(after.hand).toHaveLength(opening.hand.length);
    expect(after.discard.map((card) => card.id)).toEqual(expect.arrayContaining(swapped));
    const discarded = after.beats.findIndex((beat) => beat.handDiscard);
    const drawn = after.beats.findIndex((beat) => beat.draw?.length === 2);
    const heroPhase = after.beats.findIndex((beat) => beat.phase === "hero");
    expect(after.beats[discarded]?.handDiscard).toEqual(expect.arrayContaining(swapped));
    expect(drawn).toBeGreaterThan(discarded);
    expect(heroPhase).toBeGreaterThan(drawn);

    // Undo goes back to the same opening hand, still waiting on the mulligan.
    expect(battle.undo()).toBe(true);
    expect(battle.snapshot().choice?.mulligan).toBe(true);
    expect(battle.snapshot().hand.map((card) => card.id)).toEqual(opening.hand.map((card) => card.id));
    expect(battle.canUndo).toBe(false);
  });

  test("keeping the hand shows only the hero phase starting", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 75, mulligan: true });
    expect(battle.chooseMany([])).toBe(true);
    const { beats } = battle.snapshot();
    expect(beats.filter((beat) => beat.handDiscard || beat.draw)).toHaveLength(0);
    expect(beats.some((beat) => beat.phase === "hero")).toBe(true);
  });

  test("each seed is its own deal, and the same seed deals the same hand again", () => {
    const hand = (seed: number) => {
      const battle = new BattleModel();
      battle.reset({ seed, mulligan: true });
      return battle.snapshot().hand.map((card) => card.name);
    };
    expect(hand(1234)).toEqual(hand(1234));
    expect(hand(1234)).not.toEqual(hand(75));
  });
});

describe("reacting to a revealed encounter card", () => {
  /** End the turn on the Spider-Sense table and answer everything until Enhanced Spider-Sense is offered. */
  function atTheOffer() {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("sense")! });
    battle.endTurn();
    let s = battle.snapshot();
    for (let i = 0; i < 12 && !s.choice?.offers?.some((o) => /Enhanced/.test(o.question)); i++) {
      if (s.choice?.offers?.length) battle.chooseMany([]);
      else if (s.choice) battle.choose(s.choice.options.at(-1)?.id ?? null);
      s = battle.snapshot();
    }
    const offer = s.choice!.offers!.find((o) => /Enhanced/.test(o.question))!;
    expect(s.choice!.event).toMatchObject({ kind: "encounterCardRevealing", before: true });
    return { battle, offer, revealed: s.choice!.event!.subject! };
  }

  test("Undo while paying for the reaction goes back to its question, with the payment dropped", () => {
    const { battle, offer } = atTheOffer();
    battle.chooseMany([offer.id]);
    expect(battle.payingForReaction).toBe(true);
    battle.toggle(battle.snapshot().payment!.sources[0]!.id);
    expect(battle.snapshot().payment!.sources.some((source) => source.selected)).toBe(true);
    expect(battle.undo()).toBe(true);
    const back = battle.snapshot();
    expect(back.payment).toBeNull();
    expect(back.choice?.offers?.some((o) => o.id === offer.id)).toBe(true);
  });

  test("Cancel while paying for the reaction passes on it: the reveal goes on, the event back in hand", () => {
    const { battle, offer, revealed } = atTheOffer();
    const event = battle.snapshot().hand.find((card) => card.name === "Enhanced Spider-Sense")!;
    battle.chooseMany([offer.id]);
    battle.cancel();
    const after = battle.snapshot();
    expect(after.payment).toBeNull();
    expect(after.choice?.event?.subject).not.toBe(revealed);
    expect(after.beats.some((beat) => beat.interrupt)).toBe(false);
    expect(after.hand.some((card) => card.id === event.id)).toBe(true);
  });

  test("paying for a card from the hand is not paying for a reaction", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("kick")! });
    const kick = battle.snapshot().hand.find((card) => card.name === "Swinging Web Kick")!;
    expect(battle.pick(kick.id)).toBe(true);
    expect(battle.snapshot().payment).not.toBeNull();
    expect(battle.payingForReaction).toBe(false);
  });

  test("paying cancels the card's When Revealed and it is discarded, with the event after it", () => {
    const { battle, offer, revealed } = atTheOffer();
    battle.chooseMany([offer.id]);
    battle.toggle(battle.snapshot().payment!.sources[0]!.id);
    expect(battle.pay()).toBe(true);
    const after = battle.snapshot();
    expect(after.encounterDiscard.some((c) => c.id === revealed)).toBe(true);
    const order = after.beats.flatMap((b) => (b.interrupt ? ["interrupt"] : b.discardEvent ? ["discard"] : []));
    expect(order).toEqual(["interrupt", "discard"]);
  });
});

describe("Black Cat's Forced Response", () => {
  test("the deck discard names Black Cat and her ability, and the card she keeps comes back on the next beat", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("blackcat")! });
    const cat = battle.snapshot().hand.find((card) => card.name === "Black Cat")!;
    expect(battle.pick(cat.id)).toBe(true);
    for (const source of battle.snapshot().payment!.sources.slice(0, 2)) battle.toggle(source.id);
    expect(battle.pay()).toBe(true);
    const { beats, hand } = battle.snapshot();
    const milledAt = beats.findIndex((beat) => beat.milled);
    const milled = beats[milledAt]!;
    expect(milled.milled).toHaveLength(2);
    expect(milled.millSource).toEqual({ card: cat.id, label: "Forced Response", miss: "No mental resources" });
    const kept = beats[milledAt + 1]!.returned!;
    expect(kept.every((id) => milled.milled!.includes(id))).toBe(true);
    expect(hand.find((card) => kept.includes(card.id))?.name).toBe("Genius");
  });
});

describe("a treachery that makes the villain attack (Assault)", () => {
  /** End the turn on `scene` and answer every question (passing, not defending), collecting every beat shown. */
  function playOut(scene: string): BattleSnapshot["beats"][number][] {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene(scene)! });
    battle.endTurn();
    const beats = [...battle.snapshot().beats];
    for (let i = 0; i < 12; i++) {
      const s = battle.snapshot();
      if (!s.choice) break;
      if (s.choice.offers?.length) battle.chooseMany([]);
      else battle.choose((s.choice.defense ? s.choice.options[0] : s.choice.options.at(-1))?.id ?? null);
      beats.push(...battle.snapshot().beats);
    }
    return beats;
  }

  test("each form's When Revealed line is found, in the printed text and in the run-together searchable text", () => {
    const printed = "When Revealed (Alter-Ego): This card gains surge.\nWhen Revealed (Hero): The villain attacks you.";
    expect(formWhenRevealed(printed, "hero")).toEqual({ applies: { form: "Hero", text: "The villain attacks you." } });
    expect(formWhenRevealed(printed.replace("\n", " "), "alterEgo")).toEqual({
      applies: { form: "Alter-Ego", text: "This card gains surge." },
    });
    expect(formWhenRevealed("When Revealed: Give Rhino a tough status card.", "hero")).toEqual({});
  });

  test("a When Revealed that hits each hero finds no one in alter-ego form (Shocker)", () => {
    const shocker = "When Revealed: Deal 1 damage to each hero.";
    expect(whenRevealedMissesHeroes(shocker, "alterEgo")).toBe(true);
    expect(whenRevealedMissesHeroes(shocker, "hero")).toBe(false);
    expect(whenRevealedMissesHeroes("When Revealed: Give Rhino a tough status card.", "alterEgo")).toBe(false);
    expect(
      whenRevealedMissesHeroes(
        "When Revealed (Alter-Ego): This card gains surge. When Revealed (Hero): Deal 1 damage to each hero.",
        "alterEgo",
      ),
    ).toBe(false);
  });

  test("in hero form: Rhino's attack is aimed, lands, and only then does Assault go to the discard pile", () => {
    const beats = playOut("assault");
    const reveal = beats.findIndex((beat) => beat.reveal?.name === "Assault");
    const assault = beats[reveal]!.reveal!;
    expect(assault.applies).toEqual({ form: "Hero", text: "The villain attacks you." });
    const after = beats.slice(reveal + 1);
    const aim = after.findIndex((beat) => beat.attackAim);
    const hit = after.findIndex((beat) => beat.hit?.source === after[aim]!.attackAim!.source);
    const gone = after.findIndex((beat) => beat.encounterResolved === assault.id);
    expect(aim).toBeGreaterThanOrEqual(0);
    expect(after[aim]!.activity).toBe("Rhino attacks");
    expect(hit).toBeGreaterThan(aim);
    expect(gone).toBeGreaterThan(hit);
    // The attack it called is over: the villain phase goes back to its own step.
    expect(after[gone]!.activity).toBe("Reveal encounter cards");
  });

  test("every attack is aimed exactly once, an activation's as well as one a card calls", () => {
    for (const scene of ["assault", "attack"]) {
      const beats = playOut(scene);
      const aims = beats.filter((beat) => beat.attackAim).length;
      const attacks = beats.filter(
        (beat) => beat.hit && beat.hit.source === beats.find((b) => b.attackAim)?.attackAim?.source,
      ).length;
      expect(aims, scene).toBe(attacks);
    }
  });

  test("in alter-ego form: Assault surges, the next card is dealt, then Assault goes to the discard pile", () => {
    const beats = playOut("assaultsurge");
    const reveal = beats.findIndex((beat) => beat.reveal?.name === "Assault");
    const assault = beats[reveal]!.reveal!;
    expect(assault.applies).toEqual({ form: "Alter-Ego", text: "This card gains surge." });
    const surge = beats.findIndex((beat) => beat.surge === assault.id);
    const gone = beats.findIndex((beat) => beat.encounterResolved === assault.id);
    expect(surge).toBeGreaterThan(reveal);
    expect(gone).toBeGreaterThan(surge);
    expect(beats.slice(reveal).some((beat) => beat.attackAim)).toBe(false);
  });
});

describe("the pictures a game loads as it deals", () => {
  test.each(["rhino", "klaw", "ultron"] as const)("cover every card of a game against %s, both faces", (villain) => {
    const battle = new BattleModel();
    battle.reset({ villain, seed: 7, mulligan: true });
    const pictures = new Set(battle.pictures());
    const state = battle.snapshot();
    // The hand, the hero, the villain and every face-up enemy card are among them.
    for (const card of [...state.hand, state.hero, state.villain, ...state.enemyCards])
      if (card.art && !card.art.startsWith("data:")) expect(pictures).toContain(card.art);
    // A whole player deck and encounter deck, both backs, and the hero's other side: far more than the opening table.
    expect(pictures.size).toBeGreaterThan(40);
    expect([...pictures].every((url) => typeof url === "string" && url.length > 0)).toBe(true);
  });
});

describe("the hero the deal takes", () => {
  test("is Spider-Man with his Justice starter deck unless chosen otherwise", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 75 });
    expect(battle.matchup).toEqual({ hero: "spider-man", villain: "rhino" });
    const state = battle.snapshot();
    expect(state.hero.name).toBe("Peter Parker");
    expect(state.heroActions.find((action) => action.kind === "changeForm")?.label).toBe("Change to Spider-Man");
  });

  test("is Captain Marvel with her Leadership starter deck when chosen, against any villain", () => {
    for (const villain of ["rhino", "klaw", "ultron"] as const) {
      const battle = new BattleModel();
      battle.reset({ hero: "captain-marvel", villain, seed: 7, mulligan: true });
      expect(battle.matchup).toEqual({ hero: "captain-marvel", villain });
      const state = battle.snapshot();
      expect(state.hero.name).toBe("Carol Danvers");
      // Her deck: her own cards, Leadership and basic, and none of Spider-Man's.
      const names = new Set([...state.hand.map((card) => card.name)]);
      expect([...names].some((name) => /Web|Spider|Black Cat|Aunt May/.test(name))).toBe(false);
      expect(battle.pictures().length).toBeGreaterThan(40);
    }
  });

  test("names her other face on the change of form, both ways", () => {
    const battle = new BattleModel();
    battle.reset({ hero: "captain-marvel", seed: 7 });
    const label = () => battle.snapshot().heroActions.find((action) => action.kind === "changeForm")?.label;
    expect(label()).toBe("Change to Captain Marvel");
    battle.heroAction("changeForm");
    expect(battle.snapshot().hero.name).toBe("Captain Marvel");
    battle.endTurn();
    while (battle.snapshot().choice) {
      const choice = battle.snapshot().choice!;
      battle.chooseMany(choice.options.slice(0, choice.min).map((option) => option.id));
    }
    expect(battle.snapshot().turn).toBe("player");
    expect(label()).toBe("Change to Carol Danvers");
  });
});

describe("the difficulty and modules the deal takes", () => {
  /** The engine state the deal opens on, and the encounter sets of every card in it. */
  function dealt(options: Parameters<BattleModel["reset"]>[0]) {
    let opening: engine.GameState | null = null;
    const battle = new BattleModel();
    battle.reset({
      ...options,
      arrange: (state) => {
        opening = state;
        return state;
      },
    });
    const state = opening! as engine.GameState;
    const sets = new Set(
      Object.keys(state.instances).flatMap((id) => {
        const card = engine.cardOf(state, id as engine.InstanceId);
        return card && "encounterSetIds" in card ? (card.encounterSetIds as readonly string[]) : [];
      }),
    );
    return { battle, state, sets };
  }

  test("is Standard with the villain's recommended module unless chosen otherwise, exactly as before", () => {
    for (const [villain, module] of [
      ["rhino", "bomb_scare"],
      ["klaw", "masters_of_evil"],
      ["ultron", "under_attack"],
    ] as const) {
      const plain = dealt({ villain, seed: 41 });
      const spelt = dealt({ villain, seed: 41, difficulty: "standard", modules: [module] });
      expect(plain.state).toEqual(spelt.state);
      expect(plain.battle.encounter).toEqual({ difficulty: "standard", modules: [module] });
      expect(plain.state.villains[0]!.stageIndex).toBe(0);
      expect(plain.sets.has("expert")).toBe(false);
      expect(plain.sets.has(module)).toBe(true);
    }
  });

  test("Expert starts the villain at stage II, ends at III, and adds the Expert set", () => {
    for (const villain of ["rhino", "klaw", "ultron"] as const) {
      const { battle, state, sets } = dealt({ villain, seed: 41, difficulty: "expert" });
      expect(state.villains[0]!.stageIndex).toBe(1);
      expect(state.villains[0]!.lastStageIndex).toBe(2);
      expect(sets.has("expert")).toBe(true);
      expect(battle.encounter.difficulty).toBe("expert");
      expect(battle.snapshot().villain.name).toBe(VILLAINS.find((each) => each.id === villain)!.name);
    }
  });

  test("a chosen module replaces the recommended one", () => {
    for (const module of ["legions_of_hydra", "the_doomsday_chair"] as const) {
      const { battle, sets } = dealt({ villain: "klaw", seed: 41, difficulty: "expert", modules: [module] });
      expect(sets.has(module)).toBe(true);
      expect(sets.has("masters_of_evil")).toBe(false);
      expect(battle.encounter).toEqual({ difficulty: "expert", modules: [module] });
    }
  });

  test("every module is a Core Set module, and every villain's recommended one is among them", () => {
    expect(MODULES.map((module) => module.id)).toEqual([
      "bomb_scare",
      "masters_of_evil",
      "under_attack",
      "legions_of_hydra",
      "the_doomsday_chair",
    ]);
    for (const villain of VILLAINS) expect(isModuleId(recommendedModule(villain.id))).toBe(true);
    expect(isModuleId("expert")).toBe(false);
  });
});

describe("Guard (Adam, 2026-11-25: the attack went straight to the guard minion and the player didn't know why)", () => {
  test("attacking with a guard minion engaged asks whom, says why the villain is out of reach, and attacks the minion", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("guard")! });
    const before = battle.snapshot();
    const mercenary = before.enemyCards.find((card) => card.name === "Hydra Mercenary")!;
    expect(mercenary.guard).toBe(true);
    expect(before.villain.guard).toBeUndefined();

    expect(battle.heroAction("basicAttack")).toBe(true);
    const asked = battle.snapshot().choice!;
    expect(asked.prompt).toBe("Choose an enemy to attack");
    expect(asked.options.map((option) => option.cardId)).toEqual([mercenary.id]);
    expect(asked.guard).toEqual({ blocked: [before.villain.id], guards: [mercenary.id] });
    expect(asked.explanation).toBe("Hydra Mercenary has Guard: Rhino can't be attacked until it is defeated.");
    expect(asked.canCancel).toBe(true);

    // The villain is no answer; the minion is.
    expect(battle.choose(before.villain.id)).toBe(false);
    expect(battle.choose(mercenary.id)).toBe(true);
    const after = battle.snapshot();
    expect(after.choice).toBeNull();
    expect(after.enemyCards.find((card) => card.id === mercenary.id)?.hp ?? 0).toBeLessThan(mercenary.hp!);
  });

  test("an attack with no guard minion engaged and only the villain to hit still goes straight in", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("klawstage")! });
    expect(battle.snapshot().enemyCards.some((card) => card.type === "minion")).toBe(false);
    expect(battle.heroAction("basicAttack")).toBe(true);
    expect(battle.snapshot().choice?.guard).toBeUndefined();
    expect(battle.snapshot().choice?.prompt).not.toBe("Choose an enemy to attack");
  });
});

describe("Searching a deck (Adam, 2026-11-25: Masters of Mayhem listed names, and the cards couldn't be read)", () => {
  test("a search's cards come with their faces and the pile each is in", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, villain: "klaw", arrange: arrangeScene("klawsearch")! });
    expect(battle.endTurn()).toBe(true);
    // Answer everything before Masters of Mayhem's search: discard down, pass Spider-Sense, don't defend.
    for (let i = 0; i < 12 && !battle.snapshot().choice?.searched; i++) {
      const choice = battle.snapshot().choice;
      if (!choice) break;
      if (choice.offers?.length) battle.chooseMany([]);
      else if (choice.discardFromHand) battle.chooseMany(choice.options.slice(0, choice.min).map((o) => o.id));
      else battle.choose(choice.options.find((o) => !o.cardId)?.id ?? null);
    }
    const choice = battle.snapshot().choice!;
    expect(choice.searched?.map((found) => found.card.name).sort()).toEqual([
      "Melter",
      "Radioactive Man",
      "Tiger Shark",
      "Whirlwind",
    ]);
    for (const found of choice.searched!) {
      expect(found.from).toMatch(/^Encounter (deck|discard pile)$/);
      expect(found.card.art).not.toBe("");
      expect(choice.options.some((option) => option.cardId === found.id)).toBe(true);
    }
    const melter = choice.searched!.find((found) => found.card.name === "Melter")!;
    expect(battle.choose(choice.options.find((option) => option.cardId === melter.id)!.id)).toBe(true);
    expect(battle.snapshot().enemyCards.some((card) => card.name === "Melter")).toBe(true);
  });

  test("a question about cards on the table has no searched cards", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("guard")! });
    battle.heroAction("basicAttack");
    expect(battle.snapshot().choice?.searched).toBeUndefined();
  });
});
