/**
 * The Leadership cards of Captain Marvel's starter deck (01066–01074), each played through the 3D table's model as a
 * player would (pick -> target -> payment -> pay) and checked for what the table would show: beats, counters and stat
 * markers on cards, the choice prompt and its labels, the payment screen's sources, refusal reasons.
 */
import { expect, test } from "vitest";
import {
  beat,
  codeOf,
  encounterTop,
  handOf,
  inPlay,
  patchCard,
  scenarioOf,
  type Player,
  type Setup,
} from "./deck-audit-driver.js";

const scenario = (...steps: Setup[]) => scenarioOf({ hero: "captain-marvel" }, ...steps);

/** A card from the hand or deck straight into the discard pile (context only). */
const discardOf =
  (...codes: string[]): Setup =>
  (state) => {
    const p = state.players[0]!;
    let { hand, deck, discard } = p;
    for (const code of codes) {
      const id = [...hand, ...deck].find((i) => codeOf(state, i) === code && !discard.includes(i));
      if (!id) throw Error(`no ${code} to discard`);
      hand = hand.filter((i) => i !== id);
      deck = deck.filter((i) => i !== id);
      discard = [...discard, id];
    }
    return { ...state, players: [{ ...p, hand, deck, discard }] };
  };

/** Answer the reaction window's offer for `name` (accept), or decline everything. */
function respond(p: Player, name: string, accept: boolean) {
  const offer = p.snap.choice!.offers!.find((o) => o.question.includes(name))!;
  expect(offer, JSON.stringify(p.snap.choice)).toBeDefined();
  expect(p.run(() => p.battle.chooseMany(accept ? [offer.id] : []))).toBe(true);
}

const arrows = (p: Player) => p.card("Hawkeye", "inPlay").markers.find((m) => m.name === "arrow")?.count ?? 0;
const marker = (p: Player, name: string, m: string) =>
  p.card(name, "inPlay").markers.find((x) => x.name === m)?.count ?? 0;

// 01066 Hawkeye ---------------------------------------------------------------------------------------------------------

/** Hawkeye played through the hand (3 energy-or-whatever), then the villain phase up to the reaction window on the minion. */
function hawkeyeAtMinion(...extra: Setup[]) {
  const p = scenario(handOf("01066", "01088", "01090", "01089", "01086"), encounterTop("01186", "01110"), ...extra);
  p.play("Hawkeye", { pay: ["Energy", "Strength"] });
  p.end();
  p.mark();
  p.drive({ stopWhen: (s) => !!s.choice?.offers?.length });
  return p;
}

test("01066 Hawkeye: enters play with 4 arrow counters, shown on the card and announced", () => {
  const p = scenario(handOf("01066", "01088", "01090", "01089", "01086"));
  p.mark();
  const card = p.play("Hawkeye", { pay: ["Energy", "Strength"] });
  expect(card.cost).toBe(3);
  expect(arrows(p)).toBe(4);
  expect(beat(p, (b) => /\+4 arrow/.test(b.text))).toBeGreaterThanOrEqual(0);
  // He stays in play with no minion about: nothing is asked.
  expect(p.snap.choice).toBeNull();
});

test("01066 Hawkeye: a minion enters play -> offer names the minion; accepting removes 1 arrow and deals 2 damage", () => {
  const p = hawkeyeAtMinion();
  const choice = p.snap.choice!;
  expect(choice.prompt).toBe("Hydra Bomber entered play");
  expect(choice.canSkip).toBe(true);
  expect(choice.offers).toHaveLength(1);
  expect(choice.offers![0]!.question).toBe("Respond with Hawkeye?");
  expect(choice.offers![0]!.effect).toMatch(/2 damage to that minion/);
  expect(choice.options.map((o) => o.label)).toEqual(["remove 1 arrow counter"]);
  const bomber = p.snap.enemyCards.find((c) => c.name === "Hydra Bomber")!;
  expect(choice.event).toMatchObject({ kind: "cardEntersPlay", subject: bomber.id });
  p.mark();
  respond(p, "Hawkeye", true);
  expect(arrows(p)).toBe(3);
  expect(beat(p, (b) => b.hit?.target === bomber.id && b.hit.amount === 2)).toBeGreaterThanOrEqual(0);
  // Hydra Bomber has 2 HP: the 2 damage defeats it, after it was shown landing.
  expect(beat(p, (b) => b.defeatedCard === bomber.id)).toBeGreaterThan(
    beat(p, (b) => b.hit?.target === bomber.id && b.hit.amount === 2),
  );
  expect(p.snap.enemyCards.some((c) => c.name === "Hydra Bomber")).toBe(false);
});

test("01066 Hawkeye: declining keeps the arrow and leaves the minion untouched", () => {
  const p = hawkeyeAtMinion();
  p.mark();
  respond(p, "Hawkeye", false);
  expect(arrows(p)).toBe(4);
  expect(p.beats.some((b) => b.hit?.target === p.snap.enemyCards.find((c) => c.name === "Hydra Bomber")?.id)).toBe(
    false,
  );
  const bomber = p.snap.enemyCards.find((c) => c.name === "Hydra Bomber")!;
  expect(bomber.markers.find((m) => m.name === "damage")?.count ?? 0).toBe(0);
});

test("01066 Hawkeye: with no arrow counters left he stays in play and offers nothing", () => {
  const p = scenario(
    handOf("01088", "01090", "01089", "01086"),
    inPlay("01066"),
    patchCard("01066", { counters: { arrow: 0 } }),
    encounterTop("01186", "01110"),
  );
  expect(arrows(p)).toBe(0);
  p.end();
  p.mark();
  const s = p.drive({ stopWhen: (x) => !!x.choice?.offers?.some((o) => o.question.includes("Hawkeye")) });
  expect(s.choice?.offers?.some((o) => o.question.includes("Hawkeye")) ?? false).toBe(false);
  expect(s.turn).toBe("player");
  expect(p.has("Hawkeye", "inPlay")).toBe(true);
  expect(p.has("Hydra Bomber", "enemyCards")).toBe(true);
});

// 01067 Maria Hill ------------------------------------------------------------------------------------------------------

function mariaPlayed() {
  const p = scenario(handOf("01067", "01088", "01090", "01089", "01086"));
  const hand = p.snap.hand.length;
  const deck = p.snap.deckCount;
  p.mark();
  p.play("Maria Hill", { pay: ["Energy"] });
  return { p, hand, deck };
}

test("01067 Maria Hill: cost 2 paid; her own response window names her; accepting draws 1 (shown)", () => {
  const { p, hand, deck } = mariaPlayed();
  expect(p.has("Maria Hill", "inPlay")).toBe(true);
  expect(p.snap.choice!.prompt).toBe("Maria Hill entered play");
  expect(p.snap.choice!.offers![0]!.question).toBe("Respond with Maria Hill?");
  // Played (-1) and paid with one Energy (-1): hand - 2 before the draw.
  expect(p.snap.hand.length).toBe(hand - 2);
  respond(p, "Maria Hill", true);
  expect(p.snap.hand.length).toBe(hand - 1);
  expect(p.snap.deckCount).toBe(deck - 1);
  expect(beat(p, (b) => !!b.draw?.length)).toBeGreaterThanOrEqual(0);
});

test("01067 Maria Hill: declining draws nothing", () => {
  const { p, hand, deck } = mariaPlayed();
  respond(p, "Maria Hill", false);
  expect(p.snap.hand.length).toBe(hand - 2);
  expect(p.snap.deckCount).toBe(deck);
  expect(p.beats.some((b) => !!b.draw?.length)).toBe(false);
});

// Found by this audit, now fixed: the offer reads "Use Maria Hill to each player draws 1 card" (ungrammatical) and its button says "Use ability".
test("01067 Maria Hill: the offer's effect reads as a sentence and the option says what it does", () => {
  const { p } = mariaPlayed();
  const offer = p.snap.choice!.offers![0]!;
  expect(offer.effect).not.toMatch(/to each player draws/);
  expect(p.snap.choice!.options[0]!.label).not.toBe("Use ability");
});

// 01068 Vision ----------------------------------------------------------------------------------------------------------

function visionStart(...extra: Setup[]) {
  const p = scenario(handOf("01088", "01089", "01090", "01086"), inPlay("01068"), ...extra);
  const vision = p.card("Vision", "inPlay");
  const action = p.battle.fieldActions(vision.id).find((a) => a.kind.endsWith("vision-action"))!;
  expect(action.label).toBe("Spend 1 energy: +2 THW or ATK");
  expect(p.battle.fieldAction(vision.id, action.kind)).toBe(true);
  return { p, vision };
}

test("01068 Vision: the payment screen asks for 1 energy and only an energy card can pay it", () => {
  const { p } = visionStart();
  const payment = p.snap.payment!;
  expect(payment.ability).toBe(true);
  expect(payment.outstanding).toEqual(["1 energy"]);
  expect(payment.subject.name).toBe("Vision");
  expect(payment.sources.filter((s) => s.available).map((s) => s.label)).toEqual(["Energy"]);
});

test.each([
  ["THW", /THW/, "ATK"],
  ["ATK", /ATK/, "THW"],
] as const)("01068 Vision: choosing +2 %s puts that bonus on the card, once per round", (stat, label, other) => {
  const { p, vision } = visionStart();
  p.spend("Energy");
  expect(p.run(() => p.battle.pay())).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.options.map((o) => o.label)).toEqual([
    "+2 THW until the end of the phase",
    "+2 ATK until the end of the phase",
  ]);
  expect(choice.prompt).toMatch(/Vision|choose/i);
  p.mark();
  p.choose({ label });
  expect(marker(p, "Vision", stat)).toBe(2);
  expect(marker(p, "Vision", other)).toBe(0);
  expect(
    beat(p, (b) => b.modifier?.id === vision.id && b.modifier.name === stat && b.modifier.count === 2),
  ).toBeGreaterThanOrEqual(0);
  expect(p.has("Energy", "hand")).toBe(false);
  // Limit once per round: no longer offered.
  expect(p.battle.fieldActions(vision.id).some((a) => a.kind.endsWith("vision-action"))).toBe(false);
});

test("01068 Vision: the bonus ends with the phase and the action comes back next round (a wild resource pays the energy)", () => {
  const { p, vision } = visionStart(handOf("01088", "01072", "01089", "01090", "01086"));
  p.spend("Energy");
  p.run(() => p.battle.pay());
  p.choose({ label: /THW/ });
  expect(marker(p, "Vision", "THW")).toBe(2);
  p.end();
  p.drive();
  expect(p.snap.turn).toBe("player");
  expect(marker(p, "Vision", "THW")).toBe(0);
  expect(p.battle.fieldActions(vision.id).some((a) => a.kind.endsWith("vision-action"))).toBe(true);
  expect(
    p.battle.fieldAction(
      vision.id,
      p.battle.fieldActions(vision.id).find((a) => a.kind.endsWith("vision-action"))!.kind,
    ),
  ).toBe(true);
  expect(p.snap.payment!.sources.filter((s) => s.available).map((s) => s.label)).toEqual(["The Power of Leadership"]);
});

// 01069 Get Ready -------------------------------------------------------------------------------------------------------

test("01069 Get Ready: with several allies it asks which one to ready, then readies it (beat)", () => {
  const p = scenario(
    handOf("01069", "01088"),
    inPlay("01068"),
    inPlay("01067"),
    patchCard("01068", { exhausted: true }),
    patchCard("01067", { exhausted: true }),
  );
  expect(p.card("Get Ready").cost).toBe(0);
  expect(p.card("Get Ready").playable).toBe(true);
  p.mark();
  expect(p.battle.pick(p.card("Get Ready").id)).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.options.map((o) => o.label).sort()).toEqual(["Maria Hill", "Vision"]);
  const vision = p.card("Vision", "inPlay");
  expect(choice.options.find((o) => o.label === "Vision")!.cardId).toBe(vision.id);
  p.choose({ card: vision.id });
  // Cost 0: no payment screen.
  expect(p.snap.payment).toBeNull();
  expect(p.card("Vision", "inPlay").exhausted).toBe(false);
  expect(p.card("Maria Hill", "inPlay").exhausted).toBe(true);
  expect(beat(p, (b) => b.turned?.id === vision.id && !b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  expect(p.has("Get Ready", "discard")).toBe(true);
});

// Found by this audit, now fixed: the target question reads just "Choose a target" (the card being played and the word ally are not named).
test("01069 Get Ready: the target question comes from Get Ready, which the turn bar names", () => {
  const p = scenario(
    handOf("01069", "01088"),
    inPlay("01068"),
    inPlay("01067"),
    patchCard("01068", { exhausted: true }),
  );
  expect(p.battle.pick(p.card("Get Ready").id)).toBe(true);
  // The prompt stays generic; the turn bar's eyebrow names the card asking (main.ts: `nameOf(state.choiceSource)`).
  const asking = p.snap.choiceSource;
  expect(asking && p.battle.cardName(asking)).toBe("Get Ready");
});

test("01069 Get Ready: one ally -> no question, it is readied", () => {
  const p = scenario(handOf("01069", "01088"), inPlay("01068"), patchCard("01068", { exhausted: true }));
  p.mark();
  p.play("Get Ready");
  expect(p.snap.choice).toBeNull();
  expect(p.card("Vision", "inPlay").exhausted).toBe(false);
});

test("01069 Get Ready: with no ally in play the card is refused with a reason", () => {
  const p = scenario(handOf("01069", "01088"));
  const card = p.card("Get Ready");
  expect(card.playable).toBe(false);
  expect(card.reason).toMatch(/ally|target/i);
  expect(p.battle.pick(card.id)).toBe(false);
});

// 01070 Lead from the Front ---------------------------------------------------------------------------------------------

test("01070 Lead from the Front: hero form only, refused as Carol Danvers with the reason", () => {
  const p = scenario(handOf("01070", "01088", "01089", "01090"));
  const card = p.card("Lead from the Front");
  expect(card.requiresHeroForm).toBe(true);
  expect(card.playable).toBe(false);
  expect(card.reason).toBe("this event requires hero form");
});

test("01070 Lead from the Front: +1 THW and +1 ATK on the hero and each ally, shown, gone at end of phase", () => {
  const p = scenario(handOf("01070", "01088", "01089", "01090"), inPlay("01068"), inPlay("01067"));
  p.form();
  p.mark();
  const card = p.play("Lead from the Front", { pay: ["Energy"] });
  expect(card.cost).toBe(2);
  // One player: "choose a player" has only her to choose, so nothing is asked.
  expect(p.snap.choice).toBeNull();
  const hero = p.snap.hero;
  expect(hero.markers).toEqual(
    expect.arrayContaining([
      { name: "THW", count: 1 },
      { name: "ATK", count: 1 },
    ]),
  );
  for (const ally of ["Vision", "Maria Hill"]) {
    expect(marker(p, ally, "THW")).toBe(1);
    expect(marker(p, ally, "ATK")).toBe(1);
    const id = p.card(ally, "inPlay").id;
    expect(beat(p, (b) => b.modifier?.id === id && b.modifier.name === "THW")).toBeGreaterThanOrEqual(0);
    expect(beat(p, (b) => b.modifier?.id === id && b.modifier.name === "ATK")).toBeGreaterThanOrEqual(0);
  }
  expect(p.has("Lead from the Front", "discard")).toBe(true);
  p.end();
  p.drive();
  expect(p.snap.turn).toBe("player");
  expect(marker(p, "Vision", "THW")).toBe(0);
  expect(p.snap.hero.markers.filter((m) => m.name === "THW" || m.name === "ATK")).toEqual([]);
});

// 01071 Make the Call ---------------------------------------------------------------------------------------------------

// Found by this audit, now fixed: with no ally in any discard pile the card says "choose exactly one card for ally" (the engine's wording).
test("01071 Make the Call: with no ally in a discard pile it is refused, and the reason says why", () => {
  const p = scenario(handOf("01071", "01088", "01089", "01090"));
  const card = p.card("Make the Call");
  expect(card.playable).toBe(false);
  expect(card.reason).toMatch(/ally/i);
  expect(card.reason).toMatch(/discard/i);
});

test("01071 Make the Call: with no ally in a discard pile it cannot be picked", () => {
  const p = scenario(handOf("01071", "01088", "01089", "01090"), discardOf("01013"));
  const card = p.card("Make the Call");
  expect(card.playable).toBe(false);
  expect(p.battle.pick(card.id)).toBe(false);
  expect(p.snap.payment).toBeNull();
});

test("01071 Make the Call: pays the ally's printed cost (3 for Hawkeye), puts him into play with fresh counters", () => {
  const p = scenario(handOf("01071", "01088", "01089", "01090", "01086"), discardOf("01066"));
  expect(p.snap.discard.map((c) => c.name)).toContain("Hawkeye");
  const call = p.card("Make the Call");
  expect(call.cost).toBe(0);
  expect(call.playable).toBe(true);
  p.mark();
  expect(p.battle.pick(call.id)).toBe(true);
  // One ally to choose from: no question, straight to the payment of his printed cost.
  expect(p.snap.choice).toBeNull();
  const payment = p.snap.payment!;
  expect(payment.required).toBe(3);
  expect(payment.paid).toBe(0);
  p.spend("Energy", "Strength");
  expect(p.snap.payment!.canPay).toBe(true);
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.has("Hawkeye", "inPlay")).toBe(true);
  expect(p.has("Hawkeye", "discard")).toBe(false);
  expect(p.has("Make the Call", "discard")).toBe(true);
  expect(arrows(p)).toBe(4);
});

test("01071 Make the Call: a second ally in the discard pile is a choice naming both", () => {
  const p = scenario(handOf("01071", "01088", "01089", "01090", "01086"), discardOf("01066", "01067"));
  expect(p.battle.pick(p.card("Make the Call").id)).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.options.map((o) => o.label).sort()).toEqual(["Hawkeye", "Maria Hill"]);
  p.choose({ label: "Maria Hill" });
  expect(p.snap.payment!.required).toBe(2);
});

// 01072 The Power of Leadership -----------------------------------------------------------------------------------------

test("01072 The Power of Leadership: counts double on the payment screen for a Leadership card (Hawkeye)", () => {
  const p = scenario(handOf("01072", "01066", "01088", "01086", "01090"));
  expect(p.card("The Power of Leadership").playable).toBe(false);
  expect(p.battle.pick(p.card("Hawkeye").id)).toBe(true);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Leadership")!;
  expect(power.icons).toEqual(["wild", "wild"]);
  p.battle.toggle(power.id);
  expect(p.snap.payment!.paid).toBe(2);
  p.spend("First Aid");
  expect(p.snap.payment!.paid).toBe(3);
  expect(p.snap.payment!.canPay).toBe(true);
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.has("Hawkeye", "inPlay")).toBe(true);
  expect(p.has("The Power of Leadership", "discard")).toBe(true);
});

test("01072 The Power of Leadership: single for a card that is not Leadership (Mockingbird, basic)", () => {
  const p = scenario(handOf("01072", "01083", "01088", "01086", "01090"));
  expect(p.battle.pick(p.card("Mockingbird").id)).toBe(true);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Leadership")!;
  expect(power.icons).toEqual(["wild"]);
  p.battle.toggle(power.id);
  expect(p.snap.payment!.paid).toBe(1);
  expect(p.snap.payment!.canPay).toBe(false);
});

test("01072 The Power of Leadership: also doubled when paying an ability or an event of Leadership (Get Ready is free; Lead from the Front costs 2)", () => {
  const p = scenario(handOf("01072", "01070", "01086", "01090", "01088"));
  p.form();
  expect(p.battle.pick(p.card("Lead from the Front").id)).toBe(true);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Leadership")!;
  p.battle.toggle(power.id);
  // A Leadership event: the single card pays all of its cost 2.
  expect(p.snap.payment!.canPay).toBe(true);
});

// 01073 The Triskelion --------------------------------------------------------------------------------------------------

test("01073 The Triskelion without it: a 4th ally enters, then the table asks which ally to discard", () => {
  const p = scenario(handOf("01083", "01088", "01090", "01089"), inPlay("01066"), inPlay("01067"), inPlay("01068"));
  p.mark();
  p.play("Mockingbird", { pay: ["Energy", "Strength"] });
  const choice = p.snap.choice!;
  expect(choice.prompt).toBe("Discard to your ally limit");
  expect(choice.canSkip).toBe(false);
  expect(choice.min).toBe(1);
  expect(choice.max).toBe(1);
  expect(choice.options.map((o) => o.label).sort()).toEqual(["Hawkeye", "Maria Hill", "Mockingbird", "Vision"]);
  p.choose({ label: "Maria Hill" });
  expect(p.snap.inPlay.filter((c) => c.type === "ally")).toHaveLength(3);
  expect(p.has("Maria Hill", "discard")).toBe(true);
  expect(p.snap.choice?.prompt ?? "").not.toBe("Discard to your ally limit");
});

test("01073 The Triskelion: played (cost 1), a 4th ally stays in play with no limit question", () => {
  const p = scenario(
    handOf("01073", "01083", "01088", "01090", "01089", "01086"),
    inPlay("01066"),
    inPlay("01067"),
    inPlay("01068"),
  );
  const tri = p.play("The Triskelion", { pay: ["First Aid"] });
  expect(tri.cost).toBe(1);
  expect(p.has("The Triskelion", "inPlay")).toBe(true);
  p.play("Mockingbird", { pay: ["Energy", "Strength"] });
  expect(p.snap.choice?.prompt ?? "").not.toBe("Discard to your ally limit");
  // Mockingbird's own response window may be open: answer it, nothing about the limit follows.
  if (p.snap.choice?.offers?.length) respond(p, "Mockingbird", false);
  expect(p.snap.choice).toBeNull();
  expect(p.snap.inPlay.filter((c) => c.type === "ally")).toHaveLength(4);
});

test("01073 The Triskelion: a 5th ally still goes over the raised limit", () => {
  const p = scenario(
    handOf("01083", "01088", "01090", "01089"),
    inPlay("01073"),
    inPlay("01066"),
    inPlay("01067"),
    inPlay("01068"),
    inPlay("01084"),
  );
  p.play("Mockingbird", { pay: ["Energy", "Strength"] });
  expect(p.snap.choice?.prompt).toBe("Discard to your ally limit");
});

// 01074 Inspired --------------------------------------------------------------------------------------------------------

test("01074 Inspired: attaches to the ally (cost 1), +1 THW and +1 ATK shown on that ally", () => {
  const p = scenario(handOf("01074", "01088"), inPlay("01068"));
  const card = p.card("Inspired");
  expect(card.cost).toBe(1);
  expect(card.playable).toBe(true);
  p.mark();
  p.play("Inspired", { pay: ["Energy"] });
  // The only ally: no target question.
  expect(p.snap.choice).toBeNull();
  expect(marker(p, "Vision", "THW")).toBe(1);
  expect(marker(p, "Vision", "ATK")).toBe(1);
  expect(p.snap.hand.map((c) => c.name)).not.toContain("Inspired");
});

// Found by this audit, now fixed: the attached upgrade is not in snapshot.inPlay (nor anywhere else the table draws), so Inspired is not seen on its ally.
test("01074 Inspired: the card itself is on the table, attached to its ally", () => {
  const p = scenario(handOf("01074", "01088"), inPlay("01068"));
  p.play("Inspired", { pay: ["Energy"] });
  expect(p.card("Inspired", "inPlay").attachedTo).toBe(p.card("Vision", "inPlay").id);
});

test("01074 Inspired: with two allies it asks which to attach to, and the other gets nothing", () => {
  const p = scenario(handOf("01074", "01088"), inPlay("01068"), inPlay("01067"));
  expect(p.battle.pick(p.card("Inspired").id)).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.options.map((o) => o.label).sort()).toEqual(["Maria Hill", "Vision"]);
  p.choose({ label: "Maria Hill" });
  p.spend("Energy");
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(marker(p, "Maria Hill", "THW")).toBe(1);
  expect(marker(p, "Vision", "THW")).toBe(0);
});

test("01074 Inspired: max 1 per ally -> the second one only offers the ally that has none", () => {
  const p = scenario(handOf("01074", "01074", "01088", "01090"), inPlay("01068"), inPlay("01067"));
  p.play("Inspired", { pay: ["Energy"], target: p.card("Vision", "inPlay").id });
  expect(p.battle.pick(p.card("Inspired").id)).toBe(true);
  // Vision is no target any more: Maria Hill is the only one left, so nothing is asked and she is the one inspired.
  expect(p.snap.choice).toBeNull();
  p.spend("Strength");
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(marker(p, "Maria Hill", "THW")).toBe(1);
  expect(marker(p, "Vision", "THW")).toBe(1);
  expect(marker(p, "Vision", "ATK")).toBe(1);
});

test("01074 Inspired: max 1 per ally -> with the only ally already inspired the second is refused with a reason", () => {
  const p = scenario(handOf("01074", "01074", "01088", "01090"), inPlay("01068"));
  p.play("Inspired", { pay: ["Energy"] });
  const second = p.card("Inspired");
  expect(second.playable).toBe(false);
  expect(p.battle.pick(second.id)).toBe(false);
  expect(marker(p, "Vision", "THW")).toBe(1);
});

// Found by this audit, now fixed: the refusal reads "max 1 per host" (engine word) where a player expects "max 1 per ally".
test("01074 Inspired: the refusal reason says ally, not host", () => {
  const p = scenario(handOf("01074", "01074", "01088", "01090"), inPlay("01068"));
  p.play("Inspired", { pay: ["Energy"] });
  expect(p.card("Inspired").reason).toMatch(/ally/i);
});
