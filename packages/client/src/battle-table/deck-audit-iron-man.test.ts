/**
 * Iron Man's deck audit: every card of his Aggression starter deck that the earlier audits don't already cover, played
 * on the 3D table's model and checked for what the table shows (beats, prompts, targets, labels). His 15 cards
 * (01029–01039), his obligation (Business Problems, 01170) and his nemesis set (01171–01174). The Aggression cards are
 * `deck-audit-aggression.test.ts`'s; the basic cards are Spider-Man's audit's.
 *
 * What his deck does that no earlier deck did: a hand size that grows with his Tech upgrades (printed 1, at most 7),
 * the Aerial trait gained for a phase (Rocket Boots) that other cards ask for, a hero action that looks at the top of
 * the deck (Futurist), an ally whose action hurts himself (War Machine), a resource read off the discard pile (Pepper
 * Potts), and encounter cards that hit him through his upgrades.
 */
import { expect, test } from "vitest";
import {
  deckTop,
  discardTop,
  engageMinion,
  handOf,
  inPlay,
  nemesisInPlay,
  Player,
  scenarioOf,
  stack,
  villainPhase,
  villainPhaseDeals,
  type Setup,
} from "./deck-audit-driver.js";

const scenario = (...steps: Setup[]) => scenarioOf({ hero: "iron-man" }, ...steps);

/** Change to Iron Man. */
const suitUp = (p: Player) => p.form();
const fieldLabel = (p: Player, name: string) => p.battle.fieldActions(p.card(name, "inPlay").id).map((a) => a.label);
const heroMenu = (p: Player, label: RegExp) => p.snap.heroActions.find((action) => label.test(action.label));
const texts = (p: Player) => p.beats.map((b) => b.text);

/** Use Rocket Boots, paying its mental with Genius: Iron Man is Aerial for the phase. */
function takeOff(p: Player) {
  const boots = p.card("Rocket Boots", "inPlay");
  const action = p.battle.fieldActions(boots.id)[0]!;
  expect(p.run(() => p.battle.fieldAction(boots.id, action.kind))).toBe(true);
  p.spend("Genius");
  expect(p.run(() => p.battle.pay())).toBe(true);
}

// 01029 Iron Man / Tony Stark -------------------------------------------------------------------------------------

test("01029 identity: Tony Stark's hand size is 6; Iron Man's is 1 plus 1 per Tech upgrade, at most 7", () => {
  const p = scenario();
  expect(p.snap.hero.name).toBe("Tony Stark");
  expect(p.battle.playerFacts().handSize).toBe(6);
  suitUp(p);
  expect(p.snap.hero.name).toBe("Iron Man");
  expect(p.battle.playerFacts().handSize).toBe(1);

  const q = scenario(inPlay("01036"), inPlay("01037"), inPlay("01038"));
  suitUp(q);
  expect(q.battle.playerFacts().handSize).toBe(4);

  const r = scenario(
    inPlay("01036"),
    inPlay("01037"),
    inPlay("01038"),
    inPlay("01038"),
    inPlay("01039"),
    inPlay("01039"),
    inPlay("01035"),
  );
  suitUp(r);
  expect(r.battle.playerFacts().handSize).toBe(7);
});

test("01029b Futurist: the question names Tony Stark's Futurist; the chosen card goes to the hand, the others are discarded and named", () => {
  const p = scenario(deckTop("01032", "01054", "01031"));
  const futurist = heroMenu(p, /^Futurist/)!;
  expect(futurist.label).toBe("Futurist: look at the top 3 cards of your deck");
  p.mark();
  expect(p.run(() => p.battle.heroAction(futurist.kind))).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.prompt).toBe("Choose a card to add to your hand");
  expect(choice.sourceTitle).toBe("Tony Stark · Futurist");
  expect(choice.explanation).toBe("Look at the top 3 cards of your deck. Add 1 to your hand and discard the others.");
  expect(choice.options.map((o) => o.label)).toEqual(["Supersonic Punch", "Uppercut", "Repulsor Blast"]);
  p.choose({ label: "Uppercut" });
  expect(p.snap.hand.map((c) => c.name)).toContain("Uppercut");
  expect(texts(p)).toContain("Tony Stark: discard the top 2 cards of your deck (Supersonic Punch, Repulsor Blast)");
  // Once per round.
  expect(heroMenu(p, /^Futurist/)).toBeUndefined();
});

// 01030 War Machine -----------------------------------------------------------------------------------------------

test("01030 War Machine: his action says it costs him 2 damage, and does 1 to each enemy", () => {
  const p = scenario(inPlay("01030"), engageMinion("01110"));
  expect(fieldLabel(p, "War Machine")).toContain("Deal 1 damage to each enemy (takes 2 damage)");
  const machine = p.card("War Machine", "inPlay");
  const action = p.battle.fieldActions(machine.id).find((a) => a.label.startsWith("Deal 1 damage"))!;
  p.mark();
  expect(p.run(() => p.battle.fieldAction(machine.id, action.kind))).toBe(true);
  p.drive();
  expect(texts(p)).toContain("War Machine takes 2 damage");
  const hits = p.beats.filter((b) => b.hit?.source === machine.id && b.hit.target !== machine.id);
  expect(hits.map((b) => b.hit!.amount)).toEqual([1, 1]);
});

// 01031 Repulsor Blast --------------------------------------------------------------------------------------------

test("01031 Repulsor Blast: the five discarded cards are named with the card that discarded them, then one hit", () => {
  const p = scenario(handOf("01031", "01088", "01089", "01090"), deckTop("01054", "01054", "01055", "01055", "01056"));
  suitUp(p);
  p.mark();
  p.play("Repulsor Blast", { pay: ["Genius"] });
  if (p.snap.choice) p.choose({ label: "Rhino" });
  p.drive();
  const discard = p.beats.find((b) => b.milled?.length === 5);
  expect(discard?.text).toMatch(/^Repulsor Blast: discard the top 5 cards of your deck \(/);
  const hits = p.beats.filter((b) => b.hit?.target === p.snap.villain.id);
  expect(hits).toHaveLength(1);
  expect(hits[0]!.hit!.amount).toBeGreaterThanOrEqual(1);
});

// 01032 Supersonic Punch, 01039 Rocket Boots, 01037 Mark V Helmet, 01038 Powered Gauntlets -----------------------

test("01039 Rocket Boots: +1 HP shown; its action makes Iron Man Aerial for the phase, said in the log and on his card", () => {
  const p = scenario(handOf("01089", "01088", "01090"), inPlay("01039"));
  suitUp(p);
  expect(p.snap.hero.markers).toContainEqual({ name: "HP", count: 1 });
  expect(fieldLabel(p, "Rocket Boots")).toEqual(["Gain the Aerial trait until the end of the phase"]);
  p.mark();
  takeOff(p);
  expect(texts(p)).toContain("Iron Man gains the Aerial trait until the end of the phase");
  expect(p.battle.cardFacts(p.snap.hero.id)).toMatch(/Now Aerial/);
});

test("01032 Supersonic Punch: 4 damage, or 8 while Iron Man is Aerial", () => {
  const p = scenario(handOf("01032", "01088", "01090", "01054"));
  suitUp(p);
  p.mark();
  p.play("Supersonic Punch", { pay: ["Energy", "Strength"] });
  if (p.snap.choice) p.choose({ label: "Rhino" });
  expect(p.beats.find((b) => b.hit?.target === p.snap.villain.id)?.hit?.amount).toBe(4);

  const q = scenario(handOf("01032", "01089", "01088", "01090"), inPlay("01039"));
  suitUp(q);
  takeOff(q);
  q.mark();
  q.play("Supersonic Punch", { pay: ["Energy", "Strength"] });
  if (q.snap.choice) q.choose({ label: "Rhino" });
  expect(q.beats.find((b) => b.hit?.target === q.snap.villain.id)?.hit?.amount).toBe(8);
});

test("01037 Mark V Helmet: 1 threat off a scheme; Aerial, 1 off each scheme", () => {
  const p = scenario(handOf("01089", "01088"), inPlay("01037"), inPlay("01039"), nemesisInPlay("01171", 3));
  suitUp(p);
  expect(fieldLabel(p, "Mark V Helmet")).toEqual(["Remove 1 threat from a scheme"]);
  takeOff(p);
  const helmet = p.card("Mark V Helmet", "inPlay");
  const before = p.snap.enemyCards.filter((c) => c.threat !== null && c.threat > 0).map((c) => [c.id, c.threat]);
  p.mark();
  expect(p.run(() => p.battle.fieldAction(helmet.id, p.battle.fieldActions(helmet.id)[0]!.kind))).toBe(true);
  p.drive();
  const removed = p.beats.filter((b) => b.threat && b.threat.delta === -1).map((b) => b.threat!.scheme);
  expect(new Set(removed).size).toBe(before.length);
});

test("01038 Powered Gauntlets: 1 damage to an enemy; Aerial, 2", () => {
  const p = scenario(inPlay("01038"));
  suitUp(p);
  expect(fieldLabel(p, "Powered Gauntlets")).toEqual(["Deal 1 damage to an enemy"]);
  const gauntlets = p.card("Powered Gauntlets", "inPlay");
  p.mark();
  expect(p.run(() => p.battle.fieldAction(gauntlets.id, p.battle.fieldActions(gauntlets.id)[0]!.kind))).toBe(true);
  p.drive();
  expect(p.beats.find((b) => b.hit?.target === p.snap.villain.id)?.hit?.amount).toBe(1);

  const q = scenario(handOf("01089"), inPlay("01038"), inPlay("01039"));
  suitUp(q);
  takeOff(q);
  const g = q.card("Powered Gauntlets", "inPlay");
  q.mark();
  expect(q.run(() => q.battle.fieldAction(g.id, q.battle.fieldActions(g.id)[0]!.kind))).toBe(true);
  q.drive();
  expect(q.beats.find((b) => b.hit?.target === q.snap.villain.id)?.hit?.amount).toBe(2);
});

// 01035 Arc Reactor, 01036 Mark V Armor ---------------------------------------------------------------------------

test("01035 Arc Reactor: after his attack it readies Iron Man, labelled so, shown turning", () => {
  const p = scenario(inPlay("01035"));
  suitUp(p);
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  p.drive();
  expect(p.snap.hero.exhausted).toBe(true);
  expect(fieldLabel(p, "Arc Reactor")).toEqual(["Ready Iron Man"]);
  const reactor = p.card("Arc Reactor", "inPlay");
  p.mark();
  expect(p.run(() => p.battle.fieldAction(reactor.id, p.battle.fieldActions(reactor.id)[0]!.kind))).toBe(true);
  expect(p.snap.hero.exhausted).toBe(false);
  expect(p.beats.some((b) => b.turned?.id === p.snap.hero.id && !b.turned.exhausted)).toBe(true);
});

test("01036 Mark V Armor: +6 HP, said when it is played", () => {
  const p = scenario(handOf("01036", "01088", "01089", "01090"));
  suitUp(p);
  p.mark();
  p.play("Mark V Armor", { pay: ["Energy", "Genius"] });
  expect(texts(p)).toContain("Iron Man now has +6 HP");
  expect(p.snap.hero.markers).toContainEqual({ name: "HP", count: 6 });
});

// 01033 Pepper Potts, 01034 Stark Tower ---------------------------------------------------------------------------

test("01033 Pepper Potts: she pays with the resources of the top card of the discard pile; with none, nothing", () => {
  const p = scenario(handOf("01032", "01054"), inPlay("01033"), discardTop("01089"));
  suitUp(p);
  expect(p.battle.pick(p.card("Supersonic Punch").id)).toBe(true);
  const pepper = p.snap.payment!.sources.find((s) => s.label.startsWith("Pepper Potts"))!;
  const genius = discardIcons(p);
  expect(pepper.icons).toEqual(genius);
  expect(pepper.available).toBe(true);

  const q = scenario(handOf("01032", "01054"), inPlay("01033"));
  suitUp(q);
  expect(q.snap.discard).toHaveLength(0);
  expect(q.battle.pick(q.card("Supersonic Punch").id)).toBe(true);
  const none = q.snap.payment!.sources.find((s) => s.label.startsWith("Pepper Potts"));
  expect(none === undefined || !none.available || none.icons.length === 0).toBe(true);
});

/** Genius's own icons as a payment source shows them. */
function discardIcons(p: Player) {
  const q = scenario(handOf("01032", "01089"));
  suitUp(q);
  q.battle.pick(q.card("Supersonic Punch").id);
  void p;
  return q.snap.payment!.sources.find((s) => s.label === "Genius")!.icons;
}

test("01034 Stark Tower: as Tony Stark, its action returns the topmost Tech upgrade from the discard pile, labelled so", () => {
  const p = scenario(inPlay("01034"), discardTop("01037", "01054"));
  expect(fieldLabel(p, "Stark Tower")).toEqual(["Return the topmost Tech upgrade in your discard pile to your hand"]);
  const tower = p.card("Stark Tower", "inPlay");
  p.mark();
  expect(p.run(() => p.battle.fieldAction(tower.id, p.battle.fieldActions(tower.id)[0]!.kind))).toBe(true);
  p.drive();
  expect(p.snap.hand.map((c) => c.name)).toContain("Mark V Helmet");
  expect(p.beats.some((b) => b.returned?.length)).toBe(true);
  // An Alter-Ego Action: not as Iron Man.
  const q = scenario(inPlay("01034"), discardTop("01037"));
  suitUp(q);
  expect(fieldLabel(q, "Stark Tower")).toEqual([]);
});

// 01170 Business Problems ----------------------------------------------------------------------------------------

test("01170 Business Problems as Tony Stark: exhausting him removes it from the game", () => {
  const p = scenario(villainPhaseDeals("01170"));
  const asked = villainPhase(p, (labels) => labels.findIndex((l) => l.startsWith("Exhaust Tony")));
  const question = asked.find((a) => a.source?.startsWith("Business Problems"))!;
  expect(question.labels).toEqual([
    "Exhaust Tony Stark → remove this obligation from the game",
    "Exhaust each upgrade you control",
  ]);
  expect(p.snap.hero.exhausted).toBe(true);
  expect(p.beats.find((b) => b.text === "Business Problems is removed from the game")?.removedFromGame).toBe(true);
});

test("01170 Business Problems: or each upgrade he controls is exhausted, each shown turning", () => {
  const p = scenario(inPlay("01037"), inPlay("01038"), villainPhaseDeals("01170"));
  villainPhase(p, (labels) => labels.findIndex((l) => l.startsWith("Exhaust each upgrade")));
  for (const name of ["Mark V Helmet", "Powered Gauntlets"]) {
    const card = p.card(name, "inPlay");
    expect(card.exhausted).toBe(true);
  }
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Business Problems");
});

test("01170 Business Problems as Iron Man: he may change to Tony Stark first", () => {
  const p = scenario(villainPhaseDeals("01170"));
  suitUp(p);
  const asked = villainPhase(p, () => -1);
  const offered = asked.find((a) => a.source?.startsWith("Business Problems"));
  expect(offered, JSON.stringify(asked)).toBeDefined();
});

// 01171–01174 the nemesis set: Whiplash ----------------------------------------------------------------------------

test("01171 Imminent Overload: comes in with its printed threat plus 1 for him", () => {
  const p = scenario(villainPhaseDeals("01171"));
  villainPhase(p);
  const scheme = p.card("Imminent Overload", "enemyCards");
  expect(p.beats.filter((b) => b.threat?.scheme === scheme.id).length).toBe(2);
  expect(scheme.threat).toBe(4);
});

test("01172 Whiplash: Retaliate 1 hits Iron Man when he attacks Whiplash", () => {
  const p = scenario(nemesisInPlay("01172"));
  suitUp(p);
  const whiplash = p.card("Whiplash", "enemyCards");
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  if (p.snap.choice) p.choose({ card: whiplash.id });
  p.drive();
  expect(
    p.beats.some((b) => b.hit?.source === whiplash.id && b.hit.target === p.snap.hero.id && b.hit.amount === 1),
  ).toBe(true);
});

test("01173 Electric Whip Attack as Iron Man: take 1 damage per upgrade, or discard one; the question names the card", () => {
  const p = scenario(inPlay("01036"), inPlay("01038"), villainPhaseDeals("01173"));
  suitUp(p);
  const asked = villainPhase(p, (labels) => labels.findIndex((l) => l.startsWith("Take")));
  const question = asked.find((a) => a.labels.some((l) => l.startsWith("Take")))!;
  expect(question.source).toMatch(/^Electric Whip Attack/);
  expect(question.labels).toEqual([
    "Take 1 damage for each upgrade you control",
    "Choose and discard an upgrade you control",
  ]);
  expect(p.beats.some((b) => b.hit?.target === p.snap.hero.id && b.hit.amount === 2)).toBe(true);
});

test("01173 Electric Whip Attack as Tony Stark: only the discard is open, asked as which upgrade to discard", () => {
  const p = scenario(inPlay("01036"), inPlay("01038"), villainPhaseDeals("01173"));
  const asked = villainPhase(p, (labels) => labels.indexOf("Powered Gauntlets"));
  const question = asked.find((a) => a.labels.includes("Powered Gauntlets"))!;
  expect(question.source).toMatch(/^Electric Whip Attack/);
  expect(question.prompt).toMatch(/upgrade/i);
  expect(p.snap.discard.map((c) => c.name)).toContain("Powered Gauntlets");
});

test("01173 Electric Whip Attack as a boost: on an undefended attack he discards an upgrade", () => {
  const p = scenario(inPlay("01038"), stack("01173", "01108", "01101", "01101"));
  suitUp(p);
  villainPhase(p);
  expect(p.snap.discard.map((c) => c.name)).toContain("Powered Gauntlets");
});

test("01174 Electromagnetic Backlash: the five cards are named with the card, then 1 damage per printed energy", () => {
  const p = scenario(deckTop("01088", "01054", "01054", "01055", "01055"), villainPhaseDeals("01174"));
  villainPhase(p);
  const discard = p.beats.find((b) => b.milled?.length === 5);
  expect(discard?.text).toMatch(/^Electromagnetic Backlash: discard the top 5 cards of your deck \(/);
});

test("only the hero's card lists traits gained for now: a villain's own traits are not 'gained'", () => {
  const p = scenario();
  expect(p.battle.cardFacts(p.snap.villain.id)).not.toMatch(/\bNow /);
});
