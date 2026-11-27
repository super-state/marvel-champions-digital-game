/**
 * The Green Goblin pack's Mutagen Formula scenario on the 3D table, card by card: the villain Green Goblin (02014 /
 * 02015 / 02016, stages I to III), the main scheme Unleashing the Mutagen (02017a/b) and its second stage Mutagen Cloud
 * (02018a/b), the Mutagen Formula encounter set (02019 to 02032) and the Goblin Gimmicks module it recommends (02033 to
 * 02036). Each card is made to happen as it would in a game (revealed in the villain phase in either form, dealt as a
 * boost card, attacked with, defeated, thwarted, its Hero Action used from the table) and checked twice: what the rules
 * engine did (threat, damage, statuses, where the cards went) and what the table shows (a beat for it, the words of the
 * question it asks, the action it offers on the card). The driver's watch fails the file on anything the table doesn't
 * show (`shown-check.ts`).
 *
 * Spider-Man plays every game, dealt Mutagen Formula with Goblin Gimmicks and Running Interference: Running
 * Interference brings All Tied Up (02048), which prints no boost icon and no Boost ability, so it is the villain's
 * "quiet" boost card wherever the boost card is not what the test is about (with the Standard set's two Advance, 01186,
 * also 0 icons and no Boost ability, as the second and third). The setup's Goblin Thrall is taken out of play where it
 * would get in the way (`noThrall`).
 */
import { expect, test } from "vitest";
import * as engine from "@mc/engine";
import {
  codeOf,
  engageMinion,
  handOf,
  patchByCode,
  patchCard,
  Player,
  scenarioOf,
  stack,
  villainPhase,
  type Choice,
  type Id,
  type Setup,
} from "./deck-audit-driver.js";
import type { BattleBeat } from "./model.js";

const QUIET = "02048";
const QUIET2 = "01186";
/** Dealt last, where a test needs one more card off the deck: a Goblin Thrall only takes its place engaged. */
const FILLER = "02024";

const deal = (...steps: Setup[]) =>
  scenarioOf(
    { hero: "spider-man", villain: "mutagen-formula", modules: ["goblin_gimmicks", "running_interference"], seed: 75 },
    ...steps,
  );
const expertDeal = (...steps: Setup[]) =>
  scenarioOf(
    {
      hero: "spider-man",
      villain: "mutagen-formula",
      modules: ["goblin_gimmicks", "running_interference"],
      seed: 75,
      difficulty: "expert",
    },
    ...steps,
  );

/** Take the Goblin Thrall the main scheme's Setup engaged with the hero out of play (to the encounter discard pile). */
const noThrall: Setup = (state) => {
  const p = state.players[0]!;
  const thrall = p.playArea.find((i) => codeOf(state, i) === "02024");
  if (!thrall) return state;
  const key = engine.activeEncounterDeckId(state);
  const piles = engine.activeEncounterDeck(state);
  return {
    ...state,
    players: [{ ...p, playArea: p.playArea.filter((i) => i !== thrall) }],
    instances: { ...state.instances, [thrall]: { ...state.instances[thrall]!, engagedWith: null } },
    encounterDecks: { ...state.encounterDecks, [key]: { ...piles, discard: [...piles.discard, thrall] } },
  };
};

/** Return any encounter cards already dealt to the player (Green Goblin II's at an expert setup) to the deck's bottom. */
const noDealt: Setup = (state) => {
  const p = state.players[0]!;
  const key = engine.activeEncounterDeckId(state);
  const piles = engine.activeEncounterDeck(state);
  return {
    ...state,
    players: [{ ...p, dealtEncounter: [] }],
    encounterDecks: { ...state.encounterDecks, [key]: { ...piles, deck: [...piles.deck, ...p.dealtEncounter] } },
  };
};

/** Take an encounter card out of the encounter deck (or its discard pile). */
function takeEncounter(state: engine.GameState, code: string) {
  const piles = engine.activeEncounterDeck(state);
  const id = [...piles.deck, ...piles.discard].find((i) => codeOf(state, i) === code);
  if (!id) throw Error(`no ${code} in the encounter deck`);
  const key = engine.activeEncounterDeckId(state);
  const encounterDecks = {
    ...state.encounterDecks,
    [key]: { ...piles, deck: piles.deck.filter((i) => i !== id), discard: piles.discard.filter((i) => i !== id) },
  };
  return { id, encounterDecks };
}

/** Attach an encounter card to Green Goblin (already in play, so no When Revealed). */
const attachedToVillain =
  (code: string): Setup =>
  (state) => {
    const { id, encounterDecks } = takeEncounter(state, code);
    const v = state.villains[0]!.instanceId;
    return {
      ...state,
      encounterDecks,
      instances: {
        ...state.instances,
        [id]: { ...state.instances[id]!, faceup: true, attachedTo: v },
        [v]: { ...state.instances[v]!, attachments: [...state.instances[v]!.attachments, id] },
      },
    };
  };

/** A side scheme already in play (no When Revealed), with this much threat. */
const sideScheme =
  (code: string, threat: number): Setup =>
  (state) => {
    const { id, encounterDecks } = takeEncounter(state, code);
    return {
      ...state,
      encounterDecks,
      villainArea: [...state.villainArea, id],
      instances: { ...state.instances, [id]: { ...state.instances[id]!, faceup: true, threat } },
    };
  };

/** Set the threat on the main scheme. */
const mainAt =
  (threat: number): Setup =>
  (state) => {
    const id = state.mainScheme.instanceId;
    return { ...state, instances: { ...state.instances, [id]: { ...state.instances[id]!, threat } } };
  };

const mainThreat = (p: Player) => p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat!;
const mainScheme = (p: Player) => p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
const enemy = (p: Player, name: string) => p.snap.enemyCards.find((c) => c.name === name);
const enemies = (p: Player, name: string) => p.snap.enemyCards.filter((c) => c.name === name);
const discardNames = (p: Player) => p.snap.encounterDiscard.map((c) => c.name);
const marker = (c: { markers: { name: string; count: number }[] } | undefined, name: string) =>
  c?.markers.find((m) => m.name === name)?.count ?? 0;
const said = (p: Player) => p.beats.map((b) => b.text).join(" | ");
/** The index of the first beat matching, asserted to be there. */
function at(p: Player, label: string, f: (b: BattleBeat) => boolean, from = 0) {
  const i = p.beats.findIndex((b, n) => n >= from && f(b));
  expect(i, `no beat: ${label}\n${said(p)}`).toBeGreaterThanOrEqual(0);
  return i;
}
const revealOf = (name: string) => (b: BattleBeat) => b.reveal?.name === name && !b.reveal.boost;
const boostOf = (name: string) => (b: BattleBeat) => b.reveal?.name === name && !!b.reveal.boost;
const boostIcons = (name: string, icons: number) => (b: BattleBeat) =>
  b.reveal?.name === name && b.reveal.boost?.icons === icons;
/** A beat that shows the named card going back into the encounter deck. */
const backIntoDeck = (name: string) => (b: BattleBeat) =>
  !!b.intoEncounterDeck?.some((c) => c.name === name) || (b.text.includes(name) && /encounter deck/i.test(b.text));
/** Copies of a printed code in the encounter deck, read from the engine. */
const inEncounterDeck = (p: Player, code: string) =>
  engine.activeEncounterDeck(p.battle.game).deck.filter((i) => codeOf(p.battle.game, i) === code).length;
const engagedWithHero = (p: Player, id: string) =>
  p.battle.game.instances[id as Id]?.engagedWith === p.battle.game.players[0]!.playerId;
const hitOn = (p: Player, amount?: number) => (b: BattleBeat) =>
  b.hit?.target === p.snap.hero.id && (amount === undefined || b.hit.amount === amount);
const threatOn = (p: Player, delta?: number) => (b: BattleBeat) =>
  b.threat?.scheme === mainScheme(p).id && (delta === undefined || b.threat.delta === delta);

/** Use the Hero Action printed on an encounter card in play, paying with the named hand cards. */
function enemyAction(p: Player, name: string, pay: string[]) {
  const card = p.card(name, "enemyCards");
  const actions = p.battle.fieldActions(card.id);
  expect(actions.length, `${name} offers an action`).toBeGreaterThan(0);
  expect(p.run(() => p.battle.fieldAction(card.id, actions[0]!.kind))).toBe(true);
  const payment = p.spend(...pay);
  expect(p.run(() => p.battle.pay())).toBe(true);
  return { card, actions, payment };
}

/** End the turn and play the villain phase out, defending with Spider-Man himself whenever he is attacked. */
function villainPhaseDefended(p: Player) {
  p.mark();
  p.end();
  p.drive({ defend: (choice: Choice) => choice.options.find((o) => o.label === "Defend")!.id });
}

// =====================================================================================================================
// 02014 / 02015 / 02016 Green Goblin
// =====================================================================================================================

test("02014 Green Goblin (I): his attack that damages you places 1 threat on the main scheme", () => {
  const p = deal(noThrall, stack(QUIET, FILLER));
  p.form();
  villainPhase(p);
  // Step 1: Unleashing the Mutagen's acceleration (1 per player) takes 2 to 3; his Forced Response adds 1.
  const hit = at(p, "Green Goblin hits Spider-Man for 2", hitOn(p, 2));
  const placed = at(p, "his Forced Response's threat", threatOn(p, 1), hit);
  expect(p.beats[placed]!.actor).toBe(p.snap.villain.id);
  expect(p.snap.heroHp).toBe(8);
  expect(mainThreat(p)).toBe(4);
});

test("02014 Green Goblin (I): an attack that deals no damage places no threat", () => {
  // Spider-Man defends: DEF 3 against ATK 2, so no damage reaches him and the Forced Response doesn't trigger.
  const p = deal(noThrall, stack(QUIET, FILLER));
  p.form();
  villainPhaseDefended(p);
  expect(p.snap.heroHp).toBe(10);
  expect(mainThreat(p)).toBe(3);
  expect(p.beats.filter(threatOn(p))).toHaveLength(1);
});

test("02014 Green Goblin (I): in alter-ego form he schemes instead (SCH 1)", () => {
  const p = deal(noThrall, stack(QUIET, FILLER));
  villainPhase(p);
  const scheming = at(p, "Green Goblin schemes", (b) => b.scheming === p.snap.villain.id);
  expect(at(p, "his 1 threat", threatOn(p, 1), scheming)).toBeGreaterThan(scheming);
  expect(mainThreat(p)).toBe(4);
  expect(p.snap.heroHp).toBe(10);
});

test("02015 Green Goblin (II): defeating stage I reveals stage II, which deals 2 encounter cards to the player", () => {
  const p = deal(noThrall, patchByCode("villain", { damage: 15 }), stack(FILLER, FILLER, QUIET, FILLER));
  p.form();
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  const stage = at(p, "stage II", (b) => b.villainStage === 2);
  expect(p.beats.filter((b, i) => i > stage && !!b.encounterDeal && !b.boostFor)).toHaveLength(2);
  expect(p.snap.villain.name).toBe("Green Goblin");
  expect(p.snap.villainHp).toBe(18);
  expect(p.snap.facedownEncounters).toHaveLength(2);
  // Both are revealed in the villain phase, with the one dealt there: three Goblin Thralls engage.
  villainPhase(p);
  expect(p.beats.filter(revealOf("Goblin Thrall"))).toHaveLength(3);
  expect(enemies(p, "Goblin Thrall")).toHaveLength(3);
});

test("02015 Green Goblin (II): his attack that damages you places 1 threat", () => {
  const p = expertDeal(noDealt, noThrall, stack(QUIET, FILLER));
  expect(p.snap.villainHp).toBe(18);
  p.form();
  const before = mainThreat(p);
  villainPhase(p);
  const hit = at(p, "hit", hitOn(p, 2));
  at(p, "his Forced Response's threat", threatOn(p, 1), hit);
  expect(mainThreat(p)).toBe(before + 2);
});

test("02015 Green Goblin (II): an expert game starts at stage II, and its When Revealed deals 2 cards at setup", () => {
  // RRG v1.8 Setup step 12c: "Resolve any Setup and When Revealed abilities on the villain."
  const p = expertDeal();
  expect(p.snap.villainHp).toBe(18);
  expect(p.snap.facedownEncounters).toHaveLength(2);
});

test("02016 Green Goblin (III): revealed, he deals 3 encounter cards; his attack that damages you places 2 threat", () => {
  const p = expertDeal(
    noDealt,
    noThrall,
    patchByCode("villain", { damage: 17 }),
    stack(FILLER, FILLER, FILLER, QUIET, FILLER),
  );
  p.form();
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  const stage = at(p, "stage III", (b) => b.villainStage === 3);
  expect(p.beats.filter((b, i) => i > stage && !!b.encounterDeal)).toHaveLength(3);
  expect(p.snap.villainHp).toBe(20);
  expect(p.snap.facedownEncounters).toHaveLength(3);
  const before = mainThreat(p);
  // ATK 3: the 3 thralls' guard doesn't matter to the villain's own attack.
  villainPhase(p);
  const hit = at(p, "Green Goblin III hits for 3", (b) => hitOn(p, 3)(b) && b.hit!.source === p.snap.villain.id);
  at(p, "his Forced Response's 2 threat", threatOn(p, 2), hit);
  // Step 1 places 1 (acceleration), then his Forced Response places 2.
  expect(mainThreat(p)).toBe(before + 3);
});

// =====================================================================================================================
// 02017a/b Unleashing the Mutagen, 02018a/b Mutagen Cloud
// =====================================================================================================================

test("02017a Unleashing the Mutagen: Setup puts a Goblin Thrall into play engaged with the hero, the scheme at 2 of 7", () => {
  const p = deal();
  const thrall = enemy(p, "Goblin Thrall");
  expect(thrall).toBeDefined();
  expect(thrall!.guard).toBe(true);
  expect(mainScheme(p).name).toBe("Unleashing the Mutagen");
  expect(mainScheme(p).threat).toBe(2);
  expect(mainScheme(p).threatTarget).toBe(7);
});

test("02017b Unleashing the Mutagen: completed with no Goblin minion engaged, 3 cards are discarded and the first Goblin minion engages", () => {
  // Step 1 places 1 threat: 6 + 1 = 7 completes stage 1B.
  const p = deal(noThrall, mainAt(6), stack("02036", "02023", "02024", QUIET, FILLER));
  p.form();
  villainPhase(p);
  const milled = at(p, "3 cards discarded", (b) => (b.encounterMilled?.length ?? 0) > 0);
  expect(p.beats.flatMap((b) => b.encounterMilled ?? [])).toHaveLength(3);
  at(p, "Goblin Soldier enters play", (b) => !!b.entersPlay, milled);
  const advance = at(p, "the scheme turns to Mutagen Cloud", (b) => b.schemeAdvance?.to === "Mutagen Cloud");
  // Mutagen Cloud 2B: starting threat 4 and target 11, per player (placed on its own beat after the turn).
  expect(p.beats[advance]!.schemeAdvance).toMatchObject({ from: "Unleashing the Mutagen", target: 11 });
  at(p, "Mutagen Cloud's starting 4 threat", (b) => threatOn(p, 4)(b) && b.threat!.to === 4, advance);
  expect(enemy(p, "Goblin Soldier")).toBeDefined();
  // Only the first Goblin minion: the Goblin Thrall discarded after it stays in the discard pile.
  expect(discardNames(p)).toEqual(expect.arrayContaining(["Regenerative Healing", "Goblin Thrall"]));
  expect(mainScheme(p).name).toBe("Mutagen Cloud");
  expect(mainScheme(p).threatTarget).toBe(11);
});

// BUG: the beat for 1B's When Completed discard says "Mutagen Cloud: discard the top 3 cards of the encounter deck
// (...)". The ability is printed on Unleashing the Mutagen 1B ("When Completed: ... discard 3 cards from the encounter
// deck"); the table names the stage the scheme turns to, before its own "Unleashing the Mutagen is completed" beat.
test("02017b Unleashing the Mutagen: the When Completed discard is credited to Unleashing the Mutagen", () => {
  const p = deal(noThrall, mainAt(6), stack("02036", "02023", "02024", QUIET, FILLER));
  villainPhase(p);
  const milled = at(p, "3 cards discarded", (b) => (b.encounterMilled?.length ?? 0) > 0);
  expect(p.beats[milled]!.text).toMatch(/^Unleashing the Mutagen\b/);
});

test("02017b Unleashing the Mutagen: completed while a Goblin minion is engaged, nothing is discarded", () => {
  const p = deal(mainAt(6), stack(QUIET, FILLER));
  p.form();
  villainPhase(p);
  expect(p.beats.some((b) => (b.encounterMilled?.length ?? 0) > 0)).toBe(false);
  expect(mainScheme(p).name).toBe("Mutagen Cloud");
});

test("02018b Mutagen Cloud: its acceleration X is the number of Goblin enemies in play, Green Goblin included", () => {
  const p = deal(noThrall, mainAt(6), stack("02036", "02023", "02024", QUIET, FILLER, QUIET2, FILLER));
  villainPhase(p);
  expect(mainScheme(p).name).toBe("Mutagen Cloud");
  // Green Goblin, the Goblin Soldier the completion brought in and the Goblin Thrall dealt after: 3 Goblin enemies.
  const goblins = 1 + enemies(p, "Goblin Soldier").length + enemies(p, "Goblin Thrall").length;
  expect(goblins).toBe(3);
  const before = mainThreat(p);
  villainPhase(p);
  const first = p.beats.find(threatOn(p));
  expect(first?.threat?.delta, said(p)).toBe(goblins);
  expect(mainThreat(p)).toBeGreaterThanOrEqual(before + goblins);
});

test("02018b Mutagen Cloud: if this stage is completed, the players lose the game", () => {
  const cloud: Setup = (state) => ({ ...state, mainScheme: { ...state.mainScheme, stageIndex: 1 } });
  const p = deal(cloud, mainAt(10), stack(QUIET, FILLER));
  expect(mainScheme(p).name).toBe("Mutagen Cloud");
  expect(mainScheme(p).threatTarget).toBe(11);
  villainPhase(p);
  expect(p.snap.outcome).toEqual({ result: "loss", reason: "mainSchemeCompleted" });
  at(p, "the game ends", (b) => !!b.gameEnded);
});

// =====================================================================================================================
// 02019 / 02033 Goblin Glider
// =====================================================================================================================

test("02019 Goblin Glider: revealed, it attaches to Green Goblin (highest printed hit points) for +1 ATK", () => {
  const p = deal(stack(QUIET, "02019"));
  villainPhase(p);
  const reveal = at(p, "Goblin Glider revealed", revealOf("Goblin Glider"));
  at(p, "+1 ATK on Green Goblin", (b) => b.modifier?.id === p.snap.villain.id && b.modifier.count === 1, reveal);
  expect(enemy(p, "Goblin Glider")?.attachedTo).toBe(p.snap.villain.id);
});

test("02019 Goblin Glider: Green Goblin attacks with its +1 ATK", () => {
  const p = deal(noThrall, attachedToVillain("02019"), stack(QUIET, FILLER));
  p.form();
  villainPhase(p);
  at(p, "Green Goblin hits for 3", hitOn(p, 3));
  expect(p.snap.heroHp).toBe(7);
});

test("02033 Goblin Glider: a second Glider goes to the enemy with the next highest printed hit points (Goblin Knight, 7)", () => {
  // Green Goblin (16) already has one; of the Goblin Knight (7) and the Goblin Thrall (3), the Knight.
  const p = deal(attachedToVillain("02019"), engageMinion("02022"), stack(QUIET, "02033"));
  const knight = enemy(p, "Goblin Knight")!;
  villainPhase(p);
  const gliders = enemies(p, "Goblin Glider");
  expect(gliders.map((g) => g.attachedTo).sort()).toEqual([p.snap.villain.id, knight.id].sort());
  at(p, "+1 ATK on the Knight", (b) => b.modifier?.id === knight.id && b.modifier.count === 1);
});

test("02033 Goblin Glider: a second Glider attaches to the next enemy without one (the Goblin Thrall)", () => {
  const p = deal(attachedToVillain("02019"), stack(QUIET, "02033"));
  const thrall = enemy(p, "Goblin Thrall")!;
  villainPhase(p);
  const gliders = enemies(p, "Goblin Glider");
  expect(gliders.map((g) => g.attachedTo).sort()).toEqual([p.snap.villain.id, thrall.id].sort());
  at(p, "+1 ATK on the Thrall", (b) => b.modifier?.id === thrall.id && b.modifier.count === 1);
});

test("02033 Goblin Glider: with no enemy free of a Glider it can't attach, so it gains surge", () => {
  const p = deal(noThrall, attachedToVillain("02019"), stack(QUIET, "02033", FILLER));
  villainPhase(p);
  const reveal = at(p, "Goblin Glider revealed", revealOf("Goblin Glider"));
  const surge = at(p, "surge", (b) => !!b.surge, reveal);
  at(p, "the surge card revealed", revealOf("Goblin Thrall"), surge);
  expect(enemies(p, "Goblin Glider")).toHaveLength(1);
  expect(discardNames(p)).toContain("Goblin Glider");
});

test("02019 Goblin Glider: Hero Action, spend 2 energy to discard it, offered on the card", () => {
  const p = deal(noThrall, attachedToVillain("02019"), handOf("01088", "01089"));
  p.form();
  p.mark();
  const { payment } = enemyAction(p, "Goblin Glider", ["Energy"]);
  expect(payment.required).toBe(2);
  expect(enemy(p, "Goblin Glider")).toBeUndefined();
  expect(discardNames(p)).toContain("Goblin Glider");
  at(p, "the Glider leaves play", (b) => !!b.leftPlay);
  at(p, "Green Goblin's ATK back to printed", (b) => b.modifier?.id === p.snap.villain.id && b.modifier.count === 0);
});

test("02019 Goblin Glider: its Hero Action can't be paid with mental resources", () => {
  const p = deal(noThrall, attachedToVillain("02019"), handOf("01089"));
  p.form();
  const glider = p.card("Goblin Glider", "enemyCards");
  const actions = p.battle.fieldActions(glider.id);
  // Offered (the table lets the player try), but Genius's two mental resources never complete the payment.
  expect(actions.length).toBeGreaterThan(0);
  expect(p.battle.fieldAction(glider.id, actions[0]!.kind)).toBe(true);
  expect(p.snap.payment?.required).toBe(2);
  p.spend("Genius");
  expect(p.snap.payment!.canPay).toBe(false);
  expect(p.battle.pay()).toBe(false);
  expect(enemy(p, "Goblin Glider")).toBeDefined();
});

test("02019 Goblin Glider: its Hero Action is not offered in alter-ego form", () => {
  const p = deal(noThrall, attachedToVillain("02019"), handOf("01088"));
  expect(p.battle.fieldActions(p.card("Goblin Glider", "enemyCards").id)).toEqual([]);
});

test("02033 Goblin Glider: Hero Action, spend 2 energy to discard it", () => {
  const p = deal(noThrall, attachedToVillain("02033"), handOf("01088"));
  p.form();
  enemyAction(p, "Goblin Glider", ["Energy"]);
  expect(enemy(p, "Goblin Glider")).toBeUndefined();
});

// =====================================================================================================================
// 02020 Hysteria
// =====================================================================================================================

test("02020 Hysteria: revealed, it attaches to Green Goblin", () => {
  const p = deal(noThrall, stack(QUIET, "02020"));
  villainPhase(p);
  at(p, "Hysteria revealed", revealOf("Hysteria"));
  expect(enemy(p, "Hysteria")?.attachedTo).toBe(p.snap.villain.id);
});

test("02020 Hysteria: when Green Goblin attacks he is given 1 additional boost card", () => {
  const p = deal(noThrall, attachedToVillain("02020"), stack(QUIET, QUIET2, FILLER));
  p.form();
  villainPhase(p);
  expect(p.beats.filter((b) => b.boostFor === p.snap.villain.id)).toHaveLength(2);
  at(p, "All Tied Up turned up", boostOf("All Tied Up"));
  at(p, "Advance turned up", boostOf("Advance"));
  expect(discardNames(p)).toEqual(expect.arrayContaining(["All Tied Up", "Advance"]));
});

test("02020 Hysteria: when Green Goblin schemes he is given 1 additional boost card", () => {
  const p = deal(noThrall, attachedToVillain("02020"), stack(QUIET, "02021", FILLER));
  villainPhase(p);
  expect(p.beats.filter((b) => b.boostFor === p.snap.villain.id)).toHaveLength(2);
  // SCH 1 + Pumpkin Bombs' 2 boost icons: 3 threat, on top of step 1's 1.
  at(p, "3 threat from his scheme", threatOn(p, 3));
  expect(mainThreat(p)).toBe(6);
});

test("02020 Hysteria: Hero Action, spend 2 mental to discard it, offered on the card", () => {
  const p = deal(noThrall, attachedToVillain("02020"), handOf("01089", "01088"));
  p.form();
  p.mark();
  const { payment } = enemyAction(p, "Hysteria", ["Genius"]);
  expect(payment.required).toBe(2);
  expect(enemy(p, "Hysteria")).toBeUndefined();
  expect(discardNames(p)).toContain("Hysteria");
  at(p, "Hysteria leaves play", (b) => !!b.leftPlay);
});

// =====================================================================================================================
// 02021 / 02034 Pumpkin Bombs
// =====================================================================================================================

test("02021 Pumpkin Bombs: revealed, it attaches to the villain", () => {
  const p = deal(noThrall, stack(QUIET, "02021"));
  villainPhase(p);
  at(p, "Pumpkin Bombs revealed", revealOf("Pumpkin Bombs"));
  expect(enemy(p, "Pumpkin Bombs")?.attachedTo).toBe(p.snap.villain.id);
});

test("02021 Pumpkin Bombs: after the villain attacks you it is discarded and you take 2 indirect damage", () => {
  const p = deal(noThrall, attachedToVillain("02021"), stack(QUIET, FILLER));
  p.form();
  const asked = villainPhase(p);
  // Green Goblin's Forced Response and the bombs' trigger after the same attack: the player orders them.
  expect(asked.find((q) => q.prompt === "Order these effects")?.labels).toEqual([
    "Use Green Goblin",
    "Use Pumpkin Bombs",
  ]);
  const hit = at(p, "Green Goblin hits for 2", hitOn(p, 2));
  const gone = at(p, "the bombs leave play", (b) => !!b.leftPlay, hit);
  // With no ally to share it, all of the indirect damage lands on Spider-Man without a question.
  at(p, "2 indirect damage", (b) => hitOn(p, 2)(b) && b.hit!.source === p.beats[gone]!.leftPlay, gone);
  expect(enemy(p, "Pumpkin Bombs")).toBeUndefined();
  expect(discardNames(p)).toContain("Pumpkin Bombs");
  // 2 from the attack, 2 indirect.
  expect(p.snap.heroHp).toBe(6);
});

test("02021 Pumpkin Bombs: the indirect damage is split on the table's split screen, an ally offered too", () => {
  const p = deal(noThrall, attachedToVillain("02021"), handOf("01059", "01088", "01089"), stack(QUIET, FILLER));
  p.form();
  p.play("Jessica Jones", { pay: ["Energy", "Genius"] });
  const jessica = p.card("Jessica Jones", "inPlay");
  let seen: Choice | undefined;
  p.mark();
  p.end();
  p.drive({
    defend: (choice) => choice.options.find((o) => !o.cardId)!.id,
    pick: (choice) => {
      if (!choice.indirect) return undefined;
      seen = choice;
      // Both points of damage on Jessica Jones.
      return choice.options
        .filter((o) => o.cardId === jessica.id)
        .slice(0, 2)
        .map((o) => o.id);
    },
  });
  expect(seen?.indirect).toEqual({ amount: 2 });
  expect(seen!.options.some((o) => o.cardId === p.snap.hero.id)).toBe(true);
  expect(seen!.options.some((o) => o.cardId === jessica.id)).toBe(true);
  expect(p.snap.heroHp).toBe(8);
  expect(marker(p.card("Jessica Jones", "inPlay"), "damage")).toBe(2);
});

test("02021 Pumpkin Bombs: an attack Spider-Man defends still attacks him, so the bombs go off", () => {
  // "After the villain attacks you": the attack is against him whether or not he defends; DEF 3 stops the 2 damage.
  const p = deal(noThrall, attachedToVillain("02021"), stack(QUIET, FILLER));
  p.form();
  villainPhaseDefended(p);
  expect(enemy(p, "Pumpkin Bombs")).toBeUndefined();
  expect(p.snap.heroHp).toBe(8);
});

test("02021 Pumpkin Bombs: an attack an ally defends still attacks you, so the bombs go off", () => {
  // RRG v1.8 "Attack (Enemy Activation)", p. 8: "After [enemy] attacks you" resolves against the attacked player
  // regardless of which character they control was attacked.
  const p = deal(noThrall, attachedToVillain("02021"), handOf("01059", "01088", "01089"), stack(QUIET, FILLER));
  p.form();
  p.play("Jessica Jones", { pay: ["Energy", "Genius"] });
  const jessica = p.card("Jessica Jones", "inPlay");
  p.mark();
  p.end();
  p.drive({
    defend: (choice) => choice.options.find((o) => o.cardId === jessica.id)!.id,
    pick: (choice) =>
      choice.indirect
        ? choice.options
            .filter((o) => o.cardId === p.snap.hero.id)
            .slice(0, 2)
            .map((o) => o.id)
        : undefined,
  });
  at(p, "Jessica Jones takes the attack", (b) => b.hit?.target === jessica.id && b.hit.amount === 2);
  expect(enemy(p, "Pumpkin Bombs")).toBeUndefined();
  expect(p.snap.heroHp).toBe(8);
});

test("02021 Pumpkin Bombs: when Green Goblin schemes instead, the bombs stay", () => {
  const p = deal(noThrall, attachedToVillain("02021"), stack(QUIET, FILLER));
  villainPhase(p);
  expect(enemy(p, "Pumpkin Bombs")?.attachedTo).toBe(p.snap.villain.id);
  expect(p.snap.heroHp).toBe(10);
});

test("02021 Pumpkin Bombs: Hero Action, spend 2 physical to discard it, offered on the card", () => {
  const p = deal(noThrall, attachedToVillain("02021"), handOf("01090", "01088"));
  p.form();
  p.mark();
  const { payment } = enemyAction(p, "Pumpkin Bombs", ["Strength"]);
  expect(payment.required).toBe(2);
  expect(enemy(p, "Pumpkin Bombs")).toBeUndefined();
  at(p, "the bombs leave play", (b) => !!b.leftPlay);
});

test("02034 Pumpkin Bombs: revealed, it attaches to the villain and goes off after his next attack", () => {
  const p = deal(noThrall, stack(QUIET, "02034", QUIET2, FILLER));
  p.form();
  villainPhase(p);
  expect(enemy(p, "Pumpkin Bombs")?.attachedTo).toBe(p.snap.villain.id);
  expect(p.snap.heroHp).toBe(8);
  villainPhase(p);
  expect(enemy(p, "Pumpkin Bombs")).toBeUndefined();
  expect(discardNames(p)).toContain("Pumpkin Bombs");
});

test("02034 Pumpkin Bombs: Hero Action, spend 2 physical to discard it", () => {
  const p = deal(noThrall, attachedToVillain("02034"), handOf("01090"));
  p.form();
  enemyAction(p, "Pumpkin Bombs", ["Strength"]);
  expect(enemy(p, "Pumpkin Bombs")).toBeUndefined();
});

// =====================================================================================================================
// 02022 Goblin Knight
// =====================================================================================================================

test("02022 Goblin Knight: after it attacks you, the top encounter card is discarded and a Goblin minion engages", () => {
  const p = deal(noThrall, engageMinion("02022"), stack(QUIET, "02023", FILLER));
  p.form();
  villainPhase(p);
  const knight = enemy(p, "Goblin Knight")!;
  const hit = at(p, "Goblin Knight hits for 2", (b) => hitOn(p, 2)(b) && b.hit!.source === knight.id);
  const milled = at(p, "1 card discarded", (b) => b.encounterMilled?.length === 1, hit);
  const soldier = enemy(p, "Goblin Soldier")!;
  expect(soldier).toBeDefined();
  at(p, "the Goblin Soldier enters play", (b) => b.entersPlay === soldier.id, milled);
  expect(discardNames(p)).not.toContain("Goblin Soldier");
});

test("02022 Goblin Knight: a discarded card that isn't a Goblin minion stays in the discard pile", () => {
  const p = deal(noThrall, engageMinion("02022"), stack(QUIET, "02029", FILLER));
  p.form();
  villainPhase(p);
  at(p, "1 card discarded", (b) => b.encounterMilled?.length === 1);
  expect(discardNames(p)).toContain("Death from Above");
  expect(p.beats.some(revealOf("Death from Above"))).toBe(false);
});

test("02022 Goblin Knight: an attack Spider-Man defends still attacks him, so the Forced Response happens", () => {
  const p = deal(noThrall, engageMinion("02022"), stack(QUIET, "02023", FILLER));
  p.form();
  villainPhaseDefended(p);
  expect(enemy(p, "Goblin Soldier")).toBeDefined();
});

test("02022 Goblin Knight: in alter-ego form it schemes (SCH 2) and nothing is discarded", () => {
  const p = deal(noThrall, engageMinion("02022"), stack(QUIET, FILLER));
  villainPhase(p);
  const knight = enemy(p, "Goblin Knight")!;
  at(p, "Goblin Knight schemes for 2", (b) => threatOn(p, 2)(b) && b.actor === knight.id);
  expect(p.beats.some((b) => (b.encounterMilled?.length ?? 0) > 0)).toBe(false);
  expect(p.snap.heroHp).toBe(10);
});

test("02022 Goblin Knight: as a boost card it adds 2 icons, then is shuffled back into the encounter deck", () => {
  const p = deal(noThrall, stack("02022", FILLER));
  p.form();
  villainPhase(p);
  at(p, "Goblin Knight turned up as a boost card", boostIcons("Goblin Knight", 2));
  at(p, "Green Goblin hits for 4", hitOn(p, 4));
  expect(discardNames(p)).not.toContain("Goblin Knight");
  expect(enemy(p, "Goblin Knight")).toBeUndefined();
  expect(inEncounterDeck(p, "02022")).toBe(1);
});

// BUG: Goblin Knight's Boost ("After this activation ends, shuffle this card into the encounter deck") happens in the
// engine, but no beat shows the card going back into the encounter deck: the table retires the turned-up boost card
// with nowhere to fly to (`retireEncounter` with no discard copy), so it just disappears from beside the villain.
test("02022 Goblin Knight: the table shows the boost card going back into the encounter deck", () => {
  const p = deal(noThrall, stack("02022", FILLER));
  p.form();
  villainPhase(p);
  const flip = at(p, "Goblin Knight turned up as a boost card", boostIcons("Goblin Knight", 2));
  at(p, "the Knight shuffled into the encounter deck", backIntoDeck("Goblin Knight"), flip + 1);
});

// =====================================================================================================================
// 02023 Goblin Soldier
// =====================================================================================================================

test("02023 Goblin Soldier: When Defeated, it deals 1 damage to the engaged player", () => {
  const p = deal(noThrall, engageMinion("02023"), patchCard("02023", { damage: 3 }));
  p.form();
  const soldier = enemy(p, "Goblin Soldier")!;
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  if (p.snap.choice) p.choose({ card: soldier.id });
  expect(enemy(p, "Goblin Soldier")).toBeUndefined();
  const defeat = at(p, "the Soldier defeated", (b) => b.defeatedCard === soldier.id);
  at(p, "1 damage to Spider-Man", (b) => hitOn(p, 1)(b) && b.hit!.source === soldier.id, defeat);
  expect(p.snap.heroHp).toBe(9);
  expect(discardNames(p)).toContain("Goblin Soldier");
});

test("02023 Goblin Soldier: as a boost card it is put into play engaged with you (no icons)", () => {
  const p = deal(noThrall, stack("02023", FILLER));
  p.form();
  villainPhase(p);
  at(p, "Goblin Soldier turned up as a boost card", boostIcons("Goblin Soldier", 0));
  at(p, "Green Goblin hits for 2", hitOn(p, 2));
  const soldier = enemy(p, "Goblin Soldier");
  expect(soldier).toBeDefined();
  expect(engagedWithHero(p, soldier!.id)).toBe(true);
  expect(discardNames(p)).not.toContain("Goblin Soldier");
  // It is in play in time to activate in step 3 (RRG v1.8 villain phase: minions activate after the villain).
  at(p, "the Soldier attacks", (b) => b.hit?.source === soldier!.id);
});

// BUG: Goblin Soldier's Boost ("Put Goblin Soldier into play engaged with you") happens in the engine, but no beat
// shows it entering play: the turned-up boost card is retired with nowhere to fly to and the Soldier appears among the
// enemies only when the table next redraws (no `entersPlay` beat, as a minion put into play from the deck gets).
test("02023 Goblin Soldier: the table shows the boost card entering play", () => {
  const p = deal(noThrall, stack("02023", FILLER));
  p.form();
  villainPhase(p);
  const soldier = enemy(p, "Goblin Soldier")!;
  at(p, "the Soldier enters play", (b) => b.entersPlay === soldier.id);
});

// =====================================================================================================================
// 02024 Goblin Thrall
// =====================================================================================================================

test("02024 Goblin Thrall: guard, so Spider-Man's attack can't reach Green Goblin, and the table says why", () => {
  const p = deal();
  p.form();
  const thrall = enemy(p, "Goblin Thrall")!;
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  const choice = p.snap.choice!;
  expect(choice.guard).toEqual({ blocked: [p.snap.villain.id], guards: [thrall.id] });
  expect(choice.options.map((o) => o.cardId)).not.toContain(p.snap.villain.id);
  p.choose({ card: thrall.id });
  expect(marker(enemy(p, "Goblin Thrall"), "damage")).toBe(2);
  expect(p.snap.villainHp).toBe(16);
});

test("02024 Goblin Thrall: revealed, it engages the player", () => {
  const p = deal(noThrall, stack(QUIET, "02024"));
  villainPhase(p);
  const reveal = at(p, "Goblin Thrall revealed", revealOf("Goblin Thrall"));
  expect(p.beats[reveal]!.reveal!.quick).toBe(true);
  expect(enemy(p, "Goblin Thrall")?.guard).toBe(true);
});

test("02024 Goblin Thrall: as a boost card it is put into play engaged with you (no icons)", () => {
  const p = deal(noThrall, stack("02024", "02023"));
  p.form();
  villainPhase(p);
  at(p, "Goblin Thrall turned up as a boost card", boostIcons("Goblin Thrall", 0));
  at(p, "Green Goblin hits for 2", hitOn(p, 2));
  const thrall = enemy(p, "Goblin Thrall");
  expect(thrall).toBeDefined();
  expect(engagedWithHero(p, thrall!.id)).toBe(true);
  expect(thrall!.guard).toBe(true);
});

// BUG: as Goblin Soldier's: the Boost "Put Goblin Thrall into play engaged with you" has no beat; the card vanishes
// from beside the villain and turns up among the enemies at the next redraw.
test("02024 Goblin Thrall: the table shows the boost card entering play", () => {
  const p = deal(noThrall, stack("02024", "02023"));
  p.form();
  villainPhase(p);
  const thrall = enemy(p, "Goblin Thrall")!;
  at(p, "the Thrall enters play", (b) => b.entersPlay === thrall.id);
});

// =====================================================================================================================
// 02025 Monster
// =====================================================================================================================

test("02025 Monster: revealed, you are stunned and it engages you", () => {
  const p = deal(noThrall, stack(QUIET, "02025"));
  p.form();
  villainPhase(p);
  const reveal = at(p, "Monster revealed", revealOf("Monster"));
  at(
    p,
    "Spider-Man stunned",
    (b) => b.statusChange?.id === p.snap.hero.id && b.statusChange.name === "stunned",
    reveal,
  );
  expect(marker(p.snap.hero, "stunned")).toBe(1);
  expect(enemy(p, "Monster")).toBeDefined();
  expect(p.snap.heroHp).toBe(8);
});

test("02025 Monster: revealed while you are already stunned, you take 2 damage instead", () => {
  const p = deal(
    noThrall,
    patchByCode("hero", { statuses: { stunned: 1, confused: 0, tough: 0 } }),
    stack(QUIET, "02025"),
  );
  villainPhase(p);
  const reveal = at(p, "Monster revealed", revealOf("Monster"));
  at(p, "2 damage to Peter Parker", hitOn(p, 2), reveal);
  expect(p.snap.heroHp).toBe(8);
  expect(marker(p.snap.hero, "stunned")).toBe(1);
  expect(p.beats.some((b) => b.statusChange?.name === "stunned" && b.statusChange.delta > 0)).toBe(false);
});

test("02025 Monster: as a boost card it adds 2 icons, then is shuffled back into the encounter deck", () => {
  const p = deal(noThrall, stack("02025", FILLER));
  p.form();
  villainPhase(p);
  at(p, "Monster turned up as a boost card", boostIcons("Monster", 2));
  at(p, "Green Goblin hits for 4", hitOn(p, 4));
  expect(discardNames(p)).not.toContain("Monster");
  expect(enemy(p, "Monster")).toBeUndefined();
  expect(inEncounterDeck(p, "02025")).toBe(1);
});

// BUG: as Goblin Knight's: Monster's Boost shuffles it back into the encounter deck with no beat; it just disappears.
test("02025 Monster: the table shows the boost card going back into the encounter deck", () => {
  const p = deal(noThrall, stack("02025", FILLER));
  p.form();
  villainPhase(p);
  const flip = at(p, "Monster turned up as a boost card", boostIcons("Monster", 2));
  at(p, "Monster shuffled into the encounter deck", backIntoDeck("Monster"), flip + 1);
});

// =====================================================================================================================
// 02026 Goblin Reinforcements
// =====================================================================================================================

test("02026 Goblin Reinforcements: revealed, 2 threat plus 1 more for each Goblin minion in play", () => {
  const p = deal(engageMinion("02022"), stack(QUIET, "02026"));
  villainPhase(p);
  at(p, "Goblin Reinforcements revealed", revealOf("Goblin Reinforcements"));
  // The setup's Goblin Thrall and the Goblin Knight: 2 + 2.
  expect(enemy(p, "Goblin Reinforcements")?.threat).toBe(4);
  const scheme = enemy(p, "Goblin Reinforcements")!;
  expect(p.beats.filter((b) => b.threat?.scheme === scheme.id).at(-1)?.threat?.to).toBe(4);
});

test("02026 Goblin Reinforcements: with no Goblin minion in play it keeps its starting 2 threat", () => {
  const p = deal(noThrall, stack(QUIET, "02026"));
  villainPhase(p);
  expect(enemy(p, "Goblin Reinforcements")?.threat).toBe(2);
});

test("02026 Goblin Reinforcements: its hazard icon deals one more encounter card each villain phase", () => {
  const p = deal(noThrall, sideScheme("02026", 2), stack(QUIET, FILLER, FILLER));
  villainPhase(p);
  expect(p.beats.filter((b) => !!b.encounterDeal && !b.boostFor)).toHaveLength(2);
  expect(enemies(p, "Goblin Thrall")).toHaveLength(2);
});

// =====================================================================================================================
// 02027 Goblin Nation
// =====================================================================================================================

test("02027 Goblin Nation: revealed with 2 threat, every Goblin enemy gets +1 ATK and the table shows it", () => {
  const p = deal(stack(QUIET, "02027"));
  const thrall = enemy(p, "Goblin Thrall")!;
  villainPhase(p);
  const reveal = at(p, "Goblin Nation revealed", revealOf("Goblin Nation"));
  expect(enemy(p, "Goblin Nation")?.threat).toBe(2);
  at(p, "+1 ATK on Green Goblin", (b) => b.modifier?.id === p.snap.villain.id && b.modifier.count === 1, reveal);
  at(p, "+1 ATK on the Thrall", (b) => b.modifier?.id === thrall.id && b.modifier.count === 1, reveal);
});

test("02027 Goblin Nation: Green Goblin and his Goblin minions attack with +1 ATK", () => {
  const p = deal(sideScheme("02027", 2), stack(QUIET, FILLER));
  const thrall = enemy(p, "Goblin Thrall")!;
  p.form();
  villainPhase(p);
  at(p, "Green Goblin hits for 3", (b) => hitOn(p, 3)(b) && b.hit!.source === p.snap.villain.id);
  at(p, "the Thrall hits for 2", (b) => hitOn(p, 2)(b) && b.hit!.source === thrall.id);
});

test("02027 Goblin Nation: as a boost card it is put into play, and its +1 ATK counts for that attack", () => {
  // RRG v1.8 "Attack (Enemy Activation)": the boost card is turned faceup and its Boost ability resolves before the
  // damage is dealt, so Goblin Nation is already in play when Green Goblin's ATK is read: 2 + 1, no boost icons.
  const p = deal(noThrall, stack("02027", FILLER));
  p.form();
  villainPhase(p);
  const flip = at(p, "Goblin Nation turned up as a boost card", boostIcons("Goblin Nation", 0));
  const nation = enemy(p, "Goblin Nation");
  expect(nation?.threat).toBe(2);
  at(p, "Goblin Nation's starting threat", (b) => b.threat?.scheme === nation!.id && b.threat.to === 2, flip);
  at(p, "Green Goblin hits for 3", hitOn(p, 3), flip);
});

// =====================================================================================================================
// 02028 Overrun
// =====================================================================================================================

test("02028 Overrun: revealed with 1 threat (1 per player)", () => {
  const p = deal(noThrall, stack(QUIET, "02028"));
  villainPhase(p);
  at(p, "Overrun revealed", revealOf("Overrun"));
  expect(enemy(p, "Overrun")?.threat).toBe(1);
});

test("02028 Overrun: its two acceleration icons add 2 threat to the main scheme each villain phase", () => {
  const p = deal(noThrall, sideScheme("02028", 1), stack(QUIET, FILLER));
  villainPhase(p);
  // Step 1: 1 (1 per player) + 2 acceleration icons; then Green Goblin's scheme, SCH 1.
  const step1 = p.beats.filter((b) => threatOn(p)(b) && b.activity === "Place threat");
  expect(
    step1.reduce((n, b) => n + b.threat!.delta, 0),
    said(p),
  ).toBe(3);
  expect(mainThreat(p)).toBe(6);
});

test("02028 Overrun: When Defeated, 2 encounter cards are discarded and each Goblin minion among them engages", () => {
  const p = deal(noThrall, sideScheme("02028", 1), stack("02023", "02024"));
  p.form();
  const overrun = enemy(p, "Overrun")!;
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicThwart"))).toBe(true);
  if (p.snap.choice) p.choose({ card: overrun.id });
  expect(enemy(p, "Overrun")).toBeUndefined();
  const milled = at(p, "2 cards discarded", (b) => b.encounterMilled?.length === 2);
  const soldier = enemy(p, "Goblin Soldier")!;
  const thrall = enemy(p, "Goblin Thrall")!;
  expect(soldier && thrall).toBeTruthy();
  at(p, "the Soldier enters play", (b) => b.entersPlay === soldier.id, milled);
  at(p, "the Thrall enters play", (b) => b.entersPlay === thrall.id, milled);
  expect(discardNames(p)).toContain("Overrun");
});

test("02028 Overrun: a discarded card that isn't a Goblin minion stays in the discard pile", () => {
  const p = deal(noThrall, sideScheme("02028", 1), stack("02029", "02023"));
  p.form();
  const overrun = enemy(p, "Overrun")!;
  expect(p.run(() => p.battle.heroAction("basicThwart"))).toBe(true);
  if (p.snap.choice) p.choose({ card: overrun.id });
  expect(enemy(p, "Goblin Soldier")).toBeDefined();
  expect(discardNames(p)).toContain("Death from Above");
});

// =====================================================================================================================
// 02029 Death from Above
// =====================================================================================================================

test("02029 Death from Above (alter-ego, stage I): Green Goblin schemes with +1 SCH", () => {
  const p = deal(noThrall, stack(QUIET, "02029", QUIET2));
  villainPhase(p);
  const reveal = at(p, "Death from Above revealed", revealOf("Death from Above"));
  expect(p.beats[reveal]!.reveal!.applies).toMatchObject({ form: "Alter-Ego" });
  // SCH 1 + X (stage 1), the boost card Advance adds nothing.
  at(p, "his scheme places 2", (b) => threatOn(p, 2)(b) && b.actor === p.snap.villain.id, reveal);
  expect(mainThreat(p)).toBe(6);
});

test("02029 Death from Above (hero, stage I): Green Goblin attacks with +1 ATK", () => {
  const p = deal(noThrall, stack(QUIET, "02029", QUIET2));
  p.form();
  villainPhase(p);
  const reveal = at(p, "Death from Above revealed", revealOf("Death from Above"));
  expect(p.beats[reveal]!.reveal!.applies).toMatchObject({ form: "Hero" });
  at(p, "his attack hits for 3", hitOn(p, 3), reveal);
  expect(p.snap.heroHp).toBe(5);
});

test("02029 Death from Above (alter-ego, stage II): X is the stage number, so +2 SCH", () => {
  const p = expertDeal(noDealt, noThrall, stack(QUIET, "02029", QUIET2));
  villainPhase(p);
  const reveal = at(p, "Death from Above revealed", revealOf("Death from Above"));
  // Green Goblin II: SCH 2, + 2.
  at(p, "his scheme places 4", (b) => threatOn(p, 4)(b) && b.actor === p.snap.villain.id, reveal);
});

test("02029 Death from Above (hero, stage II): X is the stage number, so +2 ATK", () => {
  const p = expertDeal(noDealt, noThrall, stack(QUIET, "02029", QUIET2));
  p.form();
  villainPhase(p);
  const reveal = at(p, "Death from Above revealed", revealOf("Death from Above"));
  // Green Goblin II: ATK 2, + 2.
  at(p, "his attack hits for 4", hitOn(p, 4), reveal);
});

// =====================================================================================================================
// 02030 I See You
// =====================================================================================================================

test("02030 I See You (hero): Green Goblin attacks you, with a boost card", () => {
  const p = deal(noThrall, stack(QUIET, "02030", QUIET2));
  p.form();
  villainPhase(p);
  const reveal = at(p, "I See You revealed", revealOf("I See You"));
  at(p, "a boost card dealt for the attack", (b) => b.boostFor === p.snap.villain.id, reveal);
  at(p, "the attack hits for 2", hitOn(p, 2), reveal);
  expect(p.snap.heroHp).toBe(6);
});

test("02030 I See You (alter-ego): Green Goblin attacks Peter Parker anyway, with no boost card", () => {
  // RRG v1.8 FAQ, I See You (#30): the When Revealed names no form, so Green Goblin attacks in alter-ego form too.
  const p = deal(noThrall, stack(QUIET, "02030", QUIET2));
  villainPhase(p);
  const reveal = at(p, "I See You revealed", revealOf("I See You"));
  expect(p.beats[reveal]!.reveal!.noHeroToAttack).toBeUndefined();
  expect(p.beats.some((b, i) => i > reveal && b.boostFor === p.snap.villain.id)).toBe(false);
  at(p, "the attack hits Peter Parker for 2", hitOn(p, 2), reveal);
  expect(p.snap.heroHp).toBe(8);
});

test("02030 I See You (alter-ego) with Hysteria attached: still no boost card for that attack", () => {
  // FFG ruling (Hall of Heroes, RRG 1.0-1.4 era, Green Goblin): "If the green goblin villain has 'hysteria' attached
  // and you reveal 'I see you' ... In that situation, Green Goblin should not be given any boost cards."
  const p = deal(noThrall, attachedToVillain("02020"), stack(QUIET, QUIET2, "02030", FILLER));
  villainPhase(p);
  const reveal = at(p, "I See You revealed", revealOf("I See You"));
  expect(p.beats.some((b, i) => i > reveal && b.boostFor === p.snap.villain.id)).toBe(false);
  at(p, "the attack hits Peter Parker for 2", hitOn(p, 2), reveal);
});

test("02030 I See You: as a boost card it has 1 boost icon", () => {
  const p = deal(noThrall, stack("02030", FILLER));
  p.form();
  villainPhase(p);
  at(p, "I See You turned up with 1 icon", boostIcons("I See You", 1));
  at(p, "Green Goblin hits for 3", hitOn(p, 3));
});

test("02030 I See You: as a boost card it gets +1 boost icon while a Goblin minion is engaged with you", () => {
  const p = deal(stack("02030", FILLER));
  p.form();
  villainPhase(p);
  at(p, "I See You turned up with 2 icons", boostIcons("I See You", 2));
  at(p, "Green Goblin hits for 4", (b) => hitOn(p, 4)(b) && b.hit!.source === p.snap.villain.id);
});

// =====================================================================================================================
// 02031 Overconfidence
// =====================================================================================================================

test("02031 Overconfidence (alter-ego): Green Goblin schemes; 3 threat placed, so it gains surge", () => {
  // SCH 1 + Pumpkin Bombs' 2 boost icons = 3. The main scheme starts empty so the 3 doesn't complete it.
  const p = deal(noThrall, mainAt(0), stack(QUIET, "02031", "02021", FILLER));
  villainPhase(p);
  const reveal = at(p, "Overconfidence revealed", revealOf("Overconfidence"));
  expect(p.beats[reveal]!.reveal!.applies).toMatchObject({ form: "Alter-Ego" });
  const scheme = at(p, "3 threat", (b) => threatOn(p, 3)(b) && b.actor === p.snap.villain.id, reveal);
  const surge = at(p, "surge", (b) => !!b.surge, scheme);
  at(p, "the surge card revealed", revealOf("Goblin Thrall"), surge);
});

test("02031 Overconfidence (alter-ego): only 2 threat placed, no surge", () => {
  // SCH 1 + Hysteria's 1 boost icon = 2.
  const p = deal(noThrall, stack(QUIET, "02031", "02020", FILLER));
  villainPhase(p);
  const reveal = at(p, "Overconfidence revealed", revealOf("Overconfidence"));
  at(p, "2 threat", (b) => threatOn(p, 2)(b) && b.actor === p.snap.villain.id, reveal);
  expect(p.beats.some((b) => !!b.surge)).toBe(false);
  expect(enemy(p, "Goblin Thrall")).toBeUndefined();
});

test("02031 Overconfidence (hero): Green Goblin attacks you; 3 damage, so it gains surge", () => {
  // ATK 2 + Hysteria's 1 boost icon = 3.
  const p = deal(noThrall, stack(QUIET, "02031", "02020", FILLER));
  p.form();
  villainPhase(p);
  const reveal = at(p, "Overconfidence revealed", revealOf("Overconfidence"));
  expect(p.beats[reveal]!.reveal!.applies).toMatchObject({ form: "Hero" });
  const hit = at(p, "3 damage", hitOn(p, 3), reveal);
  const surge = at(p, "surge", (b) => !!b.surge, hit);
  at(p, "the surge card revealed", revealOf("Goblin Thrall"), surge);
});

test("02031 Overconfidence (hero): only 2 damage, no surge", () => {
  const p = deal(noThrall, stack(QUIET, "02031", QUIET2, FILLER));
  p.form();
  villainPhase(p);
  const reveal = at(p, "Overconfidence revealed", revealOf("Overconfidence"));
  at(p, "2 damage", hitOn(p, 2), reveal);
  expect(p.beats.some((b) => !!b.surge)).toBe(false);
});

test("02031 Overconfidence (hero): an attack Spider-Man defends places too little damage to surge", () => {
  // ATK 2 + Pumpkin Bombs' 2 icons = 4, DEF 3 lets 1 through. He takes the villain's own attack (2) undefended, so he
  // is still ready to defend the one Overconfidence makes.
  const p = deal(noThrall, stack(QUIET, "02031", "02021", FILLER));
  p.form();
  let defenses = 0;
  p.mark();
  p.end();
  p.drive({
    defend: (choice) => choice.options.find((o) => o.label === (defenses++ === 0 ? "Don’t defend" : "Defend"))!.id,
  });
  const reveal = at(p, "Overconfidence revealed", revealOf("Overconfidence"));
  at(p, "1 damage through", hitOn(p, 1), reveal);
  expect(p.snap.heroHp).toBe(7);
  expect(p.beats.some((b) => !!b.surge)).toBe(false);
});

// =====================================================================================================================
// 02032 Wicked Ambitions
// =====================================================================================================================

const TAKE_3 = "Take 3 damage";
const ENGAGE = "Put that minion into play engaged with you";

test("02032 Wicked Ambitions: 2 cards discarded at stage I; a Goblin minion among them asks, and taking 3 damage leaves it discarded", () => {
  const p = deal(noThrall, stack(QUIET, "02032", "02023", "02029"));
  const asked = villainPhase(p, (labels) => labels.indexOf(TAKE_3));
  const reveal = at(p, "Wicked Ambitions revealed", revealOf("Wicked Ambitions"));
  at(p, "2 cards discarded", (b) => (b.encounterMilled?.length ?? 0) > 0, reveal);
  expect(p.beats.flatMap((b) => b.encounterMilled ?? [])).toHaveLength(2);
  const q = asked.find((a) => a.labels.includes(TAKE_3));
  expect(q, JSON.stringify(asked)).toBeDefined();
  expect(q!.labels).toEqual([TAKE_3, ENGAGE]);
  expect(q!.source).toMatch(/Wicked Ambitions/);
  at(p, "3 damage to Peter Parker", hitOn(p, 3), reveal);
  expect(p.snap.heroHp).toBe(7);
  expect(discardNames(p)).toEqual(expect.arrayContaining(["Goblin Soldier", "Death from Above"]));
  expect(enemy(p, "Goblin Soldier")).toBeUndefined();
});

test("02032 Wicked Ambitions: choosing to put the Goblin minion into play engages it", () => {
  const p = deal(noThrall, stack(QUIET, "02032", "02023", "02029"));
  villainPhase(p, (labels) => labels.indexOf(ENGAGE));
  const soldier = enemy(p, "Goblin Soldier");
  expect(soldier).toBeDefined();
  at(p, "the Soldier enters play", (b) => b.entersPlay === soldier!.id);
  expect(p.snap.heroHp).toBe(10);
});

test("02032 Wicked Ambitions: at stage II it discards 4, and asks once per Goblin minion", () => {
  const p = expertDeal(noDealt, noThrall, stack(QUIET, "02032", "02023", "02029", "02024", "02036"));
  const asked = villainPhase(p, (labels) => labels.indexOf(TAKE_3));
  expect(p.beats.flatMap((b) => b.encounterMilled ?? [])).toHaveLength(4);
  expect(asked.filter((a) => a.labels.includes(TAKE_3))).toHaveLength(2);
  expect(p.snap.heroHp).toBe(4);
});

// BUG: the question asked for each Goblin minion discarded is "Choose one: Take 3 damage / Put that minion into play
// engaged with you", and nothing in it says which minion: its options carry no card and it points at no card but the
// hero (`affects`). At stage II, with a Goblin Soldier and a Goblin Thrall discarded, the player is asked the same
// question twice and can't tell which minion each one is about (Wicked Ambitions: "Each time a Goblin minion is
// discarded this way, choose to either take 3 damage or put that minion into play engaged with you").
test("02032 Wicked Ambitions: each question shows which Goblin minion it is about", () => {
  const p = expertDeal(noDealt, noThrall, stack(QUIET, "02032", "02023", "02029", "02024", "02036"));
  const questions: Choice[] = [];
  p.mark();
  p.end();
  p.drive({
    defend: () => "decline",
    pick: (choice) => {
      if (!choice.options.some((o) => o.label === TAKE_3)) return undefined;
      questions.push(choice);
      return [choice.options[0]!.id];
    },
  });
  expect(questions).toHaveLength(2);
  const milled = p.beats.flatMap((b) => b.encounterMilled ?? []);
  const minions = p.snap.encounterDiscard.filter(
    (c) => milled.includes(c.id) && (c.name === "Goblin Soldier" || c.name === "Goblin Thrall"),
  );
  expect(minions).toHaveLength(2);
  questions.forEach((q, n) => {
    const minion = minions[n]!;
    const named =
      q.affects?.includes(minion.id) || q.options.some((o) => o.cardId === minion.id) || q.prompt.includes(minion.name);
    expect(named, JSON.stringify(q)).toBe(true);
  });
});

// =====================================================================================================================
// 02035 Intimidation
// =====================================================================================================================

const SPEND_2 = "Spend 2 resources";
const GIVE_BOOST = "Give the villain 1 facedown boost card";

test("02035 Intimidation: the table asks which, in the card's words", () => {
  const p = deal(noThrall, handOf("01088"), stack(QUIET, "02035", FILLER));
  const asked = villainPhase(p, (labels) => labels.indexOf(GIVE_BOOST));
  const q = asked.find((a) => a.source === "Intimidation · When Revealed");
  expect(q, JSON.stringify(asked)).toBeDefined();
  expect(q!.labels).toEqual([SPEND_2, GIVE_BOOST]);
});

test("02035 Intimidation: choosing the boost card gives Green Goblin a facedown boost card, used at his next activation", () => {
  const p = deal(noThrall, handOf("01088"), stack(QUIET, "02035", QUIET2, "01187", FILLER));
  villainPhase(p, (labels) => labels.indexOf(GIVE_BOOST));
  const reveal = at(p, "Intimidation revealed", revealOf("Intimidation"));
  at(p, "a facedown boost card for Green Goblin", (b) => b.boostFor === p.snap.villain.id, reveal);
  expect(p.snap.facedownBoosts).toEqual([{ id: expect.any(String), enemy: p.snap.villain.id }]);
  expect(p.snap.hand.map((c) => c.name)).toContain("Energy");
  // Next villain phase he schemes with 2 boost cards: the one he holds and the one dealt then.
  villainPhase(p);
  expect(p.beats.filter((b) => !!b.reveal?.boost && b.reveal.boost.enemy === p.snap.villain.id)).toHaveLength(2);
  expect(p.snap.facedownBoosts).toEqual([]);
});

test("02035 Intimidation: spending 2 resources instead gives no boost card", () => {
  const p = deal(noThrall, handOf("01088"), stack(QUIET, "02035", FILLER));
  const asked = villainPhase(p, (labels) =>
    labels.includes(SPEND_2) ? labels.indexOf(SPEND_2) : labels.indexOf("Energy"),
  );
  const spend = asked.find((a) => a.prompt === SPEND_2);
  expect(spend?.source, JSON.stringify(asked)).toBe("Intimidation · When Revealed");
  expect(spend!.labels).toContain("Energy");
  expect(p.snap.facedownBoosts).toEqual([]);
  expect(
    p.beats.some((b, i) => i > at(p, "reveal", revealOf("Intimidation")) && b.boostFor === p.snap.villain.id),
  ).toBe(false);
  expect(p.snap.discard.map((c) => c.name)).toContain("Energy");
});

test("02035 Intimidation: with nothing to spend, Green Goblin gets the facedown boost card", () => {
  // The engine lets "Spend 2 resources" be picked with an empty hand and falls through to the boost card when nothing
  // is spent. RRG v1.8 "Choose (Option)" bars an option only for a player card's cost or an encounter card's missing
  // targets, so offering it is not wrong; the outcome is what the card says.
  const p = deal(noThrall, handOf(), stack(QUIET, "02035", FILLER));
  const asked = villainPhase(p);
  const q = asked.find((a) => a.source === "Intimidation · When Revealed");
  expect(q?.labels, JSON.stringify(asked)).toEqual([SPEND_2, GIVE_BOOST]);
  expect(p.snap.facedownBoosts).toEqual([{ id: expect.any(String), enemy: p.snap.villain.id }]);
});

test("02035 Intimidation: as a boost card it gives Green Goblin 1 additional boost card for that activation", () => {
  const p = deal(noThrall, stack("02035", QUIET, FILLER));
  p.form();
  villainPhase(p);
  at(p, "Intimidation turned up with 1 icon", boostIcons("Intimidation", 1));
  expect(p.beats.filter((b) => b.boostFor === p.snap.villain.id)).toHaveLength(2);
  at(p, "All Tied Up turned up", boostOf("All Tied Up"));
  // ATK 2 + Intimidation's 1 icon + All Tied Up's 0.
  at(p, "Green Goblin hits for 3", hitOn(p, 3));
});

// =====================================================================================================================
// 02036 Regenerative Healing
// =====================================================================================================================

test("02036 Regenerative Healing (stage I): Green Goblin heals 2", () => {
  const p = deal(noThrall, patchByCode("villain", { damage: 5 }), stack(QUIET, "02036"));
  villainPhase(p);
  const reveal = at(p, "Regenerative Healing revealed", revealOf("Regenerative Healing"));
  at(
    p,
    "Green Goblin heals 2",
    (b) => b.statusChange?.id === p.snap.villain.id && b.statusChange.name === "damage" && b.statusChange.delta === -2,
    reveal,
  );
  expect(p.snap.villainHp).toBe(13);
  expect(p.beats.some((b) => !!b.surge)).toBe(false);
});

test("02036 Regenerative Healing: 1 damage healed is still healing, so no surge", () => {
  const p = deal(noThrall, patchByCode("villain", { damage: 1 }), stack(QUIET, "02036", FILLER));
  villainPhase(p);
  expect(p.snap.villainHp).toBe(16);
  expect(p.beats.some((b) => !!b.surge)).toBe(false);
});

test("02036 Regenerative Healing: with no damage to heal it gains surge", () => {
  const p = deal(noThrall, stack(QUIET, "02036", FILLER));
  villainPhase(p);
  const reveal = at(p, "Regenerative Healing revealed", revealOf("Regenerative Healing"));
  const surge = at(p, "surge", (b) => !!b.surge, reveal);
  at(p, "the surge card revealed", revealOf("Goblin Thrall"), surge);
});

test("02036 Regenerative Healing (stage II): Green Goblin heals 4", () => {
  const p = expertDeal(noDealt, noThrall, patchByCode("villain", { damage: 6 }), stack(QUIET, "02036"));
  villainPhase(p);
  expect(p.snap.villainHp).toBe(16);
});

test("02036 Regenerative Healing: as a boost card Green Goblin heals 2 (no icons)", () => {
  const p = deal(noThrall, patchByCode("villain", { damage: 5 }), stack("02036", FILLER));
  p.form();
  villainPhase(p);
  at(p, "Regenerative Healing turned up", boostIcons("Regenerative Healing", 0));
  const flip = at(p, "Regenerative Healing turned up", boostIcons("Regenerative Healing", 0));
  at(p, "Green Goblin heals 2", (b) => b.statusChange?.id === p.snap.villain.id && b.statusChange.delta === -2, flip);
  at(p, "Green Goblin hits for 2", hitOn(p, 2));
  expect(p.snap.villainHp).toBe(13);
});
