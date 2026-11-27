/**
 * The Green Goblin pack's Risky Business scenario and the Power Drain modular set on the 3D table, card by card: Norman
 * Osborn / Green Goblin (02001-02003, each stage and both sides, the flips both ways), Hostile Takeover (02004-02005,
 * both stages), Criminal Enterprise / State of Madness (02006), the Risky Business encounter cards (02007-02013) and
 * Power Drain's (02041-02045). Each test makes the card happen (revealed, boosted, attacked with, defeated, in each
 * form or face it reads), then checks the engine's outcome and what the table shows (a beat for it, the question's
 * words). Beats are matched by ids and fields, not their words, except where the words are what is tested.
 *
 * The deal: Spider-Man against Risky Business with Power Drain (seed 75). Every card a test draws or discards is
 * stacked: the seed decides only what lies below the stack. In hero form Norman Osborn never attacks (an infamy counter
 * instead, and no boost card: Green Goblin insert, "When Norman Osborn Attacks"), so the card under test is the first
 * off the deck; in alter-ego form he schemes and the first card is his boost card.
 *
 * Green Goblin is reached by play (one infamy counter left and a basic attack on Norman) wherever the flip itself is
 * under test; elsewhere `goblin()` puts the villain on side B with State of Madness up as context only (it skips the
 * flip's When Revealed and the madness counters' entering).
 */
import { expect, test } from "vitest";
import * as engine from "@mc/engine";
import {
  beat,
  codeOf,
  engageMinion,
  handOf,
  patchByCode,
  scenarioOf,
  stack,
  type Choice,
  type Player,
  type Setup,
} from "./deck-audit-driver.js";
import type { BattleCard, Difficulty, ModuleId } from "./model.js";

// ---------------------------------------------------------------------------------------------------------------
// The deal and the set-up steps.
// ---------------------------------------------------------------------------------------------------------------

const MODULES: ModuleId[] = ["power_drain"];
const deal = (difficulty: Difficulty = "standard") => ({
  hero: "spider-man" as const,
  villain: "risky-business" as const,
  modules: MODULES,
  difficulty,
  seed: 75,
});

/** Advance (01186): no boost icons and no Boost ability, so as a boost card it adds nothing. Dealt, the villain schemes. */
const QUIET = "01186";
/** Assault (01187): no boost icons and no Boost ability either: a second quiet boost card. */
const QUIET2 = "01187";

const enterpriseOf = (s: engine.GameState) => s.villainArea.find((i) => codeOf(s, i) === "02006a")!;
const patchEnterprise =
  (patch: Partial<engine.GameState["instances"][string]>): Setup =>
  (s) => {
    const id = enterpriseOf(s);
    return { ...s, instances: { ...s.instances, [id]: { ...s.instances[id]!, ...patch } } };
  };
/** Criminal Enterprise holds exactly `n` infamy counters. */
const infamy = (n: number) => patchEnterprise({ counters: { infamy: n } });

/**
 * Context only: the villain on its Green Goblin side (at `stageIndex` when given) and State of Madness up with `madness`
 * counters, as if the flip had already happened.
 */
const goblin =
  (madness = 2, stageIndex?: number): Setup =>
  (s) => {
    const id = enterpriseOf(s);
    return {
      ...s,
      villains: [{ ...s.villains[0]!, side: "B", ...(stageIndex !== undefined ? { stageIndex } : {}) }],
      instances: { ...s.instances, [id]: { ...s.instances[id]!, flipped: true, counters: { madness } } },
    };
  };
/** The villain at `stageIndex` (a stage the difficulty uses), still on side A. */
const normanStage =
  (stageIndex: number): Setup =>
  (s) => ({ ...s, villains: [{ ...s.villains[0]!, stageIndex }] });
const villainDamage = (n: number) => patchByCode("villain", { damage: n });
const schemeThreat = (n: number) => patchByCode("scheme", { threat: n });

/** A side scheme of the encounter deck already in play with `threat` on it (no When Revealed). */
const sideScheme =
  (code: string, threat: number): Setup =>
  (s) => {
    const key = engine.activeEncounterDeckId(s);
    const piles = engine.activeEncounterDeck(s);
    const id = piles.deck.find((i) => codeOf(s, i) === code);
    if (!id) throw Error(`no ${code} in the encounter deck`);
    return {
      ...s,
      villainArea: [...s.villainArea, id],
      instances: { ...s.instances, [id]: { ...s.instances[id]!, faceup: true, threat } },
      encounterDecks: { ...s.encounterDecks, [key]: { ...piles, deck: piles.deck.filter((i) => i !== id) } },
    };
  };

/** Hostile Takeover at stage 2 (Corporate Acquisition, B side up) with `threat`. */
const corporateAcquisition =
  (threat: number): Setup =>
  (s) => {
    const { faceupSide: _a, ...scheme } = s.mainScheme;
    return {
      ...s,
      mainScheme: { ...scheme, stageIndex: 1 },
      instances: { ...s.instances, [s.mainScheme.instanceId]: { ...s.instances[s.mainScheme.instanceId]!, threat } },
    };
  };

// ---------------------------------------------------------------------------------------------------------------
// Reading the table.
// ---------------------------------------------------------------------------------------------------------------

const env = (p: Player) => p.snap.enemyCards.find((c) => c.type === "environment")!;
const mainScheme = (p: Player) => p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
const enemy = (p: Player, name: string) => p.snap.enemyCards.find((c) => c.name === name);
const marker = (c: BattleCard | undefined, name: string) => c?.markers.find((m) => m.name === name)?.count ?? 0;
const villainId = (p: Player) => p.snap.villain.id;
const heroId = (p: Player) => p.snap.hero.id;
/** The index of the beat changing the environment's `name` counters by `delta` (-1 when there is none). */
const counterBeat = (p: Player, name: string, delta: number) =>
  beat(p, (b) => b.statusChange?.id === env(p).id && b.statusChange.name === name && b.statusChange.delta === delta);
const revealOf = (p: Player, name: string) => beat(p, (b) => b.reveal?.name === name && !b.reveal.boost);
const boostFlip = (p: Player, name: string) => beat(p, (b) => b.reveal?.name === name && !!b.reveal.boost);
const nameOf = (p: Player, id: string) => engine.cardOf(p.battle.game, id as engine.InstanceId)?.name;
/** The names of the cards the first encounter-deck discard beat turns up, in order. */
const milledBeat = (p: Player) =>
  (p.beats.find((b) => b.encounterMilled)?.encounterMilled ?? []).map((id) => nameOf(p, id));
const hits = (p: Player, target: string) => p.beats.filter((b) => b.hit?.target === target).map((b) => b.hit!.amount);

/** A basic attack by Spider-Man on Norman / Green Goblin (the only enemy he can attack). */
function attackVillain(p: Player) {
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  if (p.snap.choice && !p.snap.choice.indirect) p.choose({ card: villainId(p) });
}

/**
 * End the turn and play out the villain phase, keeping every question asked (whole). `answer` answers a question by
 * returning the option ids; otherwise the driver's defaults (attacks undefended, the first `min` options).
 */
function villainPhase(p: Player, answer: (c: Choice) => string[] | undefined = () => undefined) {
  /** Each question, with `from`: the name of the card the table shows asking it (`choiceSource`). */
  const asked: (Choice & { from: string | undefined })[] = [];
  p.mark();
  p.end();
  p.drive({
    defend: () => "decline",
    pick: (choice) => {
      const source = p.snap.choiceSource;
      asked.push({ ...choice, from: source ? nameOf(p, source) : undefined });
      if (choice.defense || choice.discardFromHand || choice.mulligan) return undefined;
      if (choice.ordered) return choice.options.map((o) => o.id);
      return answer(choice);
    },
  });
  return asked;
}
const byLabel =
  (label: RegExp) =>
  (c: Choice): string[] | undefined => {
    const o = c.options.find((x) => label.test(x.label));
    return o ? [o.id] : undefined;
  };

/** Jessica Jones (01059, 3 hit points) in play beside Spider-Man, paid for from the hand. */
const JESSICA_HAND = handOf("01059", "01090", "01088");
function playJessica(p: Player) {
  p.play("Jessica Jones", { pay: ["Strength", "Energy"] });
  return p.card("Jessica Jones", "inPlay");
}

// ===============================================================================================================
// 02001-02003 Norman Osborn / Green Goblin, 02004 Hostile Takeover 1, 02006 Criminal Enterprise: the opening.
// ===============================================================================================================

test("02004a Hostile Takeover: setup puts Criminal Enterprise into play with 2 infamy; Norman Osborn I on side A", () => {
  const p = scenarioOf(deal());
  // Hostile Takeover 1B: starting threat 2[per_hero], target 7[per_hero]. Norman Osborn I: 14[per_hero] hit points.
  expect(p.snap.villain.name).toBe("Norman Osborn");
  expect(p.snap.villainHp).toBe(14);
  expect(mainScheme(p)).toMatchObject({ name: "Hostile Takeover", threat: 2, threatTarget: 7 });
  // "Criminal Enterprise enter play with 2[per_hero] infamy counters on it."
  expect(env(p).name).toBe("Criminal Enterprise");
  expect(marker(env(p), "infamy")).toBe(2);
  const villain = engine.activeVillain(p.battle.game);
  expect(villain).toMatchObject({ side: "A", stageIndex: 0, lastStageIndex: 1 });
});

test("02004a Hostile Takeover (expert): Norman Osborn II-III, starting on Norman Osborn II", () => {
  const p = scenarioOf(deal("expert"));
  expect(engine.activeVillain(p.battle.game)).toMatchObject({ side: "A", stageIndex: 1, lastStageIndex: 2 });
  expect(p.snap.villainHp).toBe(18);
});

// ===============================================================================================================
// 02001a-02003a Norman Osborn
// ===============================================================================================================

test("02001a Norman Osborn I: in alter-ego form he schemes for his 2 SCH plus the boost; Hostile Takeover adds 1 first", () => {
  const p = scenarioOf(deal(), stack(QUIET, "02012"));
  villainPhase(p);
  const scheme = mainScheme(p).id;
  // Step 1: Hostile Takeover's acceleration 1[per_hero]; then Norman's SCH 2 with a 0-icon boost card.
  const step1 = beat(p, (b) => b.threat?.scheme === scheme && b.threat.delta === 1);
  const schemes = beat(p, (b) => b.scheming === villainId(p));
  const placed = beat(p, (b) => b.threat?.scheme === scheme && b.threat.delta === 2 && b.actor === villainId(p));
  expect(step1).toBeGreaterThanOrEqual(0);
  expect(schemes).toBeGreaterThan(step1);
  expect(boostFlip(p, "Advance")).toBeGreaterThan(schemes);
  expect(placed).toBeGreaterThan(boostFlip(p, "Advance"));
  expect(mainScheme(p).threat).toBe(5);
});

test("02001a Norman Osborn I: in hero form 'would attack' places 1 infamy counter instead: no boost card, no damage", () => {
  const p = scenarioOf(deal(), stack("02012"));
  p.form();
  villainPhase(p);
  // [star] Forced Interrupt: When Norman Osborn would attack, place 1 infamy counter on Criminal Enterprise instead.
  const interrupt = beat(p, (b) => b.interrupt === villainId(p));
  const counter = counterBeat(p, "infamy", 1);
  expect(interrupt).toBeGreaterThanOrEqual(0);
  expect(counter).toBeGreaterThan(interrupt);
  // The table aims him at Spider-Man ("would attack"), then the interrupt replaces it: no boost card, no damage.
  expect(beat(p, (b) => b.attackAim?.source === villainId(p))).toBeLessThan(interrupt);
  expect(p.beats.some((b) => b.boostFor)).toBe(false);
  expect(p.beats.some((b) => b.hit)).toBe(false);
  expect(p.snap.heroHp).toBe(10);
  // Then All in a Day's Work, the dealt card, places 2 more: 2 + 1 + 2.
  expect(marker(env(p), "infamy")).toBe(5);
});

test("02001a Norman Osborn: once his attack is replaced, the table doesn't aim him at Spider-Man again in the hero phase", () => {
  // BUG (table): after a villain phase in which Norman Osborn's attack was replaced by his infamy interrupt, the last
  // beat of the move, after the "Hero Phase" banner, is a second "Target: Spider-Man" (attackAim + enemyActivation for
  // Norman): the table lifts Norman and aims him at Spider-Man at the start of the player's turn, with no attack.
  const p = scenarioOf(deal(), stack("02012"));
  p.form();
  villainPhase(p);
  const heroPhase = beat(p, (b) => b.phase === "hero");
  expect(heroPhase).toBeGreaterThanOrEqual(0);
  expect(p.beats.slice(heroPhase).filter((b) => b.attackAim || b.enemyActivation)).toEqual([]);
});

test("02002a Norman Osborn II (expert): 'would attack' places 2 infamy counters instead", () => {
  const p = scenarioOf(deal("expert"), stack("02009"));
  p.form();
  villainPhase(p);
  expect(beat(p, (b) => b.interrupt === villainId(p))).toBeGreaterThanOrEqual(0);
  expect(counterBeat(p, "infamy", 2)).toBeGreaterThanOrEqual(0);
  expect(marker(env(p), "infamy")).toBe(4);
  expect(p.snap.heroHp).toBe(10);
});

test("02003a Norman Osborn III (expert): 'would attack' places 3 infamy counters instead", () => {
  const p = scenarioOf(deal("expert"), normanStage(2), stack("02009"));
  p.form();
  villainPhase(p);
  expect(counterBeat(p, "infamy", 3)).toBeGreaterThanOrEqual(0);
  expect(marker(env(p), "infamy")).toBe(5);
  expect(p.snap.heroHp).toBe(10);
});

test("02001a Norman Osborn: damage to him removes that many infamy counters instead; his hit points are untouched", () => {
  const p = scenarioOf(deal(), infamy(5));
  p.form();
  attackVillain(p);
  // Forced Interrupt: When Norman Osborn would take any amount of damage, remove that many infamy counters instead.
  // Spider-Man's ATK is 2.
  expect(p.snap.villainHp).toBe(14);
  expect(p.battle.game.instances[villainId(p)]!.damage).toBe(0);
  expect(marker(env(p), "infamy")).toBe(3);
  const interrupt = beat(p, (b) => b.interrupt === villainId(p));
  expect(interrupt).toBeGreaterThanOrEqual(0);
  expect(counterBeat(p, "infamy", -2)).toBeGreaterThan(interrupt);
  expect(hits(p, villainId(p))).toEqual([]);
});

// ===============================================================================================================
// 02006a Criminal Enterprise -> 02006b State of Madness, 02001b Green Goblin: the flip, by play.
// ===============================================================================================================

test("02006a Criminal Enterprise: the last infamy counter off flips Norman to Green Goblin and itself to State of Madness (2 madness)", () => {
  const p = scenarioOf(deal(), infamy(1));
  p.form();
  attackVillain(p);
  const game = p.battle.game;
  expect(engine.activeVillain(game).side).toBe("B");
  expect(p.snap.villain.name).toBe("Green Goblin");
  // Green Goblin insert, "When the Villain Changes Form": damage and the rest stay as they are (none here).
  expect(p.snap.villainHp).toBe(14);
  expect(env(p).name).toBe("State of Madness");
  // "State of Madness enter play with 2[per_hero] madness counters on it."
  expect(marker(env(p), "madness")).toBe(2);
  expect(marker(env(p), "infamy")).toBe(0);
  const flip = beat(p, (b) => b.villainFlip === true && b.actor === villainId(p));
  expect(counterBeat(p, "infamy", -1)).toBeLessThan(flip);
  expect(counterBeat(p, "madness", 2)).toBeGreaterThan(flip);
});

test("02006a Criminal Enterprise: the beats before the flip name Norman Osborn and Criminal Enterprise", () => {
  // BUG (table): a move's beats take their names from the faces up once the move has ended. Removing the last infamy
  // counter reads "Green Goblin interrupts" and "State of Madness · -1 infamy", though it was Norman Osborn's
  // interrupt and Criminal Enterprise's counter (State of Madness never holds infamy). The other way round, Green
  // Goblin's madness interrupt reads "Norman Osborn interrupts" / "Criminal Enterprise · -1 madness".
  const p = scenarioOf(deal(), infamy(1));
  p.form();
  attackVillain(p);
  const words = p.beats.map((b) => b.text);
  expect(words).toContain("Norman Osborn interrupts");
  expect(words).toContain("Criminal Enterprise · -1 infamy");
});

test("02001b Green Goblin I: flipping in deals 3 indirect damage to the player in hero form", () => {
  const p = scenarioOf(deal(), infamy(1));
  p.form();
  attackVillain(p);
  // When Revealed: Deal 3 indirect damage to each player in hero form. Changing form triggers it (Green Goblin insert).
  // Norman's interrupt replaced the attack's damage, so all of Spider-Man's damage is this.
  expect(p.snap.heroHp).toBe(7);
  const flip = beat(p, (b) => b.villainFlip === true);
  const hit = beat(p, (b) => b.hit?.target === heroId(p) && b.hit.amount === 3);
  expect(hit).toBeGreaterThan(flip);
});

test("02001b Green Goblin I: with an ally in play the player divides the 3 indirect damage", () => {
  const p = scenarioOf(deal(), infamy(1), JESSICA_HAND);
  const jessica = playJessica(p);
  p.form();
  attackVillain(p);
  const choice = p.snap.choice!;
  // RRG 1.8 "Indirect Damage" (p. 24): the player assigns it among the characters they control.
  expect(choice.indirect).toEqual({ amount: 3 });
  expect(choice.options.some((o) => o.cardId === jessica.id)).toBe(true);
  expect(choice.options.some((o) => o.cardId === heroId(p))).toBe(true);
  const picks = choice.options.filter((o) => o.cardId === heroId(p)).slice(0, 3);
  expect(picks).toHaveLength(3);
  expect(p.run(() => p.battle.chooseMany(picks.map((o) => o.id)))).toBe(true);
  expect(p.snap.heroHp).toBe(7);
  expect(p.has("Jessica Jones", "inPlay")).toBe(true);
});

test("02002b Green Goblin II (expert): flipping in deals 4 indirect damage to each player", () => {
  const p = scenarioOf(deal("expert"), infamy(1));
  p.form();
  attackVillain(p);
  expect(p.snap.villain.name).toBe("Green Goblin");
  expect(p.snap.villainHp).toBe(18);
  // Green Goblin II prints "Deal 4 indirect damage to each player" (issue #361: MarvelCDB's 3 is a typo).
  expect(p.snap.heroHp).toBe(6);
  expect(beat(p, (b) => b.hit?.target === heroId(p) && b.hit.amount === 4)).toBeGreaterThan(
    beat(p, (b) => b.villainFlip === true),
  );
});

test("02001b Green Goblin I defeated: Green Goblin II enters on the same side and deals 4 indirect damage", () => {
  // Green Goblin insert, "When a Villain Stage is Defeated": the next stage enters play on the same side.
  const p = scenarioOf(deal(), goblin(2), villainDamage(13));
  p.form();
  attackVillain(p);
  expect(engine.activeVillain(p.battle.game)).toMatchObject({ side: "B", stageIndex: 1 });
  expect(p.snap.villain.name).toBe("Green Goblin");
  expect(p.snap.villainHp).toBe(18);
  expect(beat(p, (b) => b.villainStage === 2 && !!b.defeat)).toBeGreaterThanOrEqual(0);
  expect(p.snap.heroHp).toBe(6);
});

test("02003b Green Goblin III (expert): enters on Goblin II's defeat and deals 4 damage, not indirect: no ally takes it", () => {
  const p = scenarioOf(deal("expert"), goblin(2, 1), villainDamage(17), JESSICA_HAND);
  playJessica(p);
  p.form();
  attackVillain(p);
  expect(engine.activeVillain(p.battle.game)).toMatchObject({ side: "B", stageIndex: 2 });
  expect(p.snap.villainHp).toBe(22);
  // "Deal 4 damage to each player": FFG ruling (Green Goblin, Boggs): not indirect, so it can't be assigned to allies.
  expect(p.snap.choice?.indirect).toBeUndefined();
  expect(p.snap.heroHp).toBe(6);
  expect(marker(p.card("Jessica Jones", "inPlay"), "damage")).toBe(0);
});

// ===============================================================================================================
// 02001b-02003b Green Goblin: his scheme replaced, his attack.
// ===============================================================================================================

test("02001b Green Goblin I: 'would scheme' removes 1 madness counter instead; no threat from him", () => {
  const p = scenarioOf(deal(), goblin(3), stack("02009"));
  villainPhase(p);
  // [star] Forced Interrupt: When Green Goblin would scheme, remove 1 madness counter from State of Madness instead.
  const interrupt = beat(p, (b) => b.interrupt === villainId(p));
  expect(interrupt).toBeGreaterThanOrEqual(0);
  expect(counterBeat(p, "madness", -1)).toBeGreaterThan(interrupt);
  expect(marker(env(p), "madness")).toBe(2);
  // Only step 1's 1 threat lands on Hostile Takeover; no boost card is dealt for a replaced activation.
  expect(p.beats.filter((b) => b.threat?.scheme === mainScheme(p).id).map((b) => b.threat!.delta)).toEqual([1]);
  expect(p.beats.some((b) => b.boostFor)).toBe(false);
  expect(mainScheme(p).threat).toBe(3);
});

test("02003b Green Goblin III (expert): 'would scheme' removes 2 madness counters instead", () => {
  const p = scenarioOf(deal("expert"), goblin(4, 2), stack("02009"));
  villainPhase(p);
  expect(counterBeat(p, "madness", -2)).toBeGreaterThanOrEqual(0);
  expect(marker(env(p), "madness")).toBe(2);
});

test("02001b Green Goblin I: in hero form he attacks for his 3 ATK plus the boost", () => {
  const p = scenarioOf(deal(), goblin(2), stack(QUIET, "02009"));
  p.form();
  const asked = villainPhase(p);
  expect(asked.find((c) => c.defense)?.defense?.attackerId).toBe(villainId(p));
  expect(boostFlip(p, "Advance")).toBeGreaterThanOrEqual(0);
  expect(hits(p, heroId(p))).toEqual([3]);
  expect(p.snap.heroHp).toBe(7);
});

test("02006b State of Madness: the last madness counter off flips back to Norman Osborn and Criminal Enterprise (2 infamy)", () => {
  const p = scenarioOf(deal(), goblin(1), stack("02009"));
  villainPhase(p);
  expect(p.snap.villain.name).toBe("Norman Osborn");
  expect(engine.activeVillain(p.battle.game).side).toBe("A");
  expect(env(p).name).toBe("Criminal Enterprise");
  expect(marker(env(p), "infamy")).toBe(2);
  expect(marker(env(p), "madness")).toBe(0);
  const flip = beat(p, (b) => b.villainFlip === true);
  expect(counterBeat(p, "madness", -1)).toBeLessThan(flip);
  expect(counterBeat(p, "infamy", 2)).toBeGreaterThan(flip);
});

test("02006b State of Madness: flipped by play both ways (Goblin by an attack, back by All in a Day's Work)", () => {
  const p = scenarioOf(deal(), infamy(1), stack(QUIET, "02012"));
  p.form();
  attackVillain(p);
  expect(env(p).name).toBe("State of Madness");
  villainPhase(p);
  // Green Goblin attacks (3 + a 0-icon boost), then All in a Day's Work removes the 2 madness counters: the flip back.
  expect(p.snap.heroHp).toBe(4);
  expect(p.snap.villain.name).toBe("Norman Osborn");
  expect(env(p).name).toBe("Criminal Enterprise");
  expect(marker(env(p), "infamy")).toBe(2);
  expect(counterBeat(p, "madness", -2)).toBeLessThan(beat(p, (b) => b.villainFlip === true));
});

test("02001b Green Goblin: a boost taking the last madness counter mid-attack flips him; Norman hits for 0 plus the icons", () => {
  // FAQ "Green Goblin (#1B)" (RRG 1.8 p. 59): he flips at once, the boost icons are added to Norman's "–" ATK (0), and
  // Norman's Forced Interrupt does not trigger: the attack is past "would attack". Hired Gun: 2 boost icons, and its
  // [star] Boost removes 1 madness counter while Criminal Enterprise is not in play.
  const p = scenarioOf(deal(), goblin(1), stack("02007", "02009"));
  p.form();
  villainPhase(p);
  expect(p.snap.villain.name).toBe("Norman Osborn");
  expect(hits(p, heroId(p))).toEqual([2]);
  expect(p.snap.heroHp).toBe(8);
  // Only the 2 infamy counters Criminal Enterprise enters with: no "+1 infamy" from Norman's interrupt.
  expect(marker(env(p), "infamy")).toBe(2);
  expect(counterBeat(p, "infamy", 1)).toBe(-1);
});

// ===============================================================================================================
// 02004 Hostile Takeover / 02005 Corporate Acquisition
// ===============================================================================================================

test("02004b Hostile Takeover: When Completed places 1 infamy, then discards a card from the deck per infamy counter, then advances", () => {
  // Threat 6 of 7: step 1's acceleration completes it. "Place 1[per_hero] infamy counters on Criminal Enterprise. Then
  // discard 1 card from each player's deck for each infamy counter on Criminal Enterprise": 1 + 1 = 2 cards.
  const p = scenarioOf(deal(), infamy(1), schemeThreat(6), stack("02012", "02012"));
  p.form();
  villainPhase(p);
  const added = counterBeat(p, "infamy", 1);
  const milled = beat(p, (b) => !!b.milled);
  const advance = beat(p, (b) => !!b.schemeAdvance);
  expect(added).toBeGreaterThanOrEqual(0);
  expect(milled).toBeGreaterThan(added);
  const milledIds = p.beats[milled]!.milled!;
  expect(milledIds).toHaveLength(2);
  expect(p.battle.game.players[0]!.discard).toEqual(expect.arrayContaining(milledIds));
  expect(advance).toBeGreaterThan(milled);
  // Corporate Acquisition 2B: starting threat 1[per_hero] (its own beat after the advance), target 10[per_hero].
  expect(p.beats[advance]!.schemeAdvance).toMatchObject({ stage: 2, to: "Corporate Acquisition", target: 10 });
  const scheme = mainScheme(p).id;
  expect(beat(p, (b) => b.threat?.scheme === scheme && b.threat.delta === 1 && b.threat.to === 1)).toBeGreaterThan(
    advance,
  );
  expect(p.battle.game.mainScheme.stageIndex).toBe(1);
  expect(mainScheme(p)).toMatchObject({ threat: 1, threatTarget: 10 });
});

test("02004b Hostile Takeover: the When Completed deck discard is credited to Hostile Takeover", () => {
  // BUG (table): the beat reads "Corporate Acquisition: discard the top 2 cards of your deck", naming the stage the
  // scheme has advanced to by the end of the move; the When Completed is Hostile Takeover 1B's.
  const p = scenarioOf(deal(), infamy(1), schemeThreat(6), stack("02012", "02012"));
  p.form();
  villainPhase(p);
  expect(p.beats.find((b) => b.milled)?.text).toMatch(/^Hostile Takeover/);
});

test("02005 Corporate Acquisition: its hazard icon deals one more encounter card each villain phase", () => {
  // Hero form, so Norman deals no boost card: one card for the player plus one for the hazard icon (RRG 1.8 "Hazard Icon").
  const p = scenarioOf(deal(), corporateAcquisition(1), stack("02009", "02010"));
  p.form();
  villainPhase(p);
  expect(p.beats.filter((b) => b.encounterDeal && !b.boostFor)).toHaveLength(2);
  expect(revealOf(p, "Collapsing Bridge")).toBeGreaterThanOrEqual(0);
  expect(revealOf(p, "Oscorp Manufacturing")).toBeGreaterThanOrEqual(0);
  // Acceleration 2[per_hero] at step 1.
  expect(beat(p, (b) => b.threat?.scheme === mainScheme(p).id && b.threat.delta === 2)).toBeGreaterThanOrEqual(0);
});

test("02005 Corporate Acquisition: if this stage is completed, the players lose", () => {
  const p = scenarioOf(deal(), corporateAcquisition(9), stack("02009", "02010"));
  p.form();
  villainPhase(p);
  expect(p.snap.outcome).toEqual({ result: "loss", reason: "mainSchemeCompleted" });
  expect(beat(p, (b) => !!b.gameEnded)).toBeGreaterThanOrEqual(0);
});

// ===============================================================================================================
// 02007 Hired Gun
// ===============================================================================================================

test("02007 Hired Gun: When Revealed asks the player, in the card's words, between a boost card and 2 infamy", () => {
  const p = scenarioOf(deal(), stack("02007", "02012"));
  p.form();
  const asked = villainPhase(p);
  const choice = asked.find((c) => c.from === "Hired Gun");
  expect(choice, JSON.stringify(asked.map((c) => [c.prompt, c.from]))).toBeDefined();
  // The table shows Hired Gun asking (choiceSource) and the card's own two halves as the answers.
  expect(choice!.prompt).toBe("Choose one");
  expect(choice!.options.map((o) => o.label)).toEqual([
    "Give the villain 1 facedown boost card",
    "Place 2 infamy counters on Criminal Enterprise",
  ]);
  // The minion stays, engaged with Spider-Man.
  expect(enemy(p, "Hired Gun")).toBeDefined();
  expect(revealOf(p, "Hired Gun")).toBeGreaterThanOrEqual(0);
});

test("02007 Hired Gun: 'Give the villain 1 facedown boost card' leaves a card facedown beside Norman", () => {
  const p = scenarioOf(deal(), stack("02007", "02012"));
  p.form();
  villainPhase(p, byLabel(/facedown boost card/));
  const villain = p.battle.game.instances[villainId(p)]!;
  expect(villain.boostCards).toHaveLength(1);
  expect(codeOf(p.battle.game, villain.boostCards[0]!)).toBe("02012");
  expect(p.snap.facedownBoosts).toEqual([{ id: villain.boostCards[0], enemy: villainId(p) }]);
  expect(beat(p, (b) => b.boostFor === villainId(p) && b.encounterDeal === villain.boostCards[0])).toBeGreaterThan(
    revealOf(p, "Hired Gun"),
  );
});

test("02007 Hired Gun: the stockpiled boost card is turned up with the next activation's own", () => {
  // RRG 1.8 "Boost": every facedown boost card the villain has is turned up when it next activates. Next round Spider-Man
  // is in alter-ego form: Norman schemes with 2 boost cards: the stockpiled Oscorp Manufacturing (3) and Payoff (1).
  const p = scenarioOf(deal(), schemeThreat(0), stack("02007", "02010", "02011", "02009"));
  p.form();
  villainPhase(p, byLabel(/facedown boost card/));
  p.form();
  villainPhase(p);
  expect(boostFlip(p, "Oscorp Manufacturing")).toBeGreaterThanOrEqual(0);
  expect(boostFlip(p, "Payoff")).toBeGreaterThanOrEqual(0);
  // SCH 2 + 3 + 1 icons.
  expect(beat(p, (b) => b.threat?.scheme === mainScheme(p).id && b.threat.delta === 6)).toBeGreaterThanOrEqual(0);
  expect(p.snap.facedownBoosts).toEqual([]);
});

test("02007 Hired Gun: 'Place 2 infamy counters on Criminal Enterprise'", () => {
  const p = scenarioOf(deal(), stack("02007", "02012"));
  p.form();
  villainPhase(p, byLabel(/infamy/));
  // 2 + 1 (Norman's would-attack) + 2.
  expect(marker(env(p), "infamy")).toBe(5);
  expect(counterBeat(p, "infamy", 2)).toBeGreaterThan(revealOf(p, "Hired Gun"));
  expect(p.snap.facedownBoosts).toEqual([]);
});

test("02007 Hired Gun: while State of Madness is up, 'facedown boost card' gives Green Goblin the card", () => {
  const p = scenarioOf(deal(), goblin(3), stack("02007", "02012"));
  villainPhase(p, byLabel(/facedown boost card/));
  expect(p.battle.game.instances[villainId(p)]!.boostCards).toHaveLength(1);
  expect(p.snap.facedownBoosts).toHaveLength(1);
});

test("02007 Hired Gun: while State of Madness is up, the infamy option is not offered", () => {
  // BUG (engine, a rules reading): with State of Madness up, Criminal Enterprise is not in play, yet Hired Gun still
  // offers "Place 2 infamy counters on Criminal Enterprise", which then does nothing. RRG 1.8 "Choose (Option)": for an
  // encounter card, a player "cannot choose an option that requires one or more targets if there are no valid targets
  // for that option". Reading the named Criminal Enterprise as that option's target is ours; no FFG ruling found.
  const p = scenarioOf(deal(), goblin(3), stack("02007", "02012"));
  const asked = villainPhase(p);
  const choice = asked.find((c) => c.from === "Hired Gun");
  expect(choice?.options.map((o) => o.label) ?? []).not.toContain("Place 2 infamy counters on Criminal Enterprise");
});

test("02007 Hired Gun as a boost card: 2 boost icons, and its [star] Boost places 1 infamy counter", () => {
  const p = scenarioOf(deal(), schemeThreat(0), stack("02007", "02009"));
  villainPhase(p);
  const flip = boostFlip(p, "Hired Gun");
  expect(p.beats[flip]!.reveal!.boost).toEqual({ icons: 2, enemy: villainId(p) });
  expect(counterBeat(p, "infamy", 1)).toBeGreaterThan(flip);
  expect(marker(env(p), "infamy")).toBe(3);
  // 1 (step 1) + 2 SCH + 2 icons.
  expect(mainScheme(p).threat).toBe(5);
});

test("02007 Hired Gun as Green Goblin's boost card: 2 icons on his attack, and with no Criminal Enterprise 1 madness off", () => {
  const p = scenarioOf(deal(), goblin(3), stack("02007", "02009"));
  p.form();
  villainPhase(p);
  // "Place 1 infamy counter on Criminal Enterprise. If you cannot, remove 1 madness counter from State of Madness."
  expect(counterBeat(p, "madness", -1)).toBeGreaterThan(boostFlip(p, "Hired Gun"));
  expect(marker(env(p), "madness")).toBe(2);
  expect(hits(p, heroId(p))).toEqual([5]);
});

// ===============================================================================================================
// 02008 Private Security Specialist
// ===============================================================================================================

test("02008 Private Security Specialist: revealed, it engages; its guard keeps Spider-Man's attack off Norman", () => {
  const p = scenarioOf(deal(), stack(QUIET, "02008"));
  villainPhase(p);
  const guard = enemy(p, "Private Security Specialist")!;
  expect(guard).toMatchObject({ guard: true });
  expect(revealOf(p, "Private Security Specialist")).toBeGreaterThanOrEqual(0);
  p.form();
  expect(p.battle.heroAction("basicAttack")).toBe(true);
  // RRG 1.8 "Guard" (p. 21): the engaged player cannot attack the villain. The pick says why.
  expect(p.snap.choice?.guard).toEqual({ blocked: [villainId(p)], guards: [guard.id] });
  expect(p.snap.choice!.options.map((o) => o.cardId)).not.toContain(villainId(p));
});

test("02008 Private Security Specialist as a boost card: 1 icon, and its [star] Boost places 1 infamy counter", () => {
  const p = scenarioOf(deal(), schemeThreat(0), stack("02008", "02009"));
  villainPhase(p);
  expect(p.beats[boostFlip(p, "Private Security Specialist")]!.reveal!.boost!.icons).toBe(1);
  expect(counterBeat(p, "infamy", 1)).toBeGreaterThan(boostFlip(p, "Private Security Specialist"));
  expect(mainScheme(p).threat).toBe(4);
});

// ===============================================================================================================
// 02009 Collapsing Bridge
// ===============================================================================================================

test("02009 Collapsing Bridge: enters with 2 threat; its crisis icon stops threat coming off the main scheme", () => {
  const p = scenarioOf(deal(), stack(QUIET, "02009"));
  villainPhase(p);
  expect(enemy(p, "Collapsing Bridge")).toMatchObject({ type: "side_scheme", threat: 2 });
  expect(revealOf(p, "Collapsing Bridge")).toBeGreaterThanOrEqual(0);
  // RRG 1.8 "Crisis Icon": threat cannot be removed from the main scheme while it is in play.
  expect(mainScheme(p).threatLock).toBeTruthy();
});

test("02009 Collapsing Bridge as a boost card: no icons, and its [star] Boost places 1 infamy counter", () => {
  const p = scenarioOf(deal(), schemeThreat(0), stack("02009", "02010"));
  villainPhase(p);
  expect(p.beats[boostFlip(p, "Collapsing Bridge")]!.reveal!.boost!.icons).toBe(0);
  expect(counterBeat(p, "infamy", 1)).toBeGreaterThan(boostFlip(p, "Collapsing Bridge"));
  expect(mainScheme(p).threat).toBe(3);
});

// ===============================================================================================================
// 02010 Oscorp Manufacturing
// ===============================================================================================================

test("02010 Oscorp Manufacturing (Norman Osborn): enters with 2 threat plus an additional 1", () => {
  const p = scenarioOf(deal(), stack("02010"));
  p.form();
  villainPhase(p);
  // Starting threat 2[per_hero]; "When Revealed (Norman Osborn): Place an additional 1[per_hero] threat here."
  expect(enemy(p, "Oscorp Manufacturing")?.threat).toBe(3);
  const scheme = enemy(p, "Oscorp Manufacturing")!.id;
  expect(beat(p, (b) => b.threat?.scheme === scheme && b.threat.delta === 1)).toBeGreaterThan(
    revealOf(p, "Oscorp Manufacturing"),
  );
});

test("02010 Oscorp Manufacturing (Green Goblin): only its 2 starting threat", () => {
  const p = scenarioOf(deal(), goblin(3), stack("02010"));
  villainPhase(p);
  expect(enemy(p, "Oscorp Manufacturing")?.threat).toBe(2);
});

test("02010 Oscorp Manufacturing: its acceleration icon adds 1 threat at step 1", () => {
  const p = scenarioOf(deal(), sideScheme("02010", 2), stack("02009"));
  p.form();
  villainPhase(p);
  // Step 1: Hostile Takeover's acceleration 1 plus 1 for the acceleration icon (RRG 1.8 "Acceleration Icon").
  expect(beat(p, (b) => b.threat?.scheme === mainScheme(p).id && b.threat.delta === 2)).toBeGreaterThanOrEqual(0);
  expect(mainScheme(p).threat).toBe(4);
});

test("02010 Oscorp Manufacturing as a boost card: 3 icons", () => {
  const p = scenarioOf(deal(), schemeThreat(0), stack("02010", "02009"));
  villainPhase(p);
  expect(p.beats[boostFlip(p, "Oscorp Manufacturing")]!.reveal!.boost!.icons).toBe(3);
  expect(mainScheme(p).threat).toBe(6);
});

// ===============================================================================================================
// 02011 Payoff
// ===============================================================================================================

test("02011 Payoff: enters with 2 threat; its hazard icon deals one more encounter card each villain phase", () => {
  const p = scenarioOf(deal(), stack("02011"));
  p.form();
  villainPhase(p);
  expect(enemy(p, "Payoff")).toMatchObject({ type: "side_scheme", threat: 2 });
  const q = scenarioOf(deal(), sideScheme("02011", 2), stack("02009", "02010"));
  q.form();
  villainPhase(q);
  expect(q.beats.filter((b) => b.encounterDeal && !b.boostFor)).toHaveLength(2);
  expect(revealOf(q, "Collapsing Bridge")).toBeGreaterThanOrEqual(0);
  expect(revealOf(q, "Oscorp Manufacturing")).toBeGreaterThanOrEqual(0);
});

test("02011 Payoff as a boost card: 1 icon, and its [star] Boost places 1 infamy counter", () => {
  const p = scenarioOf(deal(), schemeThreat(0), stack("02011", "02009"));
  villainPhase(p);
  expect(p.beats[boostFlip(p, "Payoff")]!.reveal!.boost!.icons).toBe(1);
  expect(counterBeat(p, "infamy", 1)).toBeGreaterThan(boostFlip(p, "Payoff"));
  expect(mainScheme(p).threat).toBe(4);
});

// ===============================================================================================================
// 02012 All in a Day's Work
// ===============================================================================================================

test("02012 All in a Day's Work (Criminal Enterprise up): places 2 infamy counters", () => {
  const p = scenarioOf(deal(), stack(QUIET, "02012"));
  villainPhase(p);
  expect(counterBeat(p, "infamy", 2)).toBeGreaterThan(revealOf(p, "All in a Day's Work"));
  expect(marker(env(p), "infamy")).toBe(4);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("All in a Day's Work");
});

test("02012 All in a Day's Work (State of Madness up): removes 2 madness counters instead", () => {
  const p = scenarioOf(deal(), goblin(5), stack("02012"));
  villainPhase(p);
  // Goblin's scheme takes 1, All in a Day's Work 2: 5 - 1 - 2.
  expect(counterBeat(p, "madness", -2)).toBeGreaterThan(revealOf(p, "All in a Day's Work"));
  expect(marker(env(p), "madness")).toBe(2);
  expect(p.snap.villain.name).toBe("Green Goblin");
});

test("02012 All in a Day's Work as a boost card: no icons, and its [star] Boost places 1 infamy counter", () => {
  const p = scenarioOf(deal(), schemeThreat(0), stack("02012", "02009"));
  villainPhase(p);
  expect(p.beats[boostFlip(p, "All in a Day's Work")]!.reveal!.boost!.icons).toBe(0);
  expect(counterBeat(p, "infamy", 1)).toBeGreaterThan(boostFlip(p, "All in a Day's Work"));
  expect(mainScheme(p).threat).toBe(3);
});

// ===============================================================================================================
// 02013 Mad Genius
// ===============================================================================================================

test("02013 Mad Genius (Norman Osborn): discards the top card of the deck for each infamy counter", () => {
  const p = scenarioOf(deal(), infamy(3), stack("02013"));
  p.form();
  const before = p.battle.game.players[0]!.discard.length;
  villainPhase(p);
  // 3 + 1 from Norman's would-attack = 4 infamy counters when Mad Genius resolves.
  const milled = beat(p, (b) => !!b.milled);
  expect(milled).toBeGreaterThan(revealOf(p, "Mad Genius"));
  expect(p.beats[milled]!.milled).toHaveLength(4);
  expect(p.battle.game.players[0]!.discard.length - before).toBeGreaterThanOrEqual(4);
});

test("02013 Mad Genius (Green Goblin): Green Goblin attacks the hero, with a boost card of its own", () => {
  const p = scenarioOf(deal(), goblin(3), stack(QUIET, "02013", QUIET2));
  p.form();
  villainPhase(p);
  // His own attack (3) and Mad Genius's (3 + Assault's 0 icons).
  expect(hits(p, heroId(p))).toEqual([3, 3]);
  expect(p.snap.heroHp).toBe(4);
  expect(boostFlip(p, "Assault")).toBeGreaterThan(revealOf(p, "Mad Genius"));
  expect(p.beats.some((b) => b.surge)).toBe(false);
});

test("02013 Mad Genius (Green Goblin), player in alter-ego form: no attack is made, so it gains surge", () => {
  const p = scenarioOf(deal(), goblin(4), stack("02013", "02012"));
  villainPhase(p);
  // "If no attack was made this way, this card gains surge." The surge deals All in a Day's Work: -2 madness.
  const reveal = revealOf(p, "Mad Genius");
  const surge = beat(p, (b) => b.surge === p.beats[reveal]!.reveal!.id);
  expect(surge).toBeGreaterThan(reveal);
  expect(revealOf(p, "All in a Day's Work")).toBeGreaterThan(surge);
  expect(hits(p, heroId(p))).toEqual([]);
  expect(marker(env(p), "madness")).toBe(1);
});

test("02013 Mad Genius: the reveal tells the player which half applies (Green Goblin, alter-ego: nobody to attack)", () => {
  // BUG (table): Mad Genius has a When Revealed per villain face ("(Green Goblin)" / "(Norman Osborn)"). The reveal beat
  // says neither which half applies (`applies` covers only the hero's form halves) nor, with Green Goblin up and the
  // player in alter-ego form, that there is no hero to attack (`noHeroToAttack`, as Swarm Attack gets): the player
  // sees the card, then a surge, with nothing saying why.
  const p = scenarioOf(deal(), goblin(4), stack("02013", "02012"));
  villainPhase(p);
  const reveal = p.beats[revealOf(p, "Mad Genius")]!.reveal!;
  expect(reveal.noHeroToAttack ?? reveal.applies).toBeDefined();
});

// ===============================================================================================================
// 02041 Power Drain
// ===============================================================================================================

test("02041 Power Drain: enters with 2 threat; its acceleration icon adds 1 threat at step 1", () => {
  const p = scenarioOf(deal(), stack("02041", "02009"));
  p.form();
  villainPhase(p);
  expect(enemy(p, "Power Drain")).toMatchObject({ type: "side_scheme", threat: 2 });
  villainPhase(p);
  expect(beat(p, (b) => b.threat?.scheme === mainScheme(p).id && b.threat.delta === 2)).toBeGreaterThanOrEqual(0);
});

/** Spider-Man thwarts Power Drain (1 threat left) off the table; Payoff (1 icon) and Lightning Bolt (1 icon) are next. */
function defeatPowerDrain() {
  const p = scenarioOf(deal(), sideScheme("02041", 1), stack("02011", "02044"));
  p.form();
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicThwart"))).toBe(true);
  // Two schemes: the table asks which to thwart.
  expect(p.snap.choice?.prompt).toBe("Choose a scheme to thwart");
  const id = enemy(p, "Power Drain")!.id;
  p.choose({ card: id });
  return Object.assign(p, { powerDrain: id });
}

test("02041 Power Drain: When Defeated discards 2 encounter cards; the player discards a resource per boost icon", () => {
  const p = defeatPowerDrain();
  const defeated = beat(p, (b) => b.defeatedCard === p.powerDrain || b.leftPlay === p.powerDrain);
  expect(defeated, JSON.stringify(p.beats)).toBeGreaterThanOrEqual(0);
  expect(milledBeat(p)).toEqual(["Payoff", "Lightning Bolt"]);
  // 1 + 1 boost icons: the player picks 2 cards from the hand (each prints a resource icon), Power Drain asking.
  const choice = p.snap.choice!;
  expect(choice).toMatchObject({ min: 2, max: 2 });
  expect(nameOf(p, p.snap.choiceSource!)).toBe("Power Drain");
  const hand = p.snap.hand.length;
  expect(choice.options.map((o) => o.cardId).sort()).toEqual(p.snap.hand.map((c) => c.id).sort());
  expect(p.run(() => p.battle.chooseMany(choice.options.slice(0, 2).map((o) => o.id)))).toBe(true);
  expect(p.snap.hand).toHaveLength(hand - 2);
  expect(p.beats.find((b) => b.handDiscard)?.handDiscard).toHaveLength(2);
  expect(enemy(p, "Power Drain")).toBeUndefined();
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Power Drain");
});

test("02041 Power Drain: the resource discard is asked as a discard from the hand, in words that say so", () => {
  // BUG (table): Power Drain's "Each player must choose and discard 1 resource of any type from their hand for each
  // boost icon discarded this way" is asked as "Choose a target" over the hand's cards, not as a discard from the hand
  // (`discardFromHand` false): nothing says the 2 picked cards will be discarded, or why 2.
  const p = defeatPowerDrain();
  const choice = p.snap.choice!;
  expect(choice.discardFromHand || /discard/i.test(choice.prompt)).toBe(true);
});

// ===============================================================================================================
// 02042 Electro
// ===============================================================================================================

test("02042 Electro: after he attacks, 1 encounter card is discarded and the player takes 1 indirect damage per boost icon", () => {
  const p = scenarioOf(deal(), engageMinion("02042"), stack("02010", "02012"));
  p.form();
  villainPhase(p);
  // Electro's ATK 2, then Oscorp Manufacturing (3 icons) discarded: 3 indirect damage.
  const electro = enemy(p, "Electro")!.id;
  const hit = beat(p, (b) => b.hit?.source === electro && b.hit.target === heroId(p) && b.hit.amount === 2);
  expect(hit).toBeGreaterThanOrEqual(0);
  const milled = beat(p, (b) => !!b.encounterMilled);
  expect(milled).toBeGreaterThan(hit);
  expect(milledBeat(p)).toEqual(["Oscorp Manufacturing"]);
  expect(p.snap.heroHp).toBe(5);
  expect(revealOf(p, "All in a Day's Work")).toBeGreaterThan(milled);
});

test("02042 Electro as a boost card: 2 icons, and its [star] Boost discards 3 encounter cards", () => {
  const p = scenarioOf(deal(), schemeThreat(0), stack("02042", "02009", "02010", "02011", "02012"));
  villainPhase(p);
  expect(p.beats[boostFlip(p, "Electro")]!.reveal!.boost!.icons).toBe(2);
  expect(milledBeat(p)).toEqual(["Collapsing Bridge", "Oscorp Manufacturing", "Payoff"]);
  expect(mainScheme(p).threat).toBe(5);
  expect(revealOf(p, "All in a Day's Work")).toBeGreaterThan(boostFlip(p, "Electro"));
});

// ===============================================================================================================
// 02043 Electromagnetic Pulse
// ===============================================================================================================

const SEVEN = ["02009", "02010", "02011", "02011", "02012", "02012", "02013"];

test("02043 Electromagnetic Pulse: discards 7; Electro among them comes into play engaged with the player", () => {
  const seven = [...SEVEN.slice(0, 3), "02042", ...SEVEN.slice(3, 6)];
  const p = scenarioOf(deal(), stack("02043", ...seven));
  p.form();
  villainPhase(p);
  const milled = milledBeat(p);
  expect(milled).toHaveLength(7);
  expect(milled).toContain("Electro");
  const electro = enemy(p, "Electro");
  expect(electro).toBeDefined();
  expect(p.battle.game.instances[electro!.id as engine.InstanceId]!.engagedWith).toBe(
    p.battle.game.players[0]!.playerId,
  );
  expect(beat(p, (b) => b.entersPlay === electro!.id || b.reveal?.id === electro!.id)).toBeGreaterThan(
    revealOf(p, "Electromagnetic Pulse"),
  );
  expect(p.beats.some((b) => b.surge)).toBe(false);
});

test("02043 Electromagnetic Pulse: with no Electro among the 7, it gains surge", () => {
  const p = scenarioOf(deal(), stack("02043", ...SEVEN, "02012"));
  p.form();
  villainPhase(p);
  expect(milledBeat(p)).toHaveLength(7);
  const reveal = revealOf(p, "Electromagnetic Pulse");
  const surge = beat(p, (b) => b.surge === p.beats[reveal]!.reveal!.id);
  expect(surge).toBeGreaterThan(reveal);
  expect(revealOf(p, "All in a Day's Work")).toBeGreaterThan(surge);
  expect(enemy(p, "Electro")).toBeUndefined();
});

// ===============================================================================================================
// 02044 Lightning Bolt
// ===============================================================================================================

test("02044 Lightning Bolt: discards 2 encounter cards; 1 indirect damage per boost icon", () => {
  const p = scenarioOf(deal(), stack("02044", "02010", "02011"));
  p.form();
  villainPhase(p);
  // Oscorp Manufacturing (3) + Payoff (1).
  expect(milledBeat(p)).toEqual(["Oscorp Manufacturing", "Payoff"]);
  expect(p.snap.heroHp).toBe(6);
  expect(beat(p, (b) => b.hit?.target === heroId(p) && b.hit.amount === 4)).toBeGreaterThan(
    revealOf(p, "Lightning Bolt"),
  );
});

test("02044 Lightning Bolt: with an ally in play the player is asked to divide the indirect damage", () => {
  const p = scenarioOf(deal(), JESSICA_HAND, stack("02044", "02010", "02011"));
  const jessica = playJessica(p);
  p.form();
  const asked = villainPhase(p, (c) =>
    c.indirect
      ? c.options
          .filter((o) => o.cardId === heroId(p))
          .slice(0, c.indirect.amount)
          .map((o) => o.id)
      : undefined,
  );
  const choice = asked.find((c) => c.indirect);
  expect(choice?.indirect).toEqual({ amount: 4 });
  expect(choice!.options.some((o) => o.cardId === jessica.id)).toBe(true);
  expect(p.snap.heroHp).toBe(6);
});

// ===============================================================================================================
// 02045 Shock Therapy
// ===============================================================================================================

test("02045 Shock Therapy: discards 1[per_hero] encounter card; the villain heals 1 per boost icon", () => {
  const p = scenarioOf(deal(), goblin(4), villainDamage(5), stack("02045", "02010"));
  villainPhase(p);
  // Oscorp Manufacturing: 3 icons, so 5 damage becomes 2.
  expect(milledBeat(p)).toEqual(["Oscorp Manufacturing"]);
  expect(p.battle.game.instances[villainId(p)]!.damage).toBe(2);
  expect(p.snap.villainHp).toBe(12);
});

// ===============================================================================================================
// The Power Drain treacheries as boost cards: "[star] Boost: Discard 3 cards from the encounter deck."
// ===============================================================================================================

test.each([
  ["02043", "Electromagnetic Pulse", 2],
  ["02044", "Lightning Bolt", 1],
  ["02045", "Shock Therapy", 1],
] as const)(
  "%s %s as a boost card: %i icon(s), and its [star] Boost discards 3 encounter cards",
  (code, name, icons) => {
    const p = scenarioOf(deal(), schemeThreat(0), stack(code, "02009", "02010", "02011", "02012"));
    villainPhase(p);
    expect(p.beats[boostFlip(p, name)]!.reveal!.boost!.icons).toBe(icons);
    expect(milledBeat(p)).toEqual(["Collapsing Bridge", "Oscorp Manufacturing", "Payoff"]);
    expect(mainScheme(p).threat).toBe(1 + 2 + icons);
    expect(revealOf(p, "All in a Day's Work")).toBeGreaterThan(boostFlip(p, name));
  },
);
