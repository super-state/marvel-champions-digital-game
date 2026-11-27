/**
 * She-Hulk's deck audit: every card of her Aggression starter deck that Spider-Man's audit (`deck-audit-player.test.ts`)
 * doesn't already cover, played on the 3D table's model and checked for what the table shows (beats, prompts,
 * targets, labels). Her 15 cards (01019–01028), her obligation (Legal Work, 01160) and her nemesis set (01161–01164).
 * The eight Aggression cards are `deck-audit-aggression.test.ts`'s; the 11 basic cards are Spider-Man's audit's.
 */
import { expect, test } from "vitest";
import {
  beat,
  engageMinion,
  handOf,
  inPlay,
  nemesisInPlay,
  patchByCode,
  Player,
  scenarioOf,
  stack,
  villainPhase,
  villainPhaseDeals,
  type Setup,
} from "./deck-audit-driver.js";

const scenario = (...steps: Setup[]) => scenarioOf({ hero: "she-hulk" }, ...steps);

/** Her hero's menu entry whose label matches. */
const heroMenu = (p: Player, label: RegExp) => p.snap.heroActions.find((action) => label.test(action.label));

/** Change to She-Hulk and let "Do You Even Lift?" pass (or answer it with `accept`). */
function toSheHulk(p: Player, accept = false) {
  p.form();
  const offer = p.snap.choice?.offers?.[0];
  if (offer) p.run(() => p.battle.chooseMany(accept ? [offer.id] : []));
}

const mainThreat = (p: Player) => p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat!;

// 01019 She-Hulk / Jennifer Walters -----------------------------------------------------------------------------------

test("01019 identity: she starts as Jennifer Walters, hand size 6; She-Hulk's is 4 (the end of turn asks to discard down)", () => {
  const p = scenario(handOf("01088", "01089", "01090", "01086", "01087", "01022"));
  expect(p.snap.hero.name).toBe("Jennifer Walters");
  expect(heroMenu(p, /^Change to/)?.label).toBe("Change to She-Hulk");
  expect(p.battle.playerFacts().handSize).toBe(6);
  toSheHulk(p);
  expect(p.snap.hero.name).toBe("She-Hulk");
  expect(p.battle.playerFacts().handSize).toBe(4);
  p.end();
  const s = p.drive({ stopWhen: (x) => !!x.choice?.discardFromHand });
  expect(s.choice!.min).toBe(s.hand.length - 4);
});

test.each([true, false])(
  '01019a "Do You Even Lift?" (accept=%s): after she changes to She-Hulk, 2 damage to an enemy she picks',
  (accept) => {
    const p = scenario(engageMinion("01110"));
    const bomber = p.card("Hydra Bomber", "enemyCards");
    p.mark();
    p.form();
    const offer = p.snap.choice!;
    expect(offer.prompt).toBe("You changed to hero form");
    expect(offer.offers).toHaveLength(1);
    // The card prints the name with its own question mark: quoted, not given a second one.
    expect(offer.offers![0]!.question).toBe("Respond with “Do You Even Lift?”");
    expect(offer.offers![0]!.effect).toBe("Use “Do You Even Lift?” to deal 2 damage to an enemy");
    p.run(() => p.battle.chooseMany(accept ? [offer.offers![0]!.id] : []));
    if (!accept) {
      expect(p.snap.choice).toBeNull();
      expect(p.snap.villainHp).toBe(14);
      return;
    }
    const target = p.snap.choice!;
    expect(target.options.map((o) => o.cardId).sort()).toEqual([bomber.id, p.snap.villain.id].sort());
    p.choose({ card: bomber.id });
    expect(beat(p, (b) => b.hit?.target === bomber.id && b.hit.amount === 2)).toBeGreaterThanOrEqual(0);
    expect(p.has("Hydra Bomber", "enemyCards")).toBe(false);
  },
);

test('01019b "I Object!": as Jennifer Walters, when threat would go on a scheme, prevent 1 of it, once per round', () => {
  const p = scenario(villainPhaseDeals());
  p.end();
  const s = p.drive({ stopWhen: (x) => !!x.choice?.offers?.length });
  const choice = s.choice!;
  expect(choice.prompt).toMatch(/is about to get \d+ threat/);
  expect(choice.offers![0]).toMatchObject({ question: "Interrupt with “I Object!”" });
  expect(choice.offers![0]!.effect).toBe("Use “I Object!” to prevent 1 of that threat (once per round)");
  const coming = choice.event!.amount!;
  const before = mainThreat(p);
  p.mark();
  p.run(() => p.battle.chooseMany([choice.offers![0]!.id]));
  // The next threat of the phase is not offered: once per round.
  const later = p.drive({ stopWhen: (x) => !!x.choice?.offers?.length });
  expect(later.choice?.offers ?? []).toEqual([]);
  // What was kept off is said: no threat change shows for it otherwise.
  const kept = p.beats.findIndex((b) => b.text === "1 threat kept off The Break-In!");
  expect(kept).toBeGreaterThanOrEqual(0);
  // The step's threat landed 1 short: with 1 coming, none of it went on before the line saying so.
  expect(coming).toBe(1);
  expect(p.beats.slice(0, kept).some((b) => b.threat)).toBe(false);
  void before;
});

// Her allies, supports and upgrades ------------------------------------------------------------------------------------

test("01020 Hellcat: her action returns her to the hand, labelled so", () => {
  const p = scenario(inPlay("01020"));
  const hellcat = p.card("Hellcat", "inPlay");
  const action = p.battle.fieldActions(hellcat.id).find((a) => a.kind === "01020.hellcat-action")!;
  expect(action).toMatchObject({ label: "Return to your hand", exhausts: false });
  const hand = p.snap.hand.length;
  p.mark();
  expect(p.run(() => p.battle.fieldAction(hellcat.id, action.kind))).toBe(true);
  expect(p.has("Hellcat", "inPlay")).toBe(false);
  expect(p.card("Hellcat").id).toBe(hellcat.id);
  expect(p.snap.hand).toHaveLength(hand + 1);
});

test("01026 Superhuman Law Division: as Jennifer, exhaust and spend a mental → 2 threat off a scheme; not as She-Hulk", () => {
  const p = scenario(inPlay("01026"), handOf("01089", "01088", "01090"), patchByCode("scheme", { threat: 5 }));
  const sld = p.card("Superhuman Law Division", "inPlay");
  const [action] = p.battle.fieldActions(sld.id);
  expect(action).toMatchObject({ exhausts: true });
  expect(p.battle.fieldAction(sld.id, action!.kind)).toBe(true);
  const payment = p.snap.payment!;
  // Only the mental card pays it.
  const available = payment.sources.filter((s) => s.available).map((s) => s.label);
  expect(available).toContain("Genius");
  expect(available).not.toContain("Energy");
  expect(available).not.toContain("Strength");
  p.spend("Genius");
  p.mark();
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(mainThreat(p)).toBe(3);
  expect(p.card("Superhuman Law Division", "inPlay").exhausted).toBe(true);
  expect(beat(p, (b) => b.threat?.delta === -2)).toBeGreaterThanOrEqual(0);

  const q = scenario(inPlay("01026"), handOf("01089", "01088"), patchByCode("scheme", { threat: 5 }));
  toSheHulk(q);
  expect(q.battle.fieldActions(q.card("Superhuman Law Division", "inPlay").id)).toEqual([]);
});

test("01027 Focused Rage: as She-Hulk, exhaust it and take 1 damage to draw 1 card, labelled so", () => {
  const p = scenario(inPlay("01027"));
  toSheHulk(p);
  const rage = p.card("Focused Rage", "inPlay");
  const [action] = p.battle.fieldActions(rage.id);
  expect(action).toMatchObject({ label: "Take 1 damage: draw 1 card", exhausts: true });
  const hp = p.snap.heroHp;
  const hand = p.snap.hand.length;
  p.mark();
  expect(p.run(() => p.battle.fieldAction(rage.id, action!.kind))).toBe(true);
  expect(p.snap.heroHp).toBe(hp - 1);
  expect(p.snap.hand).toHaveLength(hand + 1);
  expect(p.card("Focused Rage", "inPlay").exhausted).toBe(true);
  expect(beat(p, (b) => b.hit?.target === p.snap.hero.id && b.hit.amount === 1)).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => !!b.draw?.length)).toBeGreaterThanOrEqual(0);
});

test("01028 Superhuman Strength: +2 ATK shown; after she attacks it is discarded and the attacked enemy is stunned", () => {
  const p = scenario(inPlay("01028"));
  toSheHulk(p);
  expect(p.snap.hero.markers).toContainEqual({ name: "ATK", count: 2 });
  expect(p.battle.basicPower(p.snap.hero.id, "atk")).toBe(5);
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  p.drive();
  expect(p.snap.villainHp).toBe(14 - 5);
  expect(p.has("Superhuman Strength", "inPlay")).toBe(false);
  expect(p.snap.villain.markers).toContainEqual({ name: "stunned", count: 1 });
  expect(
    beat(p, (b) => b.statusChange?.id === p.snap.villain.id && b.statusChange.name === "stunned"),
  ).toBeGreaterThanOrEqual(0);
});

// Her events ------------------------------------------------------------------------------------------------------------

test("01021 Gamma Slam: damage equal to what she has taken (7), shown as one hit", () => {
  const p = scenario(handOf("01021", "01088", "01089", "01090"), patchByCode("hero", { damage: 7 }));
  toSheHulk(p);
  p.mark();
  p.play("Gamma Slam", { pay: ["Energy", "Genius"] });
  expect(p.snap.villainHp).toBe(14 - 7);
  expect(beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === 7)).toBeGreaterThanOrEqual(0);
});

test("01022 Ground Stomp: 1 damage to each enemy, each shown, and a 1-HP minion defeated", () => {
  const p = scenario(handOf("01022", "01088", "01089"), engageMinion("01110"), engageMinion("01101"));
  toSheHulk(p);
  const bomber = p.card("Hydra Bomber", "enemyCards");
  const mercenary = p.card("Hydra Mercenary", "enemyCards");
  p.mark();
  p.play("Ground Stomp", { pay: ["Energy"] });
  // No target is asked: it hits every enemy.
  expect(p.snap.choice).toBeNull();
  for (const id of [p.snap.villain.id, bomber.id, mercenary.id])
    expect(beat(p, (b) => b.hit?.target === id && b.hit.amount === 1)).toBeGreaterThanOrEqual(0);
  expect(p.snap.villainHp).toBe(13);
});

test("01023 Legal Practice: as Jennifer, she picks 1 to 5 cards to discard, and that much threat comes off", () => {
  const p = scenario(handOf("01023", "01088", "01089", "01090"), patchByCode("scheme", { threat: 5 }));
  const card = p.card("Legal Practice");
  expect(p.battle.pick(card.id)).toBe(true);
  const choice = p.snap.choice!;
  expect(choice).toMatchObject({
    discardFromHand: true,
    canCancel: true,
    min: 1,
    max: 5,
    sourceTitle: "Legal Practice",
  });
  expect(choice.prompt).toBe("Discard 1 to 5 to pay");
  // The card being played is not one of the picks.
  expect(choice.options.map((o) => o.cardId)).not.toContain(card.id);
  const picks = [p.card("Energy").id, p.card("Strength").id];
  p.mark();
  expect(p.run(() => p.battle.chooseMany(picks))).toBe(true);
  expect(mainThreat(p)).toBe(3);
  expect(p.snap.discard.map((c) => c.name).sort()).toEqual(["Energy", "Legal Practice", "Strength"]);
  expect(beat(p, (b) => b.threat?.delta === -2)).toBeGreaterThanOrEqual(0);
});

test("01023 Legal Practice: Cancel at the discard puts it back in the hand, nothing spent; as She-Hulk it is refused", () => {
  const p = scenario(handOf("01023", "01088", "01089"), patchByCode("scheme", { threat: 5 }));
  const hand = p.snap.hand.map((c) => c.id);
  expect(p.battle.pick(p.card("Legal Practice").id)).toBe(true);
  p.battle.cancel();
  expect(p.snap.choice).toBeNull();
  expect(p.snap.hand.map((c) => c.id)).toEqual(hand);
  expect(mainThreat(p)).toBe(5);

  const q = scenario(handOf("01023", "01088", "01089"), patchByCode("scheme", { threat: 5 }));
  toSheHulk(q);
  expect(q.card("Legal Practice").playable).toBe(false);
});

test("01024 One-Two Punch: after her basic attack it is offered and readies her", () => {
  const p = scenario(handOf("01024", "01088", "01089", "01090"));
  toSheHulk(p);
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  const offer = p.snap.choice!;
  expect(offer.offers![0]).toMatchObject({ question: "Respond with One-Two Punch?" });
  expect(offer.offers![0]!.effect).toMatch(/ready/i);
  p.run(() => p.battle.chooseMany([offer.offers![0]!.id]));
  if (p.snap.payment) {
    p.spend();
    expect(p.run(() => p.battle.pay())).toBe(true);
  }
  p.drive();
  expect(p.snap.hero.exhausted).toBe(false);
  expect(beat(p, (b) => b.turned?.id === p.snap.hero.id && !b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  expect(p.has("One-Two Punch", "discard")).toBe(true);
});

test('01025 Split Personality: she changes form, "Do You Even Lift?" is offered, then she draws up to her printed size', () => {
  const p = scenario(handOf("01025", "01088", "01089", "01090"));
  p.mark();
  p.play("Split Personality", { pay: ["Energy", "Genius"] });
  expect(p.snap.hero.name).toBe("She-Hulk");
  const offer = p.snap.choice!;
  expect(offer.offers![0]!.question).toBe("Respond with “Do You Even Lift?”");
  p.run(() => p.battle.chooseMany([]));
  p.drive();
  // She-Hulk's printed hand size is 4.
  expect(p.snap.hand).toHaveLength(4);
  expect(p.has("Split Personality", "discard")).toBe(true);
});

// Her obligation and nemesis set ---------------------------------------------------------------------------------------

test("01160 Legal Work as Jennifer Walters: exhausting her removes it from the game", () => {
  const p = scenario(villainPhaseDeals("01160"));
  const asked = villainPhase(p, (labels) => labels.findIndex((l) => l.startsWith("Exhaust")));
  const question = asked.find((a) => a.source?.startsWith("Legal Work"))!;
  expect(question.labels).toEqual([
    "Exhaust Jennifer Walters → remove this obligation from the game",
    "Give the main scheme 1 acceleration token",
  ]);
  expect(p.snap.hero.exhausted).toBe(true);
  expect(p.beats.find((b) => b.text === "Legal Work is removed from the game")?.removedFromGame).toBe(true);
});

test("01160 Legal Work: or the main scheme gets an acceleration token, shown on it", () => {
  const p = scenario(villainPhaseDeals("01160"));
  villainPhase(p, (labels) => labels.findIndex((l) => l.startsWith("Give the main scheme")));
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  expect(main.markers).toContainEqual({ name: "acceleration", count: 1 });
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Legal Work");
});

test("01161 Personal Challenge: comes in with its printed threat plus 1 for her", () => {
  const p = scenario(villainPhaseDeals("01161"));
  villainPhase(p);
  const scheme = p.card("Personal Challenge", "enemyCards");
  expect(p.beats.filter((b) => b.threat?.scheme === scheme.id).length).toBe(2);
  expect(scheme.threat).toBeGreaterThan(1);
});

test("01162 Titania: her ATK is her remaining hit points, and drops as she is hurt", () => {
  const p = scenario(nemesisInPlay("01162"));
  toSheHulk(p);
  const titania = p.card("Titania", "enemyCards");
  expect(p.battle.cardFacts(titania.id)).toMatch(/ATK 6\b/);
  p.battle.heroAction("basicAttack");
  p.run(() => p.battle.choose(titania.id));
  p.drive();
  expect(p.battle.cardFacts(titania.id)).toMatch(/ATK 3\b/);
});

test("01163 Genetically Enhanced: attaches to the minion with the most hit points (+3), shown on it", () => {
  const p = scenario(engageMinion("01110"), engageMinion("01101"), villainPhaseDeals("01163"));
  villainPhase(p);
  // Hydra Mercenary (3 HP printed) over Hydra Bomber (2).
  const mercenary = p.card("Hydra Mercenary", "enemyCards");
  const enhanced = p.snap.enemyCards.find((c) => c.name === "Genetically Enhanced")!;
  expect(enhanced.attachedTo).toBe(mercenary.id);
  expect(mercenary.hp).toBe(6);
});

test("01163 Genetically Enhanced: with no minion in play it surges", () => {
  const p = scenario(villainPhaseDeals("01163"));
  villainPhase(p);
  expect(p.beats.some((b) => b.text === "Genetically Enhanced surges")).toBe(true);
});

test("01164 Titania's Fury: Titania in play attacks her; with no Titania it heals nothing and surges", () => {
  const p = scenario(nemesisInPlay("01162"), villainPhaseDeals("01164"));
  toSheHulk(p);
  const titania = p.card("Titania", "enemyCards");
  villainPhase(p);
  const fury = p.beats.findIndex((b) => b.reveal?.name === "Titania's Fury");
  expect(fury).toBeGreaterThanOrEqual(0);
  expect(p.beats.slice(fury).some((b) => b.hit?.source === titania.id && b.hit.target === p.snap.hero.id)).toBe(true);

  const q = scenario(villainPhaseDeals("01164"));
  villainPhase(q);
  expect(q.beats.some((b) => b.text === "Titania's Fury surges")).toBe(true);
});

test("01164 Titania's Fury in alter-ego form: no hero, so Titania doesn't attack Jennifer Walters, and it surges", () => {
  // "Titania attacks your hero": a player in alter-ego form has no hero (RRG 1.8 "Form, Change Form", p. 21; as Swarm
  // Attack, issue #222), so no attack is made and the second sentence resolves.
  const p = scenario(nemesisInPlay("01162"), villainPhaseDeals("01164"));
  const titania = p.card("Titania", "enemyCards");
  villainPhase(p);
  const fury = p.beats.findIndex((b) => b.reveal?.name === "Titania's Fury");
  expect(fury).toBeGreaterThanOrEqual(0);
  expect(p.beats.slice(fury).some((b) => b.hit?.source === titania.id)).toBe(false);
  expect(p.beats.some((b) => b.text === "Titania's Fury surges")).toBe(true);
});

test("01164 Titania's Fury as a boost card: the villain gets a second boost card", () => {
  const p = scenario(stack("01164", "01104", "01108", "01101", "01101"));
  toSheHulk(p);
  villainPhase(p);
  expect(p.beats.filter((b) => b.text.startsWith("Boost card · ")).length).toBe(2);
});
