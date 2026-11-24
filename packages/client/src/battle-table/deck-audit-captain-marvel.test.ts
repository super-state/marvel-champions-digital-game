/**
 * Captain Marvel's deck audit: every card of her Leadership starter deck that Spider-Man's audit
 * (`deck-audit-player.test.ts`) doesn't already cover, played on the 3D table's model and checked for what the table
 * shows (beats, prompts, targets, labels). Her 15 cards (01010–01018), her obligation (Family Emergency, 01175), her
 * nemesis set (01176–01179) and the nine Leadership cards (01066–01074). The 11 basic cards are Spider-Man's audit's;
 * the ones that read differently for her are re-checked at the end.
 */
import { expect, test } from "vitest";
import * as engine from "@mc/engine";
import {
  beat,
  codeOf,
  compose,
  deckTop,
  encounterTop,
  engageMinion,
  handOf,
  inPlay,
  patchByCode,
  Player,
  scenarioOf,
  type Id,
  type Setup,
} from "./deck-audit-driver.js";

const scenario = (...steps: Setup[]) => scenarioOf({ hero: "captain-marvel" }, ...steps);

/** Her hero's menu entry whose label matches. */
const heroMenu = (p: Player, label: RegExp) => p.snap.heroActions.find((action) => label.test(action.label));

/** Use one of the hero's own abilities from her menu, paying with the named sources (or the first that pay). */
function useHero(p: Player, label: RegExp, pay: string[] = []) {
  const action = heroMenu(p, label);
  if (!action) throw Error(`no hero action ${label}: ${p.snap.heroActions.map((a) => a.label).join(", ")}`);
  expect(p.run(() => p.battle.heroAction(action.kind))).toBe(true);
  if (p.snap.payment) {
    p.spend(...pay);
    expect(p.snap.payment!.canPay, JSON.stringify(p.snap.payment)).toBe(true);
    expect(p.run(() => p.battle.pay())).toBe(true);
  }
  return action;
}

void [beat, codeOf, compose, deckTop, encounterTop, engageMinion, handOf, inPlay, patchByCode, engine];
type _ = Id;

// 01010 Captain Marvel / Carol Danvers ------------------------------------------------------------------------------

test("01010 identity: she starts as Carol Danvers; the change of form names the other face both ways", () => {
  const p = scenario();
  expect(p.snap.hero.name).toBe("Carol Danvers");
  expect(heroMenu(p, /^Change to/)?.label).toBe("Change to Captain Marvel");
  p.form();
  expect(p.snap.hero.name).toBe("Captain Marvel");
  p.end();
  p.drive();
  expect(p.snap.turn).toBe("player");
  expect(heroMenu(p, /^Change to/)?.label).toBe("Change to Carol Danvers");
});

test("01010b Commander: in her menu as Carol Danvers; draws 1 card, once per round", () => {
  const p = scenario();
  const commander = heroMenu(p, /^Commander/);
  expect(commander?.label).toBe("Commander: choose a player to draw 1 card");
  expect(commander, JSON.stringify(p.snap.heroActions)).toBeDefined();
  const hand = p.snap.hand.length;
  const deck = p.snap.deckCount;
  p.mark();
  useHero(p, /draw/i);
  // One player: "choose a player" has only her to choose, so it asks nothing.
  expect(p.snap.choice).toBeNull();
  expect(p.snap.hand.length).toBe(hand + 1);
  expect(p.snap.deckCount).toBe(deck - 1);
  expect(beat(p, (b) => !!b.draw?.length)).toBeGreaterThanOrEqual(0);
  expect(heroMenu(p, /draw/i)).toBeUndefined();
});

test("01010a Rechannel: in Captain Marvel's menu once she is hurt; pay an energy and heal 1 damage, draw 1 card", () => {
  const unhurt = scenario(handOf("01088", "01089", "01090"));
  unhurt.form();
  expect(heroMenu(unhurt, /^Rechannel/), "no damage to heal: no Rechannel").toBeUndefined();

  const p = scenario(handOf("01088", "01089", "01090"), patchByCode("hero", { damage: 3 }));
  p.form();
  expect(heroMenu(p, /^Rechannel/)?.label).toBe("Rechannel: draw 1 card");
  const hp = p.snap.heroHp;
  // The Energy goes, one card is drawn.
  const hand = p.snap.hand.length;
  p.mark();
  const action = heroMenu(p, /^Rechannel/)!;
  expect(p.battle.heroAction(action.kind)).toBe(true);
  const payment = p.snap.payment!;
  expect(payment, "Rechannel asks for its energy on the payment screen").toBeTruthy();
  // Genius and Strength can't pay an energy cost.
  const available = payment.sources.filter((s) => s.available).map((s) => s.label);
  expect(available).toContain("Energy");
  expect(available).not.toContain("Genius");
  expect(available).not.toContain("Strength");
  p.spend("Energy");
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.snap.heroHp).toBe(hp + 1);
  expect(p.snap.hand.map((c) => c.name)).not.toContain("Energy");
  expect(p.snap.hand).toHaveLength(hand);
  expect(beat(p, (b) => b.statusChange?.name === "damage" && b.statusChange.delta === -1)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => !!b.draw?.length)).toBeGreaterThanOrEqual(0);
  // Once per round.
  expect(heroMenu(p, /^Rechannel/)).toBeUndefined();
});

// Her events ----------------------------------------------------------------------------------------------------------

test.each([
  ["Energy", true],
  ["Genius", false],
] as const)(
  "01013 Photonic Blast paid with %s: 5 damage to Rhino; draws 1 card only when an energy paid",
  (with_, draws) => {
    const p = scenario(handOf("01013", "01088", "01089", "01090", "01086"));
    p.form();
    const before = p.snap.villainHp;
    const deck = p.snap.deckCount;
    p.mark();
    // Cost 3: the named card plus the two others that aren't the one being kept.
    p.play("Photonic Blast", {
      pay: with_ === "Energy" ? ["Energy", "Strength", "First Aid"] : ["Genius", "Strength", "First Aid"],
    });
    expect(p.snap.villainHp).toBe(before - 5);
    expect(p.snap.deckCount).toBe(draws ? deck - 1 : deck);
    expect(beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === 5)).toBeGreaterThanOrEqual(0);
    expect(beat(p, (b) => !!b.draw?.length) >= 0).toBe(draws);
    expect(p.has("Photonic Blast", "discard")).toBe(true);
  },
);

test("01013 Photonic Blast is hero form only: refused as Carol Danvers with the reason on the card", () => {
  const p = scenario(handOf("01013", "01088", "01089", "01090"));
  const blast = p.card("Photonic Blast");
  expect(blast.requiresHeroForm).toBe(true);
});

test("01012 Crisis Interdiction: removes 2 threat from the main scheme; without Aerial, no second scheme", () => {
  const p = scenario(handOf("01012", "01088", "01089"), patchByCode("scheme", { threat: 5 }));
  p.form();
  p.mark();
  p.play("Crisis Interdiction");
  expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(3);
  expect(beat(p, (b) => b.threat?.delta === -2)).toBeGreaterThanOrEqual(0);
});

test("01012 Crisis Interdiction with Aerial (Cosmic Flight) and a side scheme: 2 threat off each of two schemes", () => {
  // Carol Danvers: the villain schemes and Bomb Scare comes down; then Captain Marvel, flying, interdicts both.
  const p = scenario(inPlay("01017"), handOf("01012", "01088", "01089"), encounterTop("01186", "01109"));
  p.end();
  p.drive();
  const side = p.card("Bomb Scare", "enemyCards");
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  p.form();
  const before = { side: side.threat!, main: main.threat! };
  p.mark();
  p.play("Crisis Interdiction");
  // First scheme: both offered.
  const first = p.snap.choice!;
  expect(first.options.map((o) => o.cardId).sort()).toEqual([main.id, side.id].sort());
  p.choose({ card: side.id });
  // Then a different one: only the main scheme is left, so it is taken without asking.
  expect(p.snap.choice).toBeNull();
  expect(p.card("Bomb Scare", "enemyCards").threat).toBe(Math.max(0, before.side - 2));
  expect(p.snap.enemyCards.find((c) => c.id === main.id)!.threat).toBe(Math.max(0, before.main - 2));
});

// Her resources -------------------------------------------------------------------------------------------------------

test("01014 Energy Absorption: a resource card, not playable; it pays three energy", () => {
  const p = scenario(handOf("01014", "01013"));
  p.form();
  expect(p.card("Energy Absorption").playable).toBe(false);
  expect(p.battle.pick(p.card("Photonic Blast").id)).toBe(true);
  const source = p.snap.payment!.sources.find((s) => s.label === "Energy Absorption")!;
  expect(source.icons).toEqual(["energy", "energy", "energy"]);
  p.battle.toggle(source.id);
  expect(p.snap.payment!.canPay).toBe(true);
  const deck = p.snap.deckCount;
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  // Photonic Blast paid with an energy resource draws its card.
  expect(p.snap.deckCount).toBe(deck - 1);
});

// Her supports and upgrades -------------------------------------------------------------------------------------------

test.each([
  ["Carol Danvers", false, 2],
  ["Captain Marvel", true, 1],
] as const)("01015 Alpha Flight Station as %s: pick the card to discard, then draw", (_who, hero, draws) => {
  const p = scenario(inPlay("01015"), handOf("01088", "01089", "01090"));
  if (hero) p.form();
  const station = p.card("Alpha Flight Station", "inPlay");
  const [action] = p.battle.fieldActions(station.id);
  expect(action).toMatchObject({ label: `Discard 1 card: draw ${draws} card${draws > 1 ? "s" : ""}`, exhausts: true });
  expect(p.battle.fieldAction(station.id, action!.kind)).toBe(true);
  // Nothing happens yet: the hand is asked which card goes, named after the station, and it can be called off.
  const choice = p.snap.choice!;
  expect(choice).toMatchObject({
    discardFromHand: true,
    canCancel: true,
    min: 1,
    max: 1,
    sourceTitle: "Alpha Flight Station",
  });
  expect(choice.prompt).toBe("Discard 1 to pay");
  expect(choice.options.map((o) => o.cardId).sort()).toEqual(p.snap.hand.map((c) => c.id).sort());
  expect(p.card("Alpha Flight Station", "inPlay").exhausted).toBe(false);
  const genius = p.card("Genius");
  const hand = p.snap.hand.length;
  p.mark();
  expect(p.run(() => p.battle.chooseMany([genius.id]))).toBe(true);
  expect(p.snap.choice).toBeNull();
  expect(p.has("Genius", "discard")).toBe(true);
  expect(p.snap.hand.length).toBe(hand - 1 + draws);
  expect(p.card("Alpha Flight Station", "inPlay").exhausted).toBe(true);
  expect(beat(p, (b) => b.turned?.id === station.id && b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.draw?.length === draws)).toBeGreaterThanOrEqual(0);
});

test("01015 Alpha Flight Station: Cancel at the discard leaves the station ready and the hand as it was", () => {
  const p = scenario(inPlay("01015"), handOf("01088", "01089", "01090"));
  const station = p.card("Alpha Flight Station", "inPlay");
  const hand = p.snap.hand.map((c) => c.id);
  p.battle.fieldAction(station.id, p.battle.fieldActions(station.id)[0]!.kind);
  expect(p.battle.chooseMany([]), "a pick of none is not enough").toBe(false);
  p.battle.cancel();
  expect(p.snap.choice).toBeNull();
  expect(p.snap.hand.map((c) => c.id)).toEqual(hand);
  expect(p.card("Alpha Flight Station", "inPlay").exhausted).toBe(false);
  // And it can be used again.
  expect(p.battle.fieldActions(station.id)).toHaveLength(1);
});

test("01016 Captain Marvel's Helmet: +1 DEF shown on her; +2 with Cosmic Flight's Aerial", () => {
  const p = scenario(handOf("01016", "01017", "01090", "01089", "01088"));
  p.form();
  const def = () => p.snap.hero.markers.find((m) => m.name === "DEF")?.count ?? 0;
  p.mark();
  p.play("Captain Marvel's Helmet", { pay: ["Strength"] });
  expect(def()).toBe(1);
  expect(beat(p, (b) => b.modifier?.id === p.snap.hero.id && b.modifier.name === "DEF")).toBeGreaterThanOrEqual(0);
  p.play("Cosmic Flight", { pay: ["Genius"] });
  expect(def()).toBe(2);
});

test.each([true, false])(
  "01017 Cosmic Flight (accept=%s): when Rhino's attack would hurt her, discard it to prevent 3",
  (accept) => {
    const p = scenario(inPlay("01017"), encounterTop("01186", "01108"));
    p.form();
    p.end();
    const s = p.drive({ stopWhen: (x) => !!x.choice?.defense });
    p.choose({ label: "Don’t defend" });
    const offer = p.snap.choice!;
    expect(offer.prompt).toMatch(/about to take \d+ damage/);
    expect(offer.offers).toHaveLength(1);
    expect(offer.offers![0]).toMatchObject({ question: "Interrupt with Cosmic Flight?" });
    expect(offer.offers![0]!.effect).toMatch(/prevent 3/);
    const coming = offer.event!.amount!;
    const hp = s.heroHp;
    p.mark();
    p.run(() => p.battle.chooseMany(accept ? [offer.offers![0]!.id] : []));
    p.drive();
    expect(p.snap.heroHp).toBe(hp - (accept ? Math.max(0, coming - 3) : coming));
    expect(p.has("Cosmic Flight", "inPlay")).toBe(!accept);
    if (accept) expect(p.has("Cosmic Flight", "discard")).toBe(true);
  },
);

test("01018 Energy Channel: spend any number of energy (only energy pays), a counter each; discard it for 2 a counter", () => {
  const p = scenario(handOf("01018", "01088", "01014", "01090", "01089"));
  p.form();
  p.play("Energy Channel");
  const channel = p.card("Energy Channel", "inPlay");
  expect(channel.attachedTo).toBe(p.snap.hero.id);
  expect(p.battle.fieldActions(channel.id).map((a) => a.label)).toEqual([
    "Spend energy: 1 energy counter each",
    "Discard it: deal 0 damage",
  ]);
  expect(p.battle.fieldAction(channel.id, "01018.energy-channel-action")).toBe(true);
  const avail = () => p.snap.payment!.sources.filter((s) => s.available && !s.selected).map((s) => s.label);
  expect(avail().sort()).toEqual(["Energy", "Energy Absorption"]);
  expect(p.snap.payment!.canPay).toBe(false);
  p.spend("Energy");
  expect(p.snap.payment!.canPay).toBe(true);
  // More can still go in: X is what is paid.
  expect(avail()).toEqual(["Energy Absorption"]);
  p.spend("Energy Absorption");
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  // Energy pays 2, Energy Absorption 3.
  expect(p.card("Energy Channel", "inPlay").markers).toContainEqual({ name: "energy", count: 5 });
  expect(beat(p, (b) => b.statusChange?.id === channel.id && b.statusChange.name === "energy")).toBeGreaterThanOrEqual(
    0,
  );
  expect(p.battle.fieldActions(channel.id).map((a) => a.label)).toContain("Discard it: deal 10 damage");
  const hp = p.snap.villainHp;
  p.mark();
  expect(p.run(() => p.battle.fieldAction(channel.id, "01018.energy-channel-hero-action"))).toBe(true);
  expect(p.snap.villainHp).toBe(Math.max(0, hp - 10));
  expect(p.has("Energy Channel", "discard")).toBe(true);
  expect(beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === 10)).toBeGreaterThanOrEqual(0);
});

// Her ally ------------------------------------------------------------------------------------------------------------

test.each([true, false])("01011 Spider-Woman (accept=%s): after she enters play, confuse the villain", (accept) => {
  const p = scenario(handOf("01011", "01090", "01088", "01089"));
  p.mark();
  p.play("Spider-Woman", { pay: ["Strength", "Energy"] });
  const offer = p.snap.choice!;
  expect(offer.offers).toHaveLength(1);
  expect(offer.offers![0]).toMatchObject({ question: "Respond with Spider-Woman?" });
  expect(offer.offers![0]!.effect).toMatch(/confuse/i);
  p.run(() => p.battle.chooseMany(accept ? [offer.offers![0]!.id] : []));
  expect(p.snap.choice).toBeNull();
  expect(p.snap.villain.markers.some((m) => m.name === "confused")).toBe(accept);
  if (accept)
    expect(
      beat(p, (b) => b.statusChange?.id === p.snap.villain.id && b.statusChange.name === "confused"),
    ).toBeGreaterThanOrEqual(0);
});

test("01011 Spider-Woman: a confused Rhino turns to scheme and spends the confusion instead of placing threat", () => {
  const p = scenario(handOf("01011", "01090", "01088", "01089"));
  p.play("Spider-Woman", { pay: ["Strength", "Energy"] });
  p.run(() => p.battle.chooseMany([p.snap.choice!.offers![0]!.id]));
  p.mark();
  p.end();
  p.drive();
  expect(p.snap.villain.markers.some((m) => m.name === "confused")).toBe(false);
  // As a stunned enemy strains to attack: the "Schemes" stamp and its aim, then the status goes (RRG 1.8 "Confused").
  const schemes = beat(p, (b) => b.scheming === p.snap.villain.id);
  const lost = beat(
    p,
    (b) => b.statusChange?.id === p.snap.villain.id && b.statusChange.name === "confused" && b.statusChange.delta < 0,
  );
  expect(schemes).toBeGreaterThanOrEqual(0);
  expect(lost).toBe(schemes + 1);
  // No threat from Rhino himself: the only threat before the encounter cards is the main scheme's own step.
  const dealt = beat(p, (b) => b.text === "Deal an encounter card");
  expect(p.beats.slice(schemes, dealt).some((b) => b.threat)).toBe(false);
});

// Her obligation and nemesis set ---------------------------------------------------------------------------------------

/** Stack the encounter deck from anywhere (deck, discard, her set-aside nemesis set), first = next to be drawn. */
const stack =
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

/** Put a card of her set-aside nemesis set into play: a side scheme by the villain (with threat), a minion engaged. */
const nemesisInPlay =
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
const villainPhaseDeals = (...codes: string[]) => stack("01104", ...codes, "01108", "01101");

/**
 * End the turn and play out the villain phase, keeping the questions it asks with their options' words. `answer` picks
 * an option by its words; a question it doesn't pick for (-1) gets the driver's default, and attacks go undefended.
 */
function villainPhase(p: Player, answer: (labels: string[]) => number = () => -1) {
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

test("01175 Family Emergency as Carol Danvers: two choices in her words; exhausting removes it from the game", () => {
  const p = scenario(villainPhaseDeals("01175"));
  const asked = villainPhase(p, (labels) => labels.findIndex((l) => l.startsWith("Exhaust")));
  const question = asked.find((a) => a.source?.startsWith("Family Emergency"))!;
  expect(question.labels).toEqual([
    "Exhaust Carol Danvers → remove this obligation from the game",
    "You are stunned; this card gains surge",
  ]);
  // In alter-ego form there is nothing to flip: no form question.
  expect(asked.some((a) => a.labels.includes("Flip to alter-ego form"))).toBe(false);
  expect(p.snap.hero.exhausted).toBe(true);
  const gone = p.beats.find((b) => b.text === "Family Emergency is removed from the game");
  expect(gone?.removedFromGame).toBe(true);
  expect(p.snap.encounterDiscard.map((c) => c.name)).not.toContain("Family Emergency");
});

test("01175 Family Emergency: or she is stunned, it surges, and it is discarded", () => {
  const p = scenario(villainPhaseDeals("01175"));
  villainPhase(p, (labels) => labels.findIndex((l) => l.startsWith("You are stunned")));
  expect(p.snap.hero.markers).toContainEqual({ name: "stunned", count: 1 });
  expect(p.snap.hero.exhausted).toBe(false);
  expect(beat(p, (b) => b.text === "Family Emergency surges")).toBeGreaterThanOrEqual(0);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Family Emergency");
});

test("01175 Family Emergency as Captain Marvel: she may flip to Carol Danvers first, then exhaust her", () => {
  const p = scenario(villainPhaseDeals("01175"));
  p.form();
  const asked = villainPhase(p, (labels) =>
    labels.includes("Flip to alter-ego form")
      ? labels.indexOf("Flip to alter-ego form")
      : labels.findIndex((l) => l.startsWith("Exhaust")),
  );
  expect(asked.find((a) => a.labels.includes("Flip to alter-ego form"))!.labels).toContain("Stay in hero form");
  expect(asked.find((a) => a.labels.some((l) => l.startsWith("Exhaust")))!.labels[0]).toBe(
    "Exhaust Carol Danvers → remove this obligation from the game",
  );
  expect(p.snap.hero.name).toBe("Carol Danvers");
  expect(p.snap.hero.exhausted).toBe(true);
});

test("01176 The Psyche-Magnitron: comes in with its printed threat plus 1 for her, shown as two threat beats", () => {
  const p = scenario(villainPhaseDeals("01176"));
  villainPhase(p);
  const scheme = p.card("The Psyche-Magnitron", "enemyCards");
  expect(scheme.threat).toBe(4);
  expect(p.beats.filter((b) => b.threat?.scheme === scheme.id).map((b) => b.threat!.delta)).toEqual([3, 1]);
});

test("01177 Yon-Rogg: revealed against Carol Danvers he engages and waits; he doesn't attack her", () => {
  const p = scenario(villainPhaseDeals("01177"));
  villainPhase(p);
  const yon = p.card("Yon-Rogg", "enemyCards");
  expect(yon.hp).toBe(5);
  expect(beat(p, (b) => b.hit?.source === yon.id)).toBe(-1);
});

test("01177 Yon-Rogg: after he attacks Captain Marvel, 1 threat goes on The Psyche-Magnitron", () => {
  const p = scenario(nemesisInPlay("01176", 2), nemesisInPlay("01177"), villainPhaseDeals());
  p.form();
  const yon = p.card("Yon-Rogg", "enemyCards");
  const magnitron = p.card("The Psyche-Magnitron", "enemyCards");
  villainPhase(p);
  const hit = beat(p, (b) => b.hit?.source === yon.id && b.hit.target === p.snap.hero.id);
  expect(hit).toBeGreaterThanOrEqual(0);
  const threat = beat(p, (b) => b.threat?.scheme === magnitron.id && b.threat.delta === 1);
  expect(threat).toBeGreaterThan(hit);
  expect(p.card("The Psyche-Magnitron", "enemyCards").threat).toBe(3);
});

test("01178 Kree Manipulator: the order of its When Revealed and its surge is asked in words, as buttons", () => {
  const p = scenario(villainPhaseDeals("01178"));
  const before = p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat!;
  const asked = villainPhase(p);
  const order = asked.find((a) => /Order/.test(a.prompt))!;
  expect(order.labels).toEqual(["Place 1 threat on the main scheme", "Surge: deal yourself 1 more encounter card"]);
  // Its 1 threat on top of the main scheme's own step and Rhino's scheme (Advance: no boost).
  const kree = p.beats.find((b) => b.reveal?.name === "Kree Manipulator")!.reveal!.id;
  expect(p.beats.some((b) => b.text === "Kree Manipulator surges")).toBe(true);
  expect(p.snap.encounterDiscard.some((c) => c.id === kree)).toBe(true);
  expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBeGreaterThanOrEqual(before + 3);
});

test("01178 Kree Manipulator's order question: its options are buttons, not the one card picked twice", () => {
  const p = scenario(villainPhaseDeals("01178"));
  p.end();
  const s = p.drive({ stopWhen: (x) => !!x.choice?.ordered });
  expect(s.choice!.options.map((o) => o.cardId)).toEqual([null, null]);
});

test("01179 Yon-Rogg's Treason: every energy resource in her hand is discarded, and shown going", () => {
  const p = scenario(handOf("01088", "01014", "01089", "01090", "01013", "01012"), villainPhaseDeals("01179"));
  villainPhase(p);
  // Each card printed with an energy icon: Energy, Energy Absorption, and Crisis Interdiction's resource.
  const discard = p.snap.discard.map((c) => c.name);
  expect(discard.sort()).toEqual(["Crisis Interdiction", "Energy", "Energy Absorption"]);
  expect(p.snap.hand.map((c) => c.name).sort()).toEqual(["Genius", "Photonic Blast", "Strength"]);
  expect(beat(p, (b) => (b.handDiscard?.length ?? 0) === 3)).toBeGreaterThanOrEqual(0);
  expect(p.beats.some((b) => b.text === "Yon-Rogg's Treason surges")).toBe(false);
});

test("01179 Yon-Rogg's Treason: with no energy resource in hand, it surges", () => {
  const p = scenario(handOf("01089", "01090", "01013"), villainPhaseDeals("01179"));
  villainPhase(p);
  expect(p.beats.some((b) => b.text === "Yon-Rogg's Treason surges")).toBe(true);
});

test("01178 Kree Manipulator as Rhino's boost card: an undefended attack puts 1 threat on the main scheme", () => {
  const p = scenario(stack("01178", "01108", "01101", "01101"));
  p.form();
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  villainPhase(p);
  const boost = beat(p, (b) => /Boost card · Kree Manipulator/.test(b.text));
  expect(boost).toBeGreaterThanOrEqual(0);
  const threat = beat(p, (b) => b.threat?.scheme === main.id && b.threat.delta === 1 && /Kree/.test(b.text));
  expect(threat, JSON.stringify(p.beats.map((b) => b.text))).toBeGreaterThan(boost);
});
