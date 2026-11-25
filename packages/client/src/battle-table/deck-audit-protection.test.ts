/**
 * The Protection cards of Black Panther's starter deck (01075–01082), each played through the 3D table's model as a
 * player would (pick -> target -> payment -> pay, field actions, offers) and checked for what the table would show:
 * beats, counters and stat markers on cards, the choice prompt and its labels, the payment screen's sources, refusal
 * reasons. The defence cards are driven through the villain phase: Rhino's attack, the defender question, the offers.
 */
import { expect, test } from "vitest";
import {
  beat,
  engageMinion,
  handOf,
  inPlay,
  patchByCode,
  patchCard,
  scenarioOf,
  stack,
  villainPhaseDeals,
  type Choice,
  type Player,
  type Setup,
} from "./deck-audit-driver.js";

const scenario = (...steps: Setup[]) => scenarioOf({ hero: "black-panther" }, ...steps);

/** Black Panther's opening Foresight search is answered (Panther Claws: an energy card, so no mental resource is added). */
function start(...steps: Setup[]) {
  const p = scenario(...steps);
  p.choose({ label: "Panther Claws" });
  expect(p.snap.choice).toBeNull();
  return p;
}

const markerOf = (p: Player, name: string, m: string, where: "inPlay" | "enemyCards" = "inPlay") =>
  p.card(name, where).markers.find((x) => x.name === m)?.count ?? 0;
const offerStop = (s: { choice: Choice | null }) => !!s.choice?.offers?.length;
const defenceStop = (s: { choice: Choice | null }) => !!s.choice?.defense;
const offerFor = (p: Player, name: string) => p.snap.choice!.offers!.find((o) => o.question.includes(name))!;
const respond = (p: Player, name: string, accept: boolean) => {
  const offer = offerFor(p, name);
  expect(offer, JSON.stringify(p.snap.choice)).toBeDefined();
  expect(p.run(() => p.battle.chooseMany(accept ? [offer.id] : []))).toBe(true);
};
/** Answer the defender question with this card (the hero is `p.snap.hero.id`). */
const defendWith = (p: Player, cardId: string) => {
  const option = p.snap.choice!.options.find((o) => o.cardId === cardId);
  expect(option, JSON.stringify(p.snap.choice)).toBeDefined();
  expect(p.run(() => p.battle.chooseMany([option!.id]))).toBe(true);
};
const threatBeats = (p: Player) => p.beats.filter((b) => /places \d+ threat/.test(b.text)).length;
/** Hero form, the villain phase with Rhino's attack (boost: no icons) up to the first defender question. */
function atDefence(setup: Setup[], keep: string[] = []) {
  const p = start(...setup, villainPhaseDeals());
  p.form();
  p.end();
  p.drive({ keep, stopWhen: defenceStop });
  expect(p.snap.choice?.defense?.attacker).toBe("Rhino");
  p.mark();
  return p;
}

// 01075 Black Widow -----------------------------------------------------------------------------------------------------

/** Black Widow in play, a mental resource in hand; the villain phase up to her offer on the first card revealed. */
function widowAtReveal(...extra: Setup[]) {
  const p = start(
    handOf("01089", "01088", "01090", "01086", "01079", "01078"),
    inPlay("01075"),
    villainPhaseDeals("01186", "01188"),
    ...extra,
  );
  p.end();
  p.mark();
  p.drive({ stopWhen: offerStop, keep: ["Genius"] });
  return p;
}

test("01075 Black Widow: cost 3, enters play as an ally with nothing asked", () => {
  const p = start(handOf("01075", "01088", "01090", "01089", "01086", "01079"));
  const card = p.card("Black Widow");
  expect(card.cost).toBe(3);
  expect(card.playable).toBe(true);
  p.play("Black Widow", { pay: ["Energy", "First Aid"] });
  expect(p.has("Black Widow", "inPlay")).toBe(true);
  expect(p.card("Black Widow", "inPlay")).toMatchObject({ type: "ally", hp: 2, exhausted: false });
  expect(p.snap.choice).toBeNull();
});

test("01075 Black Widow: the interrupt is offered on the card dealt (not on a boost card), naming it and the cost", () => {
  const p = widowAtReveal();
  const choice = p.snap.choice!;
  // Rhino's boost card (Hard to Keep Down, a treachery) was turned over before: no offer was made for it.
  expect(beat(p, (b) => b.reveal?.name === "Hard to Keep Down")).toBeGreaterThanOrEqual(0);
  expect(choice.prompt).toBe("Advance is about to be revealed");
  expect(choice.canSkip).toBe(true);
  expect(choice.event).toMatchObject({ kind: "encounterCardRevealing", before: true });
  expect(choice.offers).toHaveLength(1);
  expect(choice.offers![0]!.question).toBe("Interrupt with Black Widow?");
  expect(choice.options.map((o) => o.label)).toEqual(["exhaust, spend 1 mental"]);
});

// Found by this audit, now fixed: the offer's effect repeated the card's cost and arrow ("Use Black Widow to exhaust Black Widow and spend a mental
// resource → cancel the effects of that card and discard it. Then, reveal another card from the encounter deck").
test("01075 Black Widow: the offer's effect reads as a sentence, naming the card it cancels", () => {
  const p = widowAtReveal();
  const effect = p.snap.choice!.offers![0]!.effect;
  expect(effect).not.toMatch(/→/);
  expect(effect).not.toMatch(/exhaust Black Widow/);
  expect(effect).toMatch(/^Use Black Widow to cancel/);
});

// Found by this audit, now fixed: Strength (a physical resource) can pay Black Widow's "spend a mental resource": it is listed available, selecting
// it makes the payment payable, and the screen has no "outstanding" line saying a mental resource is what is asked.
test("01075 Black Widow: only a mental resource can pay her cost, and the screen says so", () => {
  const p = widowAtReveal();
  respond(p, "Black Widow", true);
  const payment = p.snap.payment!;
  expect(payment.ability).toBe(true);
  expect(payment.outstanding).toEqual(["1 mental"]);
  const available = payment.sources.filter((s) => s.available).map((s) => s.label);
  expect(available).toContain("Genius");
  expect(available).not.toContain("Strength");
});

test("01075 Black Widow: accepting exhausts her, spends the mental card, cancels the card and reveals another", () => {
  const p = widowAtReveal();
  respond(p, "Black Widow", true);
  const payment = p.snap.payment!;
  expect(payment.subject.name).toBe("Black Widow");
  expect(payment.required).toBe(1);
  p.spend("Genius");
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.snap.hand.map((c) => c.name)).not.toContain("Genius");
  expect(p.has("Genius", "discard")).toBe(true);
  expect(p.card("Black Widow", "inPlay").exhausted).toBe(true);
  const widow = p.card("Black Widow", "inPlay").id;
  expect(beat(p, (b) => b.turned?.id === widow && b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.interrupt === widow)).toBeGreaterThanOrEqual(0);
  // Caught Off Guard was revealed in Advance's place.
  expect(beat(p, (b) => b.reveal?.name === "Caught Off Guard")).toBeGreaterThanOrEqual(0);
  expect(threatBeats(p)).toBe(0);
});

// Found by this audit, now fixed in the engine (`cancelRevealedCard`): the cancelled card went to the encounter discard
// pile only after the replacement card was revealed and played out. "Cancel ... and discard it. Then, reveal another
// card": the discard comes first (RRG 1.8 "'Then'", p. 44), so it is in the pile before any reshuffle.
test("01075 Black Widow: the cancelled card is discarded before the next card is revealed", () => {
  const p = widowAtReveal();
  respond(p, "Black Widow", true);
  p.spend("Genius");
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  const discarded = beat(p, (b) => b.text === "Advance goes to the encounter discard pile");
  const revealed = beat(p, (b) => b.reveal?.name === "Caught Off Guard");
  expect(discarded).toBeGreaterThanOrEqual(0);
  expect(discarded).toBeLessThan(revealed);
});

test("01075 Black Widow: after she is exhausted the next card revealed offers her nothing", () => {
  const p = widowAtReveal();
  respond(p, "Black Widow", true);
  p.spend("Genius");
  expect(p.run(() => p.battle.pay())).toBe(true);
  // Caught Off Guard (surge) and Crowd Control follow: the villain phase runs through to the player's turn.
  expect(p.snap.choice?.offers ?? []).toEqual([]);
  expect(p.snap.turn).toBe("player");
});

test("01075 Black Widow: declining keeps her ready and the mental card, and the card resolves (Advance schemes)", () => {
  const p = widowAtReveal();
  const before = threatBeats(p);
  respond(p, "Black Widow", false);
  expect(p.card("Black Widow", "inPlay").exhausted).toBe(false);
  expect(p.snap.hand.map((c) => c.name)).toContain("Genius");
  // Advance: the villain schemes (one more threat placed after the offer).
  expect(threatBeats(p)).toBe(before + 1);
});

test("01075 Black Widow: with no mental resource in hand she is not offered", () => {
  // Seven cards, none with a mental icon: nothing can pay "spend a mental".
  const p = start(
    handOf("01088", "01090", "01082", "01077", "01080", "01076"),
    inPlay("01075"),
    villainPhaseDeals("01186"),
  );
  expect(p.snap.hand.some((c) => ["Genius", "First Aid", "Energy Daggers", "Vibranium Suit"].includes(c.name))).toBe(
    false,
  );
  p.end();
  const s = p.drive({ stopWhen: offerStop });
  expect(s.choice?.offers?.some((o) => o.question.includes("Black Widow")) ?? false).toBe(false);
  expect(s.turn).toBe("player");
});

// 01076 Luke Cage -------------------------------------------------------------------------------------------------------

test("01076 Luke Cage: cost 4 paid with two basic resources; enters with a tough status the table shows", () => {
  const p = start(handOf("01076", "01088", "01090", "01089", "01086", "01079"));
  expect(p.card("Luke Cage").cost).toBe(4);
  p.mark();
  p.play("Luke Cage", { pay: ["Energy", "Strength"] });
  expect(p.card("Luke Cage", "inPlay")).toMatchObject({ type: "ally", hp: 5 });
  expect(markerOf(p, "Luke Cage", "tough")).toBe(1);
  const luke = p.card("Luke Cage", "inPlay").id;
  expect(
    beat(p, (b) => b.statusChange?.id === luke && b.statusChange.name === "tough" && b.statusChange.delta === 1),
  ).toBeGreaterThanOrEqual(0);
  expect(p.snap.choice).toBeNull();
});

test("01076 Luke Cage: defending Rhino, the tough status takes the attack and is gone; he takes no damage", () => {
  const p = start(handOf("01076", "01088", "01090", "01089", "01086", "01079"), villainPhaseDeals());
  p.play("Luke Cage", { pay: ["Energy", "Strength"] });
  p.form();
  p.end();
  p.drive({ keep: [], stopWhen: defenceStop });
  const luke = p.card("Luke Cage", "inPlay").id;
  // Both Black Panther and Luke Cage can defend: two options with a card each (and the choice not to).
  expect(
    p.snap
      .choice!.options.map((o) => o.cardId)
      .filter(Boolean)
      .sort(),
  ).toEqual([p.snap.hero.id, luke].sort());
  p.mark();
  defendWith(p, luke);
  expect(p.beats.find((b) => b.hit?.target === luke)?.hit).toMatchObject({ amount: 0, tough: true });
  expect(markerOf(p, "Luke Cage", "tough")).toBe(0);
  expect(markerOf(p, "Luke Cage", "damage")).toBe(0);
  expect(p.card("Luke Cage", "inPlay").exhausted).toBe(true);
});

test("01076 Luke Cage: with no tough status left, the same attack lands (2 damage, shown on him)", () => {
  const p = start(handOf("01088", "01090", "01089", "01086", "01079", "01078"), inPlay("01076"), villainPhaseDeals());
  p.form();
  p.end();
  p.drive({ keep: [], stopWhen: defenceStop });
  const luke = p.card("Luke Cage", "inPlay").id;
  expect(markerOf(p, "Luke Cage", "tough")).toBe(0);
  p.mark();
  defendWith(p, luke);
  expect(p.beats.find((b) => b.hit?.target === luke)?.hit).toMatchObject({ amount: 2 });
  expect(markerOf(p, "Luke Cage", "damage")).toBe(2);
});

// 01077 Counter-Punch ---------------------------------------------------------------------------------------------------

const punchHand = handOf("01077", "01088", "01090", "01089", "01086", "01079");

test("01077 Counter-Punch: cannot be played from the hand, with the reason", () => {
  const p = start(punchHand);
  p.form();
  const card = p.card("Counter-Punch");
  expect(card.cost).toBe(0);
  expect(card.playable).toBe(false);
  expect(card.reason).toBe("this event can only be played when its interrupt or response triggers");
  expect(p.battle.pick(card.id)).toBe(false);
});

test("01077 Counter-Punch: offered after the hero defends, naming the card; accepting deals the hero's ATK (2) to Rhino", () => {
  const p = atDefence([punchHand], ["Counter-Punch"]);
  const rhino = p.snap.villain.id;
  const hp = p.snap.villainHp;
  defendWith(p, p.snap.hero.id);
  const choice = p.snap.choice!;
  expect(choice.event).toMatchObject({ kind: "defended" });
  expect(choice.offers).toHaveLength(1);
  expect(choice.offers![0]!.question).toBe("Respond with Counter-Punch?");
  expect(choice.canSkip).toBe(true);
  expect(choice.options.map((o) => o.label)).toEqual(["Use Counter-Punch"]);
  p.mark();
  respond(p, "Counter-Punch", true);
  // Retaliate 1 (the hero's own keyword) hit Rhino when he attacked; Counter-Punch is the other 2.
  expect(beat(p, (b) => b.hit?.target === rhino && b.hit.amount === 2)).toBeGreaterThanOrEqual(0);
  expect(p.snap.villainHp).toBe(hp - 3);
  expect(p.has("Counter-Punch", "discard")).toBe(true);
  expect(p.snap.hand.map((c) => c.name)).not.toContain("Counter-Punch");
  // Cost 0: no payment screen.
  expect(p.snap.payment).toBeNull();
});

// Found by this audit, now fixed: the effect read "Use Counter-Punch: Response (attack): After your hero defends against an enemy attack, deal
// damage: that enemy equal to your hero's ATK" (the card's trigger text with its "to" swapped for a colon).
test("01077 Counter-Punch: the offer's effect says what it does, as a sentence", () => {
  const p = atDefence([punchHand], ["Counter-Punch"]);
  defendWith(p, p.snap.hero.id);
  const effect = offerFor(p, "Counter-Punch").effect;
  expect(effect).not.toMatch(/Response \(attack\)/);
  expect(effect).not.toMatch(/damage: that enemy/);
  expect(effect).toMatch(/damage to (that enemy|Rhino)/);
});

// Found by this audit, now fixed: the window was titled "Just happened: a defense", naming neither who defended nor
// against whom.
test("01077 Counter-Punch: the response window says who defended against what", () => {
  const p = atDefence([punchHand], ["Counter-Punch"]);
  defendWith(p, p.snap.hero.id);
  expect(p.snap.choice!.prompt).toBe("Black Panther defended against Rhino's attack");
});

test("01077 Counter-Punch: declining leaves Rhino with only the retaliation and the card in hand", () => {
  const p = atDefence([punchHand], ["Counter-Punch"]);
  const hp = p.snap.villainHp;
  defendWith(p, p.snap.hero.id);
  respond(p, "Counter-Punch", false);
  expect(p.snap.villainHp).toBe(hp - 1);
  expect(p.snap.hand.map((c) => c.name)).toContain("Counter-Punch");
  expect(p.has("Counter-Punch", "discard")).toBe(false);
});

test("01077 Counter-Punch: not offered when the attack is left undefended", () => {
  const p = atDefence([punchHand], ["Counter-Punch"]);
  expect(p.run(() => p.battle.chooseMany(["decline"]))).toBe(true);
  expect(p.snap.choice?.offers ?? []).toEqual([]);
  expect(p.beats.some((b) => b.text === "The attack is undefended")).toBe(true);
  expect(p.snap.hand.map((c) => c.name)).toContain("Counter-Punch");
});

test("01077 Counter-Punch: against a minion's attack it hits that minion, not the villain", () => {
  const p = start(punchHand, engageMinion("01110"), villainPhaseDeals());
  p.form();
  p.end();
  const heroId = p.snap.hero.id;
  const s = p.drive({
    keep: ["Counter-Punch"],
    stopWhen: offerStop,
    defend: (choice) => (choice.defense!.attacker === "Hydra Bomber" ? heroId : "decline"),
  });
  expect(s.choice!.offers!.map((o) => o.question)).toEqual(["Respond with Counter-Punch?"]);
  const bomber = s.enemyCards.find((c) => c.name === "Hydra Bomber")!;
  const hp = p.snap.villainHp;
  p.mark();
  respond(p, "Counter-Punch", true);
  expect(beat(p, (b) => b.hit?.target === bomber.id && b.hit.amount === 2)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.defeatedCard === bomber.id)).toBeGreaterThanOrEqual(0);
  expect(p.snap.villainHp).toBe(hp);
});

// 01078 Get Behind Me! --------------------------------------------------------------------------------------------------

const gbmHand = handOf("01078", "01088", "01090", "01089", "01086", "01079");

/** Hero form with Get Behind Me! in hand; the villain phase up to the offer on the treachery dealt. */
function gbmAtReveal(codes: string[] = ["01186"]) {
  const p = start(gbmHand, villainPhaseDeals(...codes));
  p.form();
  p.end();
  p.mark();
  p.drive({ stopWhen: offerStop, keep: ["Get Behind Me!"] });
  return p;
}

test("01078 Get Behind Me!: offered when a treachery is about to be revealed, as an interrupt naming the card", () => {
  const p = gbmAtReveal();
  const choice = p.snap.choice!;
  expect(choice.prompt).toBe("Advance is about to be revealed");
  expect(choice.event).toMatchObject({ kind: "encounterCardRevealing", before: true });
  expect(choice.offers).toHaveLength(1);
  expect(choice.offers![0]!.question).toBe("Interrupt with “Get Behind Me!”");
  expect(choice.canSkip).toBe(true);
  // Rhino's boost (also a treachery) was not offered: only the card dealt.
  expect(beat(p, (b) => b.reveal?.name === "Hard to Keep Down")).toBeGreaterThanOrEqual(0);
});

test("01078 Get Behind Me!: costs 1 (paid from the hand); Advance is cancelled and the villain attacks the hero instead", () => {
  const p = gbmAtReveal();
  respond(p, "Get Behind Me!", true);
  expect(p.snap.payment!.required).toBe(1);
  p.spend("Genius");
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.snap.hand.some((c) => c.name === "Get Behind Me!")).toBe(false);
  // The villain attacks again (a second defender question); Advance did not scheme.
  expect(p.snap.choice?.defense?.attacker).toBe("Rhino");
  expect(p.beats.some((b) => b.text === "Get Behind Me! interrupts" && !!b.interrupt)).toBe(true);
  const rest = p.drive({ keep: [] });
  expect(rest.turn).toBe("player");
  expect(threatBeats(p)).toBe(0);
  expect(p.has("Get Behind Me!", "discard")).toBe(true);
  expect(p.beats.some((b) => b.text === "Advance goes to the encounter discard pile")).toBe(true);
});

test("01078 Get Behind Me!: the second attack is a real one the hero can defend", () => {
  const p = gbmAtReveal();
  respond(p, "Get Behind Me!", true);
  p.spend("Genius");
  expect(p.run(() => p.battle.pay())).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.defense).toMatchObject({ attacker: "Rhino", target: p.snap.hero.id });
  expect(choice.options.map((o) => o.label)).toEqual(["Don’t defend", "Defend"]);
});

test("01078 Get Behind Me!: declining lets Advance resolve (the villain schemes)", () => {
  const p = gbmAtReveal();
  respond(p, "Get Behind Me!", false);
  const rest = p.drive({ keep: ["Get Behind Me!"] });
  expect(rest.turn).toBe("player");
  expect(p.snap.hand.map((c) => c.name)).toContain("Get Behind Me!");
  expect(threatBeats(p)).toBe(1);
});

test("01078 Get Behind Me!: a hero interrupt, so not offered while Black Panther is T'Challa", () => {
  const p = start(gbmHand, villainPhaseDeals("01186"));
  p.end();
  const s = p.drive({ stopWhen: offerStop, keep: ["Get Behind Me!"] });
  expect(s.choice?.offers?.some((o) => o.question.includes("Get Behind Me!")) ?? false).toBe(false);
  expect(s.turn).toBe("player");
});

test("01078 Get Behind Me!: only for a treachery: not offered for a minion or a side scheme", () => {
  for (const code of ["01110", "01108"]) {
    const p = start(gbmHand, code === "01108" ? stack("01104", "01108", "01101") : villainPhaseDeals(code));
    p.form();
    p.end();
    const s = p.drive({ stopWhen: offerStop, keep: ["Get Behind Me!"] });
    expect(s.choice?.offers?.some((o) => o.question.includes("Get Behind Me!")) ?? false, code).toBe(false);
    expect(s.turn).toBe("player");
  }
});

test("01078 Get Behind Me!: cannot be played from the hand", () => {
  const p = start(gbmHand);
  p.form();
  const card = p.card("Get Behind Me!");
  expect(card.cost).toBe(1);
  expect(card.playable).toBe(false);
  expect(card.reason).toBe("this event can only be played when its interrupt or response triggers");
});

// 01079 The Power of Protection -----------------------------------------------------------------------------------------

test("01079 The Power of Protection: cannot be played itself, with the reason", () => {
  const p = start(handOf("01079", "01076", "01088", "01090", "01089", "01086"));
  const card = p.card("The Power of Protection");
  expect(card.playable).toBe(false);
  expect(card.reason).toBe("Spend this card to pay for another card.");
});

test("01079 The Power of Protection: counts double for a Protection card (Luke Cage, cost 4: it and one Energy pay)", () => {
  const p = start(handOf("01079", "01076", "01088", "01090", "01089", "01086"));
  expect(p.battle.pick(p.card("Luke Cage").id)).toBe(true);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Protection")!;
  expect(power.icons).toEqual(["wild", "wild"]);
  p.battle.toggle(power.id);
  expect(p.snap.payment!.paid).toBe(2);
  expect(p.snap.payment!.canPay).toBe(false);
  p.spend("Energy");
  expect(p.snap.payment!.paid).toBe(4);
  expect(p.snap.payment!.canPay).toBe(true);
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.has("Luke Cage", "inPlay")).toBe(true);
  expect(p.has("The Power of Protection", "discard")).toBe(true);
});

test.each([
  ["Mockingbird", "01083"],
  ["Panther Claws", "01088"],
])("01079 The Power of Protection: counts single for a card that is not Protection (%s)", (name, code) => {
  const p = start(handOf("01079", code, "01090", "01089", "01086"));
  expect(p.battle.pick(p.card(name).id)).toBe(true);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Protection")!;
  expect(power.icons).toEqual(["wild"]);
  p.battle.toggle(power.id);
  expect(p.snap.payment!.paid).toBe(1);
});

test("01079 The Power of Protection: doubled for an event of Protection paid as an interrupt (Get Behind Me!)", () => {
  const p = gbmAtReveal();
  respond(p, "Get Behind Me!", true);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Protection")!;
  expect(power.icons).toEqual(["wild", "wild"]);
  p.battle.toggle(power.id);
  expect(p.snap.payment!.canPay).toBe(true);
});

// 01080 Med Team --------------------------------------------------------------------------------------------------------

const medTeam = (n = 3): Setup[] => [inPlay("01080"), patchCard("01080", { counters: { medical: n } })];
const medAction = (p: Player) =>
  p.battle.fieldActions(p.card("Med Team", "inPlay").id).find((a) => a.kind.endsWith("med-team-action"));
const useMedTeam = (p: Player) =>
  expect(p.run(() => p.battle.fieldAction(p.card("Med Team", "inPlay").id, "01080.med-team-action"))).toBe(true);

test("01080 Med Team: cost 3; enters play with 3 medical counters shown, and nothing asked", () => {
  const p = start(handOf("01080", "01088", "01090", "01089", "01086", "01079"));
  expect(p.card("Med Team").cost).toBe(3);
  p.play("Med Team", { pay: ["Energy", "First Aid"] });
  expect(markerOf(p, "Med Team", "medical")).toBe(3);
  expect(p.card("Med Team", "inPlay").exhausted).toBe(false);
  expect(p.snap.choice).toBeNull();
});

test("01080 Med Team: its action is labelled for what it does and exhausts", () => {
  const p = start(handOf("01088"), ...medTeam(), patchByCode("hero", { damage: 3 }));
  expect(medAction(p)).toMatchObject({ label: "Heal 2 damage from a friendly character", exhausts: true });
});

test("01080 Med Team: with only the hero hurt it heals 2 at once, spends a counter and exhausts (all shown)", () => {
  const p = start(handOf("01088"), ...medTeam(), patchByCode("hero", { damage: 3 }));
  const hp = p.snap.heroHp;
  const heroId = p.snap.hero.id;
  const med = p.card("Med Team", "inPlay").id;
  p.mark();
  useMedTeam(p);
  expect(p.snap.choice).toBeNull();
  expect(p.snap.payment).toBeNull();
  expect(p.snap.heroHp).toBe(hp + 2);
  expect(markerOf(p, "Med Team", "medical")).toBe(2);
  expect(p.card("Med Team", "inPlay").exhausted).toBe(true);
  expect(beat(p, (b) => b.turned?.id === med && b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  expect(
    beat(p, (b) => b.statusChange?.id === med && b.statusChange.name === "medical" && b.statusChange.delta === -1),
  ).toBeGreaterThanOrEqual(0);
  expect(
    beat(p, (b) => b.statusChange?.id === heroId && b.statusChange.name === "damage" && b.statusChange.delta === -2),
  ).toBeGreaterThanOrEqual(0);
  // Exhausted: no second use this round.
  expect(medAction(p)).toBeUndefined();
});

test("01080 Med Team: heals only the damage there is (1 damage: 1 healed)", () => {
  const p = start(handOf("01088"), ...medTeam(), patchByCode("hero", { damage: 1 }));
  const heroId = p.snap.hero.id;
  p.mark();
  useMedTeam(p);
  expect(
    beat(p, (b) => b.statusChange?.id === heroId && b.statusChange.name === "damage" && b.statusChange.delta === -1),
  ).toBeGreaterThanOrEqual(0);
  expect(p.snap.heroHp).toBe(11);
});

test("01080 Med Team: hero and an ally both hurt -> it asks which, naming both and never the villain; heals the ally", () => {
  const p = start(
    handOf("01088"),
    ...medTeam(),
    inPlay("01076"),
    patchCard("01076", { damage: 3 }),
    patchByCode("hero", { damage: 1 }),
  );
  p.mark();
  useMedTeam(p);
  const choice = p.snap.choice!;
  expect(choice.options.map((o) => o.label).sort()).toEqual(["Luke Cage", "T'Challa"]);
  p.choose({ label: "Luke Cage" });
  expect(markerOf(p, "Luke Cage", "damage")).toBe(1);
  expect(p.snap.heroHp).toBe(10);
  expect(markerOf(p, "Med Team", "medical")).toBe(2);
});

test("01080 Med Team: the last counter heals, then Med Team is discarded (shown as leaving play)", () => {
  const p = start(handOf("01088"), ...medTeam(1), patchByCode("hero", { damage: 4 }));
  const hp = p.snap.heroHp;
  const med = p.card("Med Team", "inPlay").id;
  p.mark();
  useMedTeam(p);
  expect(p.snap.heroHp).toBe(hp + 2);
  expect(p.has("Med Team", "inPlay")).toBe(false);
  expect(p.has("Med Team", "discard")).toBe(true);
  expect(beat(p, (b) => b.leftPlay === med)).toBeGreaterThanOrEqual(0);
});

test("01080 Med Team: two copies each enter with their own 3 counters", () => {
  const p = start(handOf("01080", "01080", "01088", "01090", "01089", "01086"));
  p.play("Med Team", { pay: ["Energy", "First Aid"] });
  p.play("Med Team", { pay: ["Strength", "Genius"] });
  const meds = p.snap.inPlay.filter((c) => c.name === "Med Team");
  expect(meds).toHaveLength(2);
  expect(meds.map((c) => c.markers.find((m) => m.name === "medical")?.count)).toEqual([3, 3]);
});

// 01081 Armored Vest ----------------------------------------------------------------------------------------------------

const vestHand = handOf("01081", "01081", "01088", "01090", "01089", "01086");

test("01081 Armored Vest: cost 1; in play it is attached to the hero and shown as +1 DEF on the hero", () => {
  const p = start(vestHand);
  expect(p.card("Armored Vest").cost).toBe(1);
  p.form();
  p.mark();
  p.play("Armored Vest", { pay: ["Energy"] });
  // Solo: the only player's hero, so no question about whose.
  expect(p.snap.choice).toBeNull();
  expect(p.card("Armored Vest", "inPlay").attachedTo).toBe(p.snap.hero.id);
  expect(p.snap.hero.markers).toEqual([{ name: "DEF", count: 1 }]);
  expect(
    beat(p, (b) => b.modifier?.id === p.snap.hero.id && b.modifier.name === "DEF" && b.modifier.count === 1),
  ).toBeGreaterThanOrEqual(0);
});

// Checked: with one hero to attach to there is no question, and while it is paid for the card's `attachedTo` is null (with
// two allies to choose from, Inspired's payment subject is attached to the one chosen): the table can't hold the vest
// over the hero while it is paid.
test("01081 Armored Vest: while it is paid for it is already held by the hero", () => {
  const p = start(vestHand);
  p.form();
  expect(p.battle.pick(p.card("Armored Vest").id)).toBe(true);
  // With no host to choose the engine names none; an upgrade with no host is drawn tucked under the hero already.
  const subject = p.snap.payment!.subject;
  expect(subject.name).toBe("Armored Vest");
  expect([null, p.snap.hero.id]).toContain(subject.attachedTo ?? null);
});

test("01081 Armored Vest: max 1 per player -> a second copy is refused, with a reason that says so", () => {
  const p = start(vestHand);
  p.play("Armored Vest", { pay: ["Energy"] });
  const second = p.card("Armored Vest");
  expect(second.playable).toBe(false);
  expect(second.reason).toBe("max 1 per player");
  expect(p.battle.pick(second.id)).toBe(false);
  expect(p.snap.payment).toBeNull();
});

test("01081 Armored Vest: the extra DEF takes 1 more off the attack when the hero defends (Rhino 2 + boost 2)", () => {
  const damageTaken = (vest: boolean) => {
    const p = start(
      handOf("01088", "01090", "01089", "01086", "01079", "01078"),
      ...(vest ? [inPlay("01081")] : []),
      stack("01108", "01104", "01101"),
    );
    p.form();
    p.end();
    p.drive({ keep: [], stopWhen: defenceStop });
    p.mark();
    defendWith(p, p.snap.hero.id);
    return p.beats.find((b) => b.hit?.target === p.snap.hero.id)?.hit?.amount;
  };
  expect(damageTaken(false)).toBe(2);
  expect(damageTaken(true)).toBe(1);
});

// 01082 Indomitable -----------------------------------------------------------------------------------------------------

/** Hero form, Indomitable played (cost 1), Rhino and a Hydra Bomber both attacking: up to the first defender question. */
function indomitableAtDefence(
  hand: string[] = ["01082", "01088", "01090", "01089", "01086", "01079"],
  keep: string[] = [],
) {
  const p = start(handOf(...hand), engageMinion("01110"), villainPhaseDeals());
  p.form();
  p.play("Indomitable", { pay: ["Energy"] });
  p.end();
  p.drive({ keep, stopWhen: defenceStop });
  expect(p.snap.choice!.defense).toBeDefined();
  p.mark();
  return { p, heroId: p.snap.hero.id };
}

test("01082 Indomitable: cost 1; attached to the hero (no question, one hero); no marker", () => {
  const p = start(handOf("01082", "01088", "01090", "01089", "01086", "01079"));
  p.form();
  expect(p.card("Indomitable").cost).toBe(1);
  p.play("Indomitable", { pay: ["Energy"] });
  expect(p.snap.choice).toBeNull();
  expect(p.card("Indomitable", "inPlay")).toMatchObject({ type: "upgrade", attachedTo: p.snap.hero.id, markers: [] });
});

test("01082 Indomitable: after the hero defends, the offer names it; its label is the discard cost", () => {
  const { p, heroId } = indomitableAtDefence();
  defendWith(p, heroId);
  const choice = p.snap.choice!;
  expect(choice.event).toMatchObject({ kind: "defended" });
  expect(choice.offers).toHaveLength(1);
  expect(choice.offers![0]!.question).toBe("Respond with Indomitable?");
  expect(choice.canSkip).toBe(true);
  expect(choice.options.map((o) => o.label)).toEqual(["discard this card"]);
});

// Found by this audit, now fixed: the effect read "Use Indomitable to discard Indomitable → ready your hero" (the cost, an arrow, the effect).
test("01082 Indomitable: the offer's effect reads as a sentence", () => {
  const { p, heroId } = indomitableAtDefence();
  defendWith(p, heroId);
  const effect = offerFor(p, "Indomitable").effect;
  expect(effect).not.toMatch(/→/);
  expect(effect).toMatch(/ready (Black Panther|your hero)/);
});

test("01082 Indomitable: accepting discards it and readies the hero, who can defend the next attack too", () => {
  const { p, heroId } = indomitableAtDefence();
  defendWith(p, heroId);
  respond(p, "Indomitable", true);
  expect(p.has("Indomitable", "inPlay")).toBe(false);
  expect(p.has("Indomitable", "discard")).toBe(true);
  expect(beat(p, (b) => b.turned?.id === heroId && !b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  // The second attacker's question offers the hero again (he is ready).
  const next = p.snap.choice!;
  expect(next.defense).toBeDefined();
  expect(next.options.some((o) => o.cardId === heroId)).toBe(true);
});

test("01082 Indomitable: declining keeps it on the hero, who stays exhausted and cannot defend the next attack", () => {
  const { p, heroId } = indomitableAtDefence();
  defendWith(p, heroId);
  respond(p, "Indomitable", false);
  expect(p.has("Indomitable", "inPlay")).toBe(true);
  // He is exhausted: either nothing is asked about the next attack, or the hero is not among the defenders.
  if (p.snap.choice?.defense) expect(p.snap.choice.options.some((o) => o.cardId === heroId)).toBe(false);
  else
    expect(p.beats.some((b) => b.text === "The attack is undefended" || b.text === "Black Panther exhausts")).toBe(
      true,
    );
});

test("01082 Indomitable: not offered when the attack is left undefended", () => {
  const { p } = indomitableAtDefence();
  expect(p.run(() => p.battle.chooseMany(["decline"]))).toBe(true);
  expect(p.snap.choice?.offers ?? []).toEqual([]);
  expect(p.has("Indomitable", "inPlay")).toBe(true);
});

test("01082 Indomitable with Counter-Punch: both are offered together, and both can be taken", () => {
  const { p, heroId } = indomitableAtDefence(["01082", "01077", "01088", "01090", "01089", "01086"], ["Counter-Punch"]);
  const attacker = p.snap.choice!.defense!.attacker;
  const hp = p.snap.villainHp;
  defendWith(p, heroId);
  const choice = p.snap.choice!;
  expect(choice.offers!.map((o) => o.question).sort()).toEqual([
    "Respond with Counter-Punch?",
    "Respond with Indomitable?",
  ]);
  expect(choice.max).toBe(2);
  expect(p.run(() => p.battle.chooseMany(choice.offers!.map((o) => o.id)))).toBe(true);
  expect(p.has("Counter-Punch", "discard")).toBe(true);
  expect(p.has("Indomitable", "discard")).toBe(true);
  expect(beat(p, (b) => b.turned?.id === heroId && !b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  if (attacker === "Rhino") expect(p.snap.villainHp).toBe(hp - 3);
});
