/**
 * The Aggression cards of She-Hulk's starter deck (01050–01057), each played through the 3D table's model as a player
 * would (pick -> target -> payment -> pay, field actions, offers) and checked for what the table would show: beats,
 * counters and stat markers on cards, the choice prompt and its labels, the payment screen's sources, refusal reasons.
 */
import { expect, test } from "vitest";
import {
  beat,
  deckTop,
  engageMinion,
  handOf,
  inPlay,
  patchByCode,
  patchCard,
  scenarioOf,
  type Player,
  type Setup,
} from "./deck-audit-driver.js";

const scenario = (...steps: Setup[]) => scenarioOf({ hero: "she-hulk" }, ...steps);

/** She-Hulk in hero form, with "Do You Even Lift?" (her own response to the change) declined: it is not under test. */
function sheHulk(...steps: Setup[]) {
  const p = scenario(...steps);
  p.form();
  if (p.snap.choice?.offers?.length) expect(p.run(() => p.battle.chooseMany([]))).toBe(true);
  expect(p.snap.choice).toBeNull();
  return p;
}

/** Answer the reaction window's offer for `name` (accept), or decline everything. */
function respond(p: Player, name: string, accept: boolean) {
  const offer = p.snap.choice!.offers!.find((o) => o.question.includes(name))!;
  expect(offer, JSON.stringify(p.snap.choice)).toBeDefined();
  expect(p.run(() => p.battle.chooseMany(accept ? [offer.id] : []))).toBe(true);
}

const markerOf = (p: Player, name: string, m: string, where: "inPlay" | "enemyCards" = "inPlay") =>
  p.card(name, where).markers.find((x) => x.name === m)?.count ?? 0;
const damageOf = (p: Player, name: string, where: "inPlay" | "enemyCards" = "inPlay") =>
  markerOf(p, name, "damage", where);
const hits = (p: Player) => p.beats.filter((b) => b.hit).map((b) => b.hit!);
const optionLabels = (p: Player) => p.snap.choice!.options.map((o) => o.label);

// 01050 Hulk ------------------------------------------------------------------------------------------------------------

/** Hulk in play, `top` on top of the deck, hero form; Hulk attacks the villain (a Hydra Bomber is engaged too). */
function hulkAttacks(top: string, ...extra: Setup[]) {
  const p = sheHulk(inPlay("01050"), deckTop(top), engageMinion("01110"), ...extra);
  const hulk = p.card("Hulk", "inPlay");
  expect(p.battle.fieldActions(hulk.id).map((a) => a.label)).toContain("Attack");
  p.mark();
  expect(p.battle.fieldAction(hulk.id, "basicAttack")).toBe(true);
  expect(p.snap.choice!.prompt).toBe("Choose an enemy to attack");
  expect(optionLabels(p).sort()).toEqual(["Hydra Bomber", "Rhino"]);
  p.choose({ card: p.snap.villain.id });
  return { p, hulk };
}

test("01050 Hulk: his attack hits for 3, exhausts him, then shows the card milled by name", () => {
  const { p, hulk } = hulkAttacks("01054");
  expect(p.snap.villainHp).toBe(11);
  expect(beat(p, (b) => b.hit?.source === hulk.id && b.hit.target === p.snap.villain.id && b.hit.amount === 3)).toBe(0);
  expect(beat(p, (b) => b.turned?.id === hulk.id && b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  const milled = beat(p, (b) => !!b.milled?.length);
  expect(milled).toBeGreaterThan(0);
  expect(p.beats[milled]!.text).toBe("Hulk: discard the top card of your deck (Uppercut)");
  expect(p.beats[milled]!.millSource?.card).toBe(hulk.id);
  expect(p.has("Uppercut", "discard")).toBe(true);
  expect(p.card("Hulk", "inPlay").exhausted).toBe(true);
});

test("01050 Hulk physical (Uppercut milled): deals 2 damage to an enemy of the player's choice", () => {
  const { p } = hulkAttacks("01054");
  const choice = p.snap.choice!;
  expect(optionLabels(p)).toEqual(["Physical: deal 2 damage to an enemy"]);
  expect(p.snap.choiceSource && p.battle.cardName(p.snap.choiceSource)).toBe("Hulk");
  expect(choice.canSkip).toBe(false);
  p.choose({ label: /Physical/ });
  // Two enemies to pick from: the target is asked, naming both.
  expect(optionLabels(p).sort()).toEqual(["Hydra Bomber", "Rhino"]);
  const bomber = p.card("Hydra Bomber", "enemyCards");
  p.mark();
  p.choose({ card: bomber.id });
  expect(hits(p)).toContainEqual(expect.objectContaining({ target: bomber.id, amount: 2 }));
  // Hydra Bomber has 2 HP: it falls, after the hit is shown.
  expect(beat(p, (b) => b.defeatedCard === bomber.id)).toBeGreaterThan(beat(p, (b) => b.hit?.target === bomber.id));
  expect(p.has("Hydra Bomber", "enemyCards")).toBe(false);
  expect(p.snap.villainHp).toBe(11);
  expect(p.snap.choice).toBeNull();
  expect(p.has("Hulk", "inPlay")).toBe(true);
});

test("01050 Hulk physical: with Rhino the only enemy there is nothing to choose, the 2 damage lands on him", () => {
  const p = sheHulk(inPlay("01050"), deckTop("01054"));
  const hulk = p.card("Hulk", "inPlay");
  p.mark();
  p.battle.fieldAction(hulk.id, "basicAttack");
  expect(p.snap.villainHp).toBe(11);
  p.choose({ label: /Physical/ });
  expect(p.snap.choice).toBeNull();
  expect(p.snap.villainHp).toBe(9);
  expect(hits(p)).toContainEqual(expect.objectContaining({ target: p.snap.villain.id, amount: 2 }));
});

test("01050 Hulk physical (a resource card, Strength, milled): counts as a physical resource", () => {
  // Strength starts in her hand: handOf sends it back to the deck first.
  const p = sheHulk(handOf("01088", "01089", "01086", "01087", "01084", "01085"), inPlay("01050"), deckTop("01090"));
  p.battle.fieldAction(p.card("Hulk", "inPlay").id, "basicAttack");
  expect(p.has("Strength", "discard")).toBe(true);
  expect(optionLabels(p)).toEqual(["Physical: deal 2 damage to an enemy"]);
});

// With one result that applies, the engine still asks "Choose one" with that one option. Kept on purpose: the table
// never answers the engine's questions for the player, and the option's words say what the discarded card did.
test("01050 Hulk energy (Relentless Assault milled): 1 damage to each character, his own hero and himself included", () => {
  const { p, hulk } = hulkAttacks("01053");
  expect(optionLabels(p)).toEqual(["Energy: deal 1 damage to each character"]);
  p.mark();
  p.choose({ label: /Energy/ });
  const hero = p.snap.hero.id;
  const bomber = p.card("Hydra Bomber", "enemyCards");
  const landed = hits(p);
  for (const target of [hero, hulk.id, p.snap.villain.id, bomber.id]) {
    expect(landed, `a hit on ${target}`).toContainEqual(expect.objectContaining({ target, amount: 1 }));
  }
  // She-Hulk and Rhino and the minion take 1; Hulk 1 more than that for the consequential damage of his attack.
  expect(p.snap.hero.markers).toContainEqual({ name: "damage", count: 1 });
  expect(p.snap.villainHp).toBe(10);
  expect(damageOf(p, "Hydra Bomber", "enemyCards")).toBe(1);
  expect(damageOf(p, "Hulk")).toBe(2);
  // The schemes are not characters.
  expect(landed.filter((h) => h.target === p.snap.enemyCards.find((c) => c.type === "main_scheme")!.id)).toEqual([]);
  expect(p.snap.choice).toBeNull();
});

test("01050 Hulk mental (Chase Them Down milled): Hulk is discarded, and the table shows him leave", () => {
  const { p, hulk } = hulkAttacks("01052");
  expect(optionLabels(p)).toEqual(["Mental: discard Hulk"]);
  p.mark();
  p.choose({ label: /Mental/ });
  expect(p.has("Hulk", "inPlay")).toBe(false);
  expect(p.has("Hulk", "discard")).toBe(true);
  expect(
    beat(p, (b) => b.leftPlay === hulk.id || b.discardEvent === hulk.id || b.defeatedCard === hulk.id),
  ).toBeGreaterThanOrEqual(0);
  expect(p.snap.choice).toBeNull();
});

test("01050 Hulk mental (a resource card, Genius, milled): counts as a mental resource", () => {
  const { p } = hulkAttacks("01089");
  expect(optionLabels(p)).toEqual(["Mental: discard Hulk"]);
});

test("01050 Hulk wild (The Power of Aggression milled): all three results are offered to be ordered", () => {
  const { p } = hulkAttacks("01055");
  const choice = p.snap.choice!;
  expect(optionLabels(p).sort()).toEqual([
    "Energy: deal 1 damage to each character",
    "Mental: discard Hulk",
    "Physical: deal 2 damage to an enemy",
  ]);
  // The controller picks the order the results apply in (RRG 1.8 p. 61, Salvage): all three, one after the other.
  expect(choice.min).toBe(3);
  expect(choice.max).toBe(3);
  expect(choice.ordered).toBe(true);
});

test("01050 Hulk wild: in the order physical, energy, mental every result happens and Hulk ends in the discard pile", () => {
  const { p } = hulkAttacks("01055");
  const ids = ["Physical", "Energy", "Mental"].map(
    (w) => p.snap.choice!.options.find((o) => o.label.startsWith(w))!.id,
  );
  p.mark();
  expect(p.run(() => p.battle.chooseMany(ids))).toBe(true);
  // Physical asks for its target (Rhino or the minion); the later results wait for it.
  expect(p.snap.choice!.options.map((o) => o.label).sort()).toEqual(["Hydra Bomber", "Rhino"]);
  p.choose({ label: "Rhino" });
  // 14 - 3 (attack) - 2 (physical) - 1 (energy)
  expect(p.snap.villainHp).toBe(8);
  expect(damageOf(p, "Hydra Bomber", "enemyCards")).toBe(1);
  expect(p.snap.hero.markers).toContainEqual({ name: "damage", count: 1 });
  expect(p.has("Hulk", "discard")).toBe(true);
  expect(p.has("Hulk", "inPlay")).toBe(false);
  expect(p.snap.choice).toBeNull();
});

test("01050 Hulk wild: energy first can defeat Hulk himself, and the mental result then finds nothing to discard", () => {
  const { p } = hulkAttacks("01055", patchCard("01050", { damage: 3 }));
  const energy = p.snap.choice!.options.find((o) => o.label.startsWith("Energy"))!.id;
  const mental = p.snap.choice!.options.find((o) => o.label.startsWith("Mental"))!.id;
  const physical = p.snap.choice!.options.find((o) => o.label.startsWith("Physical"))!.id;
  p.mark();
  expect(p.run(() => p.battle.chooseMany([energy, mental, physical]))).toBe(true);
  // 3 damage + 1 consequential + 1 from his own energy result = 5 = his HP.
  expect(p.has("Hulk", "inPlay")).toBe(false);
  expect(p.has("Hulk", "discard")).toBe(true);
  if (p.snap.choice) p.choose({ label: "Rhino" });
  expect(p.snap.choice).toBeNull();
  expect(p.snap.villainHp).toBe(8);
});

test("01050 Hulk: an exhausted Hulk cannot attack, so the forced response never starts", () => {
  const p = sheHulk(inPlay("01050"), patchCard("01050", { exhausted: true }));
  expect(p.battle.fieldActions(p.card("Hulk", "inPlay").id)).toEqual([]);
});

test("01050 Hulk: played from the hand for 2 he enters ready, with no response window of his own", () => {
  const p = sheHulk(handOf("01050", "01088", "01089", "01090"));
  const hulk = p.card("Hulk");
  expect(hulk.cost).toBe(2);
  p.play("Hulk", { pay: ["Energy"] });
  expect(p.snap.choice).toBeNull();
  expect(p.card("Hulk", "inPlay").exhausted).toBe(false);
  expect(p.battle.fieldActions(p.card("Hulk", "inPlay").id).map((a) => a.label)).toContain("Attack");
});

// 01051 Tigra -----------------------------------------------------------------------------------------------------------

function tigraAttacks(target: "Hydra Bomber" | "Rhino" | "Hydra Mercenary", ...extra: Setup[]) {
  const p = sheHulk(inPlay("01051"), engageMinion("01110"), ...extra);
  const tigra = p.card("Tigra", "inPlay");
  p.mark();
  expect(p.battle.fieldAction(tigra.id, "basicAttack")).toBe(true);
  if (p.snap.choice) {
    const id = [...p.snap.enemyCards, p.snap.villain].find((c) => c.name === target)!.id;
    p.choose({ card: id });
  }
  return { p, tigra };
}

test("01051 Tigra: attacking and defeating a minion offers her response, which names her and says what it heals", () => {
  const { p, tigra } = tigraAttacks("Hydra Bomber");
  expect(p.has("Hydra Bomber", "enemyCards")).toBe(false);
  const choice = p.snap.choice!;
  expect(choice.offers).toHaveLength(1);
  expect(choice.offers![0]!.question).toBe("Respond with Tigra?");
  expect(choice.offers![0]!.effect).toMatch(/heal 1/i);
  expect(choice.canSkip).toBe(true);
  expect(choice.event).toMatchObject({ subject: tigra.id });
});

test("01051 Tigra: accepting heals 1 from her and the heal is shown", () => {
  // She already carries 1 damage (HP 3), so the heal has something to take off.
  const { p, tigra } = tigraAttacks("Hydra Bomber", patchCard("01051", { damage: 1 }));
  p.mark();
  respond(p, "Tigra", true);
  expect(
    beat(p, (b) => b.statusChange?.id === tigra.id && b.statusChange.name === "damage" && b.statusChange.delta === -1),
  ).toBeGreaterThanOrEqual(0);
  expect(p.snap.choice).toBeNull();
});

test("01051 Tigra: declining leaves her damage as it was", () => {
  const { p } = tigraAttacks("Hydra Bomber", patchCard("01051", { damage: 1 }));
  p.mark();
  respond(p, "Tigra", false);
  expect(p.beats.some((b) => b.statusChange?.name === "damage" && b.statusChange.delta < 0)).toBe(false);
});

// RRG v1.8 FAQ "Tigra/Greer Grant Nelson (#51)" p.58, "Consequential Damage" p.13 and "Attack" resolution order p.10:
// after-attack Responses resolve before the ally's consequential damage, so an undamaged Tigra heals nothing and ends
// the attack with 1 damage (checked by the rules-expert agent, 2026-11-25).
test("01051 Tigra: her heal resolves before her own attack's consequential damage, so she ends with 1 damage", () => {
  const { p } = tigraAttacks("Hydra Bomber");
  respond(p, "Tigra", true);
  expect(damageOf(p, "Tigra")).toBe(1);
});

test("01051 Tigra: an attack on the villain defeats nobody, so no response and she keeps her damage", () => {
  const { p } = tigraAttacks("Rhino");
  expect(p.snap.choice).toBeNull();
  expect(p.snap.villainHp).toBe(12);
  expect(damageOf(p, "Tigra")).toBe(1);
});

test("01051 Tigra: a minion that survives her hit (Hydra Mercenary, 3 HP) gives no response", () => {
  const p = sheHulk(inPlay("01051"), engageMinion("01101"));
  p.battle.fieldAction(p.card("Tigra", "inPlay").id, "basicAttack");
  if (p.snap.choice) p.choose({ card: p.card("Hydra Mercenary", "enemyCards").id });
  expect(p.snap.choice).toBeNull();
  expect(damageOf(p, "Hydra Mercenary", "enemyCards")).toBe(2);
});

test("01051 Tigra: it is her own attack that counts: the hero defeating a minion offers nothing from Tigra", () => {
  const p = sheHulk(inPlay("01051"), engageMinion("01110"));
  p.battle.heroAction("basicAttack");
  p.choose({ card: p.card("Hydra Bomber", "enemyCards").id });
  expect(p.snap.choice?.offers?.some((o) => o.question.includes("Tigra")) ?? false).toBe(false);
});

// 01052 Chase Them Down -------------------------------------------------------------------------------------------------

function chaseSetup(...extra: Setup[]) {
  return sheHulk(
    handOf("01052", "01088", "01089", "01090"),
    engageMinion("01110"),
    patchByCode("scheme", { threat: 5 }),
    ...extra,
  );
}

function heroKillsBomber(p: Player) {
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  p.choose({ card: p.card("Hydra Bomber", "enemyCards").id });
}

test("01052 Chase Them Down: in hand it is a cost 0 card, not playable on its own turn with nothing to respond to", () => {
  const p = chaseSetup();
  const card = p.card("Chase Them Down");
  expect(card.cost).toBe(0);
  expect(card.playable).toBe(false);
  expect(p.battle.pick(card.id)).toBe(false);
});

test("01052 Chase Them Down: after the hero defeats a minion the window offers it, naming the card and its effect", () => {
  const p = chaseSetup();
  heroKillsBomber(p);
  const choice = p.snap.choice!;
  expect(choice.offers).toHaveLength(1);
  expect(choice.offers![0]!.question).toBe("Respond with Chase Them Down?");
  expect(choice.offers![0]!.effect).toMatch(/remove 2 threat/i);
  expect(choice.canSkip).toBe(true);
});

test("01052 Chase Them Down: accepting is free, removes 2 threat from the main scheme (beat) and the event is discarded", () => {
  const p = chaseSetup();
  heroKillsBomber(p);
  const hand = p.snap.hand.length;
  p.mark();
  respond(p, "Chase Them Down", true);
  const main = p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
  expect(main.threat).toBe(3);
  expect(beat(p, (b) => b.threat?.scheme === main.id && b.threat.delta === -2)).toBeGreaterThanOrEqual(0);
  expect(p.has("Chase Them Down", "discard")).toBe(true);
  expect(p.snap.hand.length).toBe(hand - 1);
  expect(p.snap.payment).toBeNull();
  // A thwart response does not exhaust the hero (it exhausted for the attack already, and stays so).
  expect(p.snap.choice).toBeNull();
});

test("01052 Chase Them Down: declining keeps the card in hand and the threat where it was", () => {
  const p = chaseSetup();
  heroKillsBomber(p);
  respond(p, "Chase Them Down", false);
  expect(p.has("Chase Them Down", "hand")).toBe(true);
  expect(p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat).toBe(5);
});

test("01052 Chase Them Down: with only the main scheme in play nothing is asked which scheme to thwart", () => {
  const p = chaseSetup();
  heroKillsBomber(p);
  respond(p, "Chase Them Down", true);
  expect(p.snap.choice).toBeNull();
});

test("01052 Chase Them Down: a hit that does not defeat anyone offers nothing", () => {
  const p = chaseSetup();
  p.battle.heroAction("basicAttack");
  p.choose({ card: p.snap.villain.id });
  expect(p.snap.choice).toBeNull();
  expect(p.snap.villainHp).toBe(11);
});

test("01052 Chase Them Down: an ally's attack that defeats an enemy is not 'your hero attacks': no offer", () => {
  const p = chaseSetup(inPlay("01051"));
  p.battle.fieldAction(p.card("Tigra", "inPlay").id, "basicAttack");
  p.choose({ card: p.card("Hydra Bomber", "enemyCards").id });
  expect(p.snap.choice?.offers?.some((o) => o.question.includes("Chase Them Down")) ?? false).toBe(false);
});

test("01052 Chase Them Down: an attack event of the hero (Uppercut) that defeats a minion offers it too", () => {
  const p = sheHulk(
    handOf("01052", "01054", "01088", "01090", "01089"),
    engageMinion("01110"),
    patchByCode("scheme", { threat: 5 }),
  );
  p.play("Uppercut", { pay: ["Strength", "Energy"] });
  if (p.snap.choice && !p.snap.choice.offers) p.choose({ card: p.card("Hydra Bomber", "enemyCards").id });
  expect(p.snap.choice?.offers?.some((o) => o.question.includes("Chase Them Down"))).toBe(true);
});

// 01053 Relentless Assault ----------------------------------------------------------------------------------------------

test("01053 Relentless Assault: refused with a reason while there is no minion to hit", () => {
  const p = sheHulk(handOf("01053", "01088", "01089", "01090"));
  const card = p.card("Relentless Assault");
  expect(card.playable).toBe(false);
  expect(card.reason).toMatch(/minion|target/i);
  expect(p.battle.pick(card.id)).toBe(false);
});

test("01053 Relentless Assault: hero form only, refused as Jennifer Walters with the reason", () => {
  const p = scenario(handOf("01053", "01088", "01089", "01090"), engageMinion("01110"));
  const card = p.card("Relentless Assault");
  expect(card.requiresHeroForm).toBe(true);
  expect(card.playable).toBe(false);
  expect(card.reason).toBe("this event requires hero form");
});

test("01053 Relentless Assault: costs 2 and either an energy or a physical resource pays it (sources on the payment screen)", () => {
  const p = sheHulk(handOf("01053", "01088", "01090", "01089", "01086"), engageMinion("01110"));
  const card = p.card("Relentless Assault");
  expect(card.cost).toBe(2);
  expect(card.playable).toBe(true);
  expect(p.battle.pick(card.id)).toBe(true);
  const payment = p.snap.payment!;
  expect(payment.required).toBe(2);
  expect(payment.sources.filter((s) => s.available).map((s) => s.label)).toEqual(
    expect.arrayContaining(["Energy", "First Aid", "Genius", "Strength"]),
  );
  expect(payment.sources.find((s) => s.label === "Strength")!.icons).toEqual(["physical", "physical"]);
  expect(payment.sources.find((s) => s.label === "Energy")!.icons).toEqual(["energy", "energy"]);
});

function relentless(pay: string[], ...extra: Setup[]) {
  const p = sheHulk(handOf("01053", "01088", "01090", "01089", "01086"), engageMinion("01110"), ...extra);
  const bomber = p.card("Hydra Bomber", "enemyCards");
  const card = p.card("Relentless Assault");
  p.mark();
  expect(p.battle.pick(card.id)).toBe(true);
  p.spend(...pay);
  expect(p.run(() => p.battle.pay())).toBe(true);
  return { p, bomber, card };
}

test("01053 Relentless Assault paid with an energy resource: 5 damage to the minion, no overkill", () => {
  const { p, bomber, card } = relentless(["Energy"]);
  // Only a minion is a legal target (never the villain): nothing is asked with the one minion.
  expect(p.snap.choice).toBeNull();
  expect(hits(p)).toContainEqual(expect.objectContaining({ target: bomber.id, amount: 5 }));
  expect(beat(p, (b) => b.defeatedCard === bomber.id)).toBeGreaterThan(0);
  expect(p.snap.villainHp).toBe(14);
  expect(p.beats.some((b) => b.overkill)).toBe(false);
  expect(p.has("Relentless Assault", "discard")).toBe(true);
  expect(beat(p, (b) => b.activate?.card === card.id)).toBeGreaterThanOrEqual(0);
  expect(p.snap.hero.exhausted).toBe(false);
});

test("01053 Relentless Assault paid with a physical resource: overkill, the excess 3 damage goes to Rhino (beat shown)", () => {
  const { p, bomber } = relentless(["Strength"]);
  expect(hits(p)).toContainEqual(expect.objectContaining({ target: bomber.id, amount: 5 }));
  expect(p.snap.villainHp).toBe(11);
  const spill = beat(p, (b) => b.overkill?.to === p.snap.villain.id && b.overkill.amount === 3);
  expect(spill).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.defeatedCard === bomber.id)).toBeGreaterThanOrEqual(0);
});

test("01053 Relentless Assault paid with a physical resource and a non-physical one (First Aid, then Strength) gains overkill", () => {
  const p = sheHulk(handOf("01053", "01088", "01090", "01089", "01086"), engageMinion("01110"));
  p.battle.pick(p.card("Relentless Assault").id);
  p.spend("First Aid");
  // One more is outstanding: Energy is still an available source, so is Strength.
  expect(p.snap.payment!.canPay).toBe(false);
  p.spend("Strength");
  expect(p.snap.payment!.canPay).toBe(true);
  p.run(() => p.battle.pay());
  expect(p.snap.villainHp).toBe(11);
});

test("01053 Relentless Assault: once the cost is covered the payment screen stops offering more cards", () => {
  const p = sheHulk(handOf("01053", "01088", "01090", "01089", "01086"), engageMinion("01110"));
  p.battle.pick(p.card("Relentless Assault").id);
  p.spend("Energy");
  expect(p.snap.payment!.sources.filter((s) => !s.selected).every((s) => !s.available)).toBe(true);
});

test("01053 Relentless Assault paid with a mental resource (Genius): no overkill", () => {
  const { p } = relentless(["Genius"]);
  expect(p.snap.villainHp).toBe(14);
  expect(p.beats.some((b) => b.overkill)).toBe(false);
});

test("01053 Relentless Assault: the Power of Aggression pays it alone (doubled) and, being wild, counts as physical", () => {
  const p = sheHulk(handOf("01053", "01055", "01089", "01086", "01088"), engageMinion("01110"));
  p.battle.pick(p.card("Relentless Assault").id);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Aggression")!;
  expect(power.icons).toEqual(["wild", "wild"]);
  p.battle.toggle(power.id);
  expect(p.snap.payment!.canPay).toBe(true);
  p.mark();
  p.run(() => p.battle.pay());
  expect(p.snap.villainHp).toBe(11);
});

test("01053 Relentless Assault with two minions asks which one, naming both, and never offers the villain", () => {
  const p = sheHulk(handOf("01053", "01088", "01090", "01089", "01086"), engageMinion("01110"), engageMinion("01103"));
  p.battle.pick(p.card("Relentless Assault").id);
  p.spend("Energy");
  p.run(() => p.battle.pay());
  const choice = p.snap.choice!;
  expect(choice.options.map((o) => o.cardId)).not.toContain(p.snap.villain.id);
  expect(choice.options).toHaveLength(2);
  expect(choice.prompt).toMatch(/minion|attack|enemy|target/i);
});

test("01053 Relentless Assault vs Guard (alone): the Hydra Mercenary is hit, and overkill spills past it onto Rhino", () => {
  const p = sheHulk(handOf("01053", "01088", "01090", "01089", "01086"), engageMinion("01101"));
  const guard = p.card("Hydra Mercenary", "enemyCards");
  p.battle.pick(p.card("Relentless Assault").id);
  p.spend("Strength");
  p.mark();
  p.run(() => p.battle.pay());
  expect(p.snap.choice).toBeNull();
  expect(hits(p)).toContainEqual(expect.objectContaining({ target: guard.id, amount: 5 }));
  expect(p.has("Hydra Mercenary", "enemyCards")).toBe(false);
  // 5 damage on 3 HP: 2 excess goes to the villain.
  expect(p.snap.villainHp).toBe(12);
  expect(beat(p, (b) => b.overkill?.amount === 2)).toBeGreaterThanOrEqual(0);
});

// Guard protects the villain only (RRG 1.8 "Guard", p. 21): another minion stays a legal target next to a guard.
test("Guard: Uppercut with a Hydra Mercenary (Guard) and a Hydra Bomber engaged offers both minions, never Rhino", () => {
  const p = sheHulk(handOf("01054", "01088", "01090", "01089", "01086"), engageMinion("01110"), engageMinion("01101"));
  p.battle.pick(p.card("Uppercut").id);
  p.spend("Strength", "First Aid");
  p.run(() => p.battle.pay());
  expect(optionLabels(p).sort()).toEqual(["Hydra Bomber", "Hydra Mercenary"]);
});

test("01053 Relentless Assault vs Guard with another minion engaged: both minions are offered, never Rhino", () => {
  const p = sheHulk(handOf("01053", "01088", "01090", "01089", "01086"), engageMinion("01110"), engageMinion("01101"));
  p.battle.pick(p.card("Relentless Assault").id);
  p.spend("Strength");
  p.run(() => p.battle.pay());
  expect(optionLabels(p).sort()).toEqual(["Hydra Bomber", "Hydra Mercenary"]);
  p.mark();
  p.choose({ label: "Hydra Mercenary" });
  expect(p.has("Hydra Mercenary", "enemyCards")).toBe(false);
  expect(p.has("Hydra Bomber", "enemyCards")).toBe(true);
  expect(damageOf(p, "Hydra Bomber", "enemyCards")).toBe(0);
  // 5 damage on 3 HP, paid with a physical resource: 2 excess goes to the villain.
  expect(p.snap.villainHp).toBe(12);
  expect(beat(p, (b) => b.overkill?.amount === 2)).toBeGreaterThanOrEqual(0);
});

test("01053 Relentless Assault: a minion that survives (Sandman toughness) takes no overkill and no spill", () => {
  const p = sheHulk(
    handOf("01053", "01088", "01090", "01089", "01086"),
    engageMinion("01102"),
    patchCard("01102", { statuses: { tough: 1, stunned: 0, confused: 0 } }),
  );
  p.battle.pick(p.card("Relentless Assault").id);
  p.spend("Strength");
  p.mark();
  p.run(() => p.battle.pay());
  expect(p.snap.villainHp).toBe(14);
  expect(beat(p, (b) => b.hit?.tough === true)).toBeGreaterThanOrEqual(0);
});

// 01054 Uppercut --------------------------------------------------------------------------------------------------------

test("01054 Uppercut: costs 3 and refuses a payment of 2, accepting 3 or more", () => {
  const p = sheHulk(handOf("01054", "01088", "01090", "01089", "01086"));
  expect(p.card("Uppercut").cost).toBe(3);
  expect(p.battle.pick(p.card("Uppercut").id)).toBe(true);
  expect(p.snap.payment!.required).toBe(3);
  p.spend("First Aid");
  expect(p.snap.payment!.canPay).toBe(false);
  p.spend("Energy");
  expect(p.snap.payment!.canPay).toBe(true);
});

test("01054 Uppercut with only Rhino: 5 damage to him, the event shown and discarded, the hero stays ready", () => {
  const p = sheHulk(handOf("01054", "01088", "01090", "01089", "01086"));
  const card = p.card("Uppercut");
  p.mark();
  p.play("Uppercut", { pay: ["Strength", "First Aid"] });
  expect(p.snap.choice).toBeNull();
  expect(p.snap.villainHp).toBe(9);
  const act = beat(p, (b) => b.activate?.card === card.id);
  const hit = beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === 5);
  expect(act).toBeGreaterThanOrEqual(0);
  expect(hit).toBeGreaterThan(act);
  expect(p.beats[hit]!.hit!.source).toBe(p.snap.hero.id);
  expect(beat(p, (b) => b.discardEvent === card.id)).toBeGreaterThan(hit);
  expect(p.has("Uppercut", "discard")).toBe(true);
  expect(p.snap.hero.exhausted).toBe(false);
});

test("01054 Uppercut with a minion engaged: asks which enemy (Rhino or the minion), the choice naming both", () => {
  const p = sheHulk(handOf("01054", "01088", "01090", "01089", "01086"), engageMinion("01110"));
  p.battle.pick(p.card("Uppercut").id);
  p.spend("Strength", "First Aid");
  p.run(() => p.battle.pay());
  const choice = p.snap.choice!;
  // The prompt stays generic; the turn bar's eyebrow names the card asking (main.ts: `nameOf(state.choiceSource)`).
  expect(p.snap.choiceSource && p.battle.cardName(p.snap.choiceSource)).toBe("Uppercut");
  expect(choice.options.map((o) => o.label).sort()).toEqual(["Hydra Bomber", "Rhino"]);
  p.mark();
  p.choose({ label: "Hydra Bomber" });
  expect(p.has("Hydra Bomber", "enemyCards")).toBe(false);
  // Uppercut has no overkill: Rhino is untouched.
  expect(p.snap.villainHp).toBe(14);
  expect(p.beats.some((b) => b.overkill)).toBe(false);
});

test("01054 Uppercut vs Guard: the attack can only target the Hydra Mercenary", () => {
  const p = sheHulk(handOf("01054", "01088", "01090", "01089", "01086"), engageMinion("01101"));
  const guard = p.card("Hydra Mercenary", "enemyCards");
  p.battle.pick(p.card("Uppercut").id);
  p.spend("Strength", "First Aid");
  p.run(() => p.battle.pay());
  expect(p.snap.choice?.options.map((o) => o.cardId) ?? [guard.id]).toEqual([guard.id]);
  if (p.snap.choice) p.choose({ card: guard.id });
  expect(p.has("Hydra Mercenary", "enemyCards")).toBe(false);
  expect(p.snap.villainHp).toBe(14);
});

test("01054 Uppercut: hero form only, refused as Jennifer Walters with the reason", () => {
  const p = scenario(handOf("01054", "01088", "01090", "01089", "01086"));
  const card = p.card("Uppercut");
  expect(card.requiresHeroForm).toBe(true);
  expect(card.playable).toBe(false);
  expect(card.reason).toBe("this event requires hero form");
});

// 01055 The Power of Aggression -----------------------------------------------------------------------------------------

test("01055 The Power of Aggression: counts double on the payment screen for an Aggression card (Hulk, cost 2)", () => {
  const p = sheHulk(handOf("01055", "01050", "01088", "01086", "01090"));
  expect(p.card("The Power of Aggression").playable).toBe(false);
  expect(p.battle.pick(p.card("Hulk").id)).toBe(true);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Aggression")!;
  expect(power.icons).toEqual(["wild", "wild"]);
  p.battle.toggle(power.id);
  expect(p.snap.payment!.paid).toBe(2);
  expect(p.snap.payment!.canPay).toBe(true);
  expect(p.run(() => p.battle.pay())).toBe(true);
  expect(p.has("Hulk", "inPlay")).toBe(true);
  expect(p.has("The Power of Aggression", "discard")).toBe(true);
});

test("01055 The Power of Aggression: also doubled for an Aggression event (Uppercut, cost 3: Power + 1)", () => {
  const p = sheHulk(handOf("01055", "01054", "01086", "01090", "01088"));
  p.battle.pick(p.card("Uppercut").id);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Aggression")!;
  p.battle.toggle(power.id);
  expect(p.snap.payment!.paid).toBe(2);
  expect(p.snap.payment!.canPay).toBe(false);
  p.spend("First Aid");
  expect(p.snap.payment!.canPay).toBe(true);
});

test("01055 The Power of Aggression: single for a card that is not Aggression (Nick Fury, basic)", () => {
  const p = sheHulk(handOf("01055", "01084", "01088", "01086", "01090"));
  expect(p.battle.pick(p.card("Nick Fury").id)).toBe(true);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Aggression")!;
  expect(power.icons).toEqual(["wild"]);
  p.battle.toggle(power.id);
  expect(p.snap.payment!.paid).toBe(1);
});

test("01055 The Power of Aggression: doubled for an Aggression upgrade too (Combat Training)", () => {
  const p = sheHulk(handOf("01055", "01057", "01088", "01086", "01090"));
  p.battle.pick(p.card("Combat Training").id);
  const power = p.snap.payment!.sources.find((s) => s.label === "The Power of Aggression")!;
  expect(power.icons).toEqual(["wild", "wild"]);
});

test("01055 The Power of Aggression: a second copy pays on its own, two cards together are 4 (shown as paid)", () => {
  const p = sheHulk(handOf("01055", "01055", "01054", "01088"));
  p.battle.pick(p.card("Uppercut").id);
  const sources = p.snap.payment!.sources.filter((s) => s.label === "The Power of Aggression");
  expect(sources).toHaveLength(2);
  p.battle.toggle(sources[0]!.id);
  p.battle.toggle(sources[1]!.id);
  expect(p.snap.payment!.paid).toBe(4);
  expect(p.snap.payment!.canPay).toBe(true);
});

// 01056 Tac Team --------------------------------------------------------------------------------------------------------

test("01056 Tac Team: costs 3, enters with 3 attack counters (shown on the card) and is ready", () => {
  const p = sheHulk(handOf("01056", "01088", "01090", "01089", "01086"));
  expect(p.card("Tac Team").cost).toBe(3);
  p.mark();
  p.play("Tac Team", { pay: ["Strength", "First Aid"] });
  expect(p.snap.choice).toBeNull();
  expect(markerOf(p, "Tac Team", "attack")).toBe(3);
  expect(p.card("Tac Team", "inPlay").exhausted).toBe(false);
  expect(beat(p, (b) => /\+3 attack/.test(b.text))).toBeGreaterThanOrEqual(0);
});

test("01056 Tac Team: the action is labelled for what it does, has no resource cost and asks no payment", () => {
  const p = sheHulk(handOf("01056", "01088", "01090", "01089", "01086"));
  p.play("Tac Team", { pay: ["Strength", "First Aid"] });
  const { actions } = p.ability("Tac Team");
  expect(actions).toHaveLength(1);
  expect(actions[0]!.label).toMatch(/2 damage|attack counter/i);
  p.battle.fieldAction(p.card("Tac Team", "inPlay").id, actions[0]!.kind);
  expect(p.snap.payment).toBeNull();
});

test("01056 Tac Team: using it exhausts it, removes 1 counter and deals 2 damage (beats), and it cannot be used again that turn", () => {
  const p = sheHulk(inPlay("01056"), patchCard("01056", { counters: { attack: 3 } }));
  const team = p.card("Tac Team", "inPlay");
  const { kind } = p.ability("Tac Team");
  p.mark();
  expect(p.run(() => p.battle.fieldAction(team.id, kind))).toBe(true);
  expect(p.snap.villainHp).toBe(12);
  expect(markerOf(p, "Tac Team", "attack")).toBe(2);
  expect(p.card("Tac Team", "inPlay").exhausted).toBe(true);
  expect(hits(p)).toContainEqual(expect.objectContaining({ target: p.snap.villain.id, amount: 2 }));
  expect(
    beat(p, (b) => b.statusChange?.id === team.id && b.statusChange.name === "attack" && b.statusChange.delta === -1),
  ).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.turned?.id === team.id && b.turned.exhausted)).toBeGreaterThanOrEqual(0);
  expect(p.battle.fieldActions(team.id)).toEqual([]);
});

test("01056 Tac Team with a minion engaged: asks which enemy, Rhino or the minion", () => {
  const p = sheHulk(inPlay("01056"), patchCard("01056", { counters: { attack: 3 } }), engageMinion("01110"));
  const { card, kind } = p.ability("Tac Team");
  p.battle.fieldAction(card.id, kind);
  expect(p.snap.choice!.options.map((o) => o.label).sort()).toEqual(["Hydra Bomber", "Rhino"]);
  p.choose({ label: "Hydra Bomber" });
  expect(p.has("Hydra Bomber", "enemyCards")).toBe(false);
  expect(markerOf(p, "Tac Team", "attack")).toBe(2);
});

test("01056 Tac Team: not an attack, so Guard does not restrict it: Rhino is a legal target with the guard in play", () => {
  const p = sheHulk(inPlay("01056"), patchCard("01056", { counters: { attack: 3 } }), engageMinion("01101"));
  const { card, kind } = p.ability("Tac Team");
  p.battle.fieldAction(card.id, kind);
  expect(p.snap.choice!.options.map((o) => o.cardId)).toContain(p.snap.villain.id);
});

test("01056 Tac Team: the last counter is spent, then it is discarded (shown leaving play)", () => {
  const p = sheHulk(inPlay("01056"), patchCard("01056", { counters: { attack: 1 } }));
  const team = p.card("Tac Team", "inPlay");
  const { kind } = p.ability("Tac Team");
  p.mark();
  expect(p.run(() => p.battle.fieldAction(team.id, kind))).toBe(true);
  expect(p.snap.villainHp).toBe(12);
  expect(p.has("Tac Team", "inPlay")).toBe(false);
  expect(p.has("Tac Team", "discard")).toBe(true);
  expect(
    beat(p, (b) => b.leftPlay === team.id || b.discardEvent === team.id || b.defeatedCard === team.id),
  ).toBeGreaterThanOrEqual(0);
});

test("01056 Tac Team: with no counters left the action is not offered at all", () => {
  const p = sheHulk(inPlay("01056"), patchCard("01056", { counters: { attack: 0 } }));
  expect(p.battle.fieldActions(p.card("Tac Team", "inPlay").id)).toEqual([]);
});

test("01056 Tac Team: it readies next round and can be used again, down to 1 counter after two uses", () => {
  const p = sheHulk(inPlay("01056"), patchCard("01056", { counters: { attack: 3 } }));
  const team = p.card("Tac Team", "inPlay");
  p.battle.fieldAction(team.id, p.ability("Tac Team").kind);
  p.end();
  p.drive();
  expect(p.snap.turn).toBe("player");
  expect(p.card("Tac Team", "inPlay").exhausted).toBe(false);
  expect(p.battle.fieldAction(team.id, p.ability("Tac Team").kind)).toBe(true);
  expect(markerOf(p, "Tac Team", "attack")).toBe(1);
});

// 01057 Combat Training -------------------------------------------------------------------------------------------------

test("01057 Combat Training: costs 2, played onto her hero (no host question with one player), +1 ATK shown on the hero", () => {
  const p = sheHulk(handOf("01057", "01088", "01090", "01089", "01086"));
  const card = p.card("Combat Training");
  expect(card.cost).toBe(2);
  expect(card.playable).toBe(true);
  p.mark();
  p.play("Combat Training", { pay: ["Energy"] });
  expect(p.snap.choice).toBeNull();
  expect(p.snap.hero.markers).toContainEqual({ name: "ATK", count: 1 });
  expect(p.snap.hand.map((c) => c.name)).not.toContain("Combat Training");
});

test("01057 Combat Training: the card itself is on the table, attached to her hero", () => {
  const p = sheHulk(handOf("01057", "01088"));
  p.play("Combat Training", { pay: ["Energy"] });
  expect(p.card("Combat Training", "inPlay").attachedTo).toBe(p.snap.hero.id);
});

test("01057 Combat Training: her basic attack then hits for 4 (3 + 1)", () => {
  const p = sheHulk(handOf("01057", "01088"));
  p.play("Combat Training", { pay: ["Energy"] });
  p.battle.heroAction("basicAttack");
  expect(p.snap.villainHp).toBe(10);
});

test("01057 Combat Training: it does not buff her allies (Hulk still hits for 3)", () => {
  const p = sheHulk(handOf("01057", "01088"), inPlay("01050"), deckTop("01054"));
  p.play("Combat Training", { pay: ["Energy"] });
  expect(markerOf(p, "Hulk", "ATK")).toBe(0);
  p.battle.fieldAction(p.card("Hulk", "inPlay").id, "basicAttack");
  expect(p.snap.villainHp).toBe(11);
});

test("01057 Combat Training: max 1 per player, the second is refused with a reason saying so", () => {
  const p = sheHulk(handOf("01057", "01057", "01088", "01090"));
  p.play("Combat Training", { pay: ["Energy"] });
  const second = p.card("Combat Training");
  expect(second.playable).toBe(false);
  expect(second.reason).toMatch(/max|1|already/i);
  expect(p.battle.pick(second.id)).toBe(false);
  expect(p.snap.hero.markers).toContainEqual({ name: "ATK", count: 1 });
});

test("01057 Combat Training: playable in alter-ego form too (upgrades are not form-bound)", () => {
  const p = scenario(handOf("01057", "01088", "01090", "01089"));
  const card = p.card("Combat Training");
  expect(card.requiresHeroForm).toBeFalsy();
  expect(card.playable).toBe(true);
});
