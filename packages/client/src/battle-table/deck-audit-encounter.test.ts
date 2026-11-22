import { expect, test, vi } from "vitest";
import * as engine from "@mc/engine";
import { BattleModel, type BattleBeat, type BattleChoice } from "./model.js";

type State = engine.GameState;

/** Take one copy of `code` from wherever the opening deal left it (encounter deck, discard, set-aside, deck, hand). */
function take(state: State, code: string, used: Set<string>): engine.InstanceId {
  const piles = engine.activeEncounterDeck(state);
  const p = state.players[0]!;
  const pools = [piles.deck, piles.discard, p.setAside, state.encounterSetAside, p.deck, p.hand];
  for (const pool of pools) {
    const id = pool.find((i) => state.instances[i]?.cardId === code && !used.has(i));
    if (id) {
      used.add(id);
      return id;
    }
  }
  throw new Error(`setup: no spare copy of ${code}`);
}

interface Setup {
  /** Encounter cards, top first. Rhino's boost card is drawn before the encounter deal. */
  top?: string[];
  /** Replace the whole hand with exactly these cards. */
  hand?: string[];
  /** Player deck, top first (drawn at the start of the next round). */
  deckTop?: string[];
  /** Cards already in play: minions engaged with the hero, side schemes, supports (face up, no When Revealed). */
  inPlay?: string[];
  /** Attachments already on Rhino. */
  attached?: string[];
  /** Threat on a card that is already in play, by code ("main" is The Break-In!). */
  threatOf?: Record<string, number>;
  /** Cards tucked facedown under an in-play card, by host code. */
  tucked?: Record<string, string[]>;
  heroDamage?: number;
  villainDamage?: number;
  heroStatus?: Record<string, number>;
  villainStatus?: Record<string, number>;
  /** Drop Spider-Man's set-aside nemesis set (Shadow of the Past then has nothing to bring in). */
  noNemesis?: boolean;
}

/** How many cards the opening deal set aside as Spider-Man's nemesis set. */
let nemesisSetSize = 0;

const isScheme = (state: State, id: engine.InstanceId) => engine.cardOf(state, id)?.type === "side_scheme";

function arrange(state: State, s: Setup): State {
  nemesisSetSize = state.players[0]!.setAside.length;
  const used = new Set<string>();
  const ids = (s.top ?? []).map((c) => take(state, c, used));
  const handIds = s.hand ? s.hand.map((c) => take(state, c, used)) : null;
  const deckTopIds = (s.deckTop ?? []).map((c) => take(state, c, used));
  const inPlayIds = new Map<string, engine.InstanceId>();
  const inPlayList = (s.inPlay ?? []).map((c) => {
    const id = take(state, c, used);
    if (!inPlayIds.has(c)) inPlayIds.set(c, id);
    return [c, id] as const;
  });
  const attachedIds = (s.attached ?? []).map((c) => take(state, c, used));
  const tuckedIds = Object.entries(s.tucked ?? {}).map(
    ([host, codes]) => [host, codes.map((c) => take(state, c, used))] as const,
  );
  // Whatever the test leaves undealt must be inert, so an unlucky random card can't change the outcome.
  for (const filler of ["01108", "01101", "01101"]) {
    try {
      ids.push(take(state, filler, used));
    } catch {
      /* already used by the test itself */
    }
  }
  const gone = new Set<string>(used);
  if (s.noNemesis) for (const id of state.players[0]!.setAside) gone.add(id);
  const strip = (list: readonly engine.InstanceId[]) => list.filter((i) => !gone.has(i));
  const key = engine.activeEncounterDeckId(state);
  const piles = engine.activeEncounterDeck(state);
  const player = state.players[0]!;
  const instances = { ...state.instances };
  const hero = player.identity.instanceId;
  const v = state.villains[0]!.instanceId;
  for (const [code, id] of inPlayList)
    instances[id] = {
      ...instances[id]!,
      faceup: true,
      engagedWith: engine.cardOf(state, id)?.type === "minion" ? player.playerId : null,
      ...(s.threatOf?.[code] !== undefined ? { threat: s.threatOf[code] } : {}),
    };
  for (const [host, ids2] of tuckedIds)
    instances[inPlayIds.get(host)!] = { ...instances[inPlayIds.get(host)!]!, tucked: ids2 };
  instances[hero] = {
    ...instances[hero]!,
    damage: s.heroDamage ?? 0,
    statuses: { ...instances[hero]!.statuses, ...s.heroStatus },
  };
  instances[v] = {
    ...instances[v]!,
    damage: s.villainDamage ?? 0,
    statuses: { ...instances[v]!.statuses, ...s.villainStatus },
    attachments: [...instances[v]!.attachments, ...attachedIds],
  };
  for (const id of attachedIds) instances[id] = { ...instances[id]!, faceup: true, attachedTo: v };
  const scheme = state.mainScheme.instanceId;
  if (s.threatOf?.main !== undefined) instances[scheme] = { ...instances[scheme]!, threat: s.threatOf.main };
  return {
    ...state,
    instances,
    players: [
      {
        ...player,
        hand: handIds ?? strip(player.hand),
        deck: [...deckTopIds, ...strip(player.deck), ...(handIds ? strip(player.hand) : [])],
        playArea: [...strip(player.playArea), ...inPlayList.map(([, id]) => id).filter((id) => !isScheme(state, id))],
        setAside: strip(player.setAside),
      },
    ],
    villainArea: [...state.villainArea, ...inPlayList.map(([, id]) => id).filter((id) => isScheme(state, id))],
    encounterSetAside: strip(state.encounterSetAside),
    encounterDecks: {
      ...state.encounterDecks,
      [key]: { ...piles, deck: [...ids, ...strip(piles.deck)], discard: strip(piles.discard) },
    },
  };
}

function scenario(s: Setup = {}) {
  const create = engine.createGame;
  const mock = vi.spyOn(engine, "createGame").mockImplementationOnce((...args) => {
    const result = create(...args);
    return result.ok ? { ...result, state: arrange(result.state, s) } : result;
  });
  const battle = new BattleModel();
  try {
    battle.reset();
  } finally {
    mock.mockRestore();
  }
  return battle;
}

type Answer = (choice: BattleChoice) => string[] | undefined;
interface Run {
  beats: BattleBeat[];
  prompts: BattleChoice[];
}

/**
 * Answer whatever the table asks, the way main.ts does, collecting every beat the player would watch.
 * Defaults: trigger offers are declined, a defense is declined (the option with no card), anything else takes the
 * first `min` options (end-of-turn discards therefore discard nothing unless a minimum is required).
 */
function drive(battle: BattleModel, answer: Answer = () => undefined): Run {
  const run: Run = { beats: [...battle.snapshot().beats], prompts: [] };
  for (let i = 0; i < 40; i++) {
    const now = battle.snapshot();
    const choice = now.choice;
    if (!choice || now.outcome) break;
    run.prompts.push(choice);
    let picks = answer(choice);
    if (!picks) {
      if (choice.offers?.length) picks = [];
      else if (choice.defense) picks = choice.options.filter((o) => !o.cardId).map((o) => o.id);
      else picks = choice.options.slice(0, choice.min).map((o) => o.id);
    }
    if (!battle.chooseMany(picks))
      throw new Error(`table rejected answer ${JSON.stringify(picks)} to "${choice.prompt}"`);
    run.beats.push(...battle.snapshot().beats);
  }
  return run;
}

function endTurn(battle: BattleModel, answer?: Answer): Run {
  expect(battle.endTurn()).toBe(true);
  return drive(battle, answer);
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers for the player's own turn.
// ---------------------------------------------------------------------------------------------------------------
const snap = (b: BattleModel) => b.snapshot();
const heroId = (b: BattleModel) => snap(b).hero.id;
const rhinoId = (b: BattleModel) => snap(b).villain.id;
const inHand = (b: BattleModel, name: string) => snap(b).hand.find((c) => c.name === name)!;
const enemyNamed = (b: BattleModel, name: string) => snap(b).enemyCards.find((c) => c.name === name);
const marker = (c: { markers: { name: string; count: number }[] } | undefined, name: string) =>
  c?.markers.find((m) => m.name === name)?.count ?? 0;
const mainScheme = (b: BattleModel) => snap(b).enemyCards.find((c) => c.type === "main_scheme")!;
const encounterDiscardNames = (b: BattleModel) => snap(b).encounterDiscard.map((c) => c.name);
const revealCount = (r: Run) => r.beats.filter((b) => b.reveal && !b.reveal.boost).length;
const toHero = (b: BattleModel) => expect(b.heroAction("changeForm")).toBe(true);
/** Index of the first beat matching `pred`, asserted to exist so "after" comparisons can't pass on -1. */
function at(r: Run, label: string, pred: (b: BattleBeat) => boolean, from = 0): number {
  const i = r.beats.findIndex((b, n) => n >= from && pred(b));
  expect(i, `beat missing: ${label}`).toBeGreaterThanOrEqual(0);
  return i;
}
function spendAll(b: BattleModel, ...labels: string[]) {
  for (const label of labels) {
    const source = snap(b).payment!.sources.find((s) => s.label === label && !s.selected && s.available);
    expect(source, `payment source ${label}`).toBeDefined();
    b.toggle(source!.id);
  }
}
function play(b: BattleModel, name: string, ...labels: string[]) {
  expect(b.pick(inHand(b, name).id)).toBe(true);
  spendAll(b, ...labels);
  expect(b.pay()).toBe(true);
}
/** Defend with the given ally (by card id) when asked; decline anything else. */
const defendWith =
  (id: string): Answer =>
  (choice) => {
    if (!choice.defense) return undefined;
    const defender = choice.options.find((o) => o.cardId === id);
    return defender ? [defender.id] : undefined;
  };
const statusBeat = (id: string, name: string, delta: number) => (b: BattleBeat) =>
  b.statusChange?.id === id && b.statusChange.name === name && b.statusChange.delta === delta;
const optionNamed =
  (label: string | RegExp): Answer =>
  (choice) => {
    const o = choice.options.find((x) => (typeof label === "string" ? x.label === label : label.test(x.label)));
    return o ? [o.id] : undefined;
  };

// ===============================================================================================================
// 01094 Rhino and 01097a The Break-In!
// ===============================================================================================================

test("01094 Rhino (alter-ego): schemes with the boost card's icons; boost is dealt, flipped, then resolved", () => {
  // RRG v1.8 "Boost, Boost Icon" and "Scheme (Enemy Activation)": boost icons add to SCH. Sandman has 2 boost icons.
  const battle = scenario({ top: ["01102", "01108"] });
  const run = endTurn(battle);
  const deal = at(run, "boost dealt", (b) => !!b.encounterDeal && b.text.includes("boost card to Rhino"));
  const flip = at(
    run,
    "boost flipped",
    (b) => b.reveal?.boost?.icons === 2 && b.reveal.boost.enemy === rhinoId(battle),
  );
  const threat = at(
    run,
    "Rhino places threat",
    (b) => b.threat?.scheme === mainScheme(battle).id && b.threat.delta === 3,
  );
  expect(deal).toBeLessThan(flip);
  expect(flip).toBeLessThan(threat);
  // The deal says whose boost card it is, so the table can lay it beside Rhino and tag it.
  expect(run.beats[deal]!.boostFor).toBe(rhinoId(battle));
  expect(run.beats[flip]!.reveal!.name).toBe("Sandman");
  // step 1 places 1 threat, Rhino's 1 SCH + 2 boost places 3 more.
  expect(mainScheme(battle).threat).toBe(4);
  expect(encounterDiscardNames(battle)).toContain("Sandman");
  expect(enemyNamed(battle, "Sandman")).toBeUndefined();
});

test("01094 Rhino (hero): attacks Spider-Man and adds the boost icons to his ATK", () => {
  const battle = scenario({ top: ["01102", "01108"] });
  toHero(battle);
  // While Spider-Man is asked to defend, Rhino's boost card waits facedown beside him (RRG v1.8 "Attack (Enemy
  // Activation)", p. 8, steps 1-3: the boost card is given, then the defender declared, then the boost card turned up).
  let waiting: readonly { id: string; enemy: string }[] = [];
  const run = endTurn(battle, (choice) => {
    if (choice.defense) waiting = snap(battle).facedownBoosts;
    return undefined;
  });
  expect(waiting).toEqual([{ id: expect.any(String), enemy: rhinoId(battle) }]);
  expect(run.prompts.find((c) => c.defense)?.defense?.attackerId).toBe(rhinoId(battle));
  const flip = at(run, "boost flipped", (b) => b.reveal?.boost?.icons === 2);
  expect(run.beats[flip]!.reveal!.id).toBe(waiting[0]!.id);
  const hit = at(run, "Rhino hit", (b) => b.hit?.source === rhinoId(battle) && b.hit.target === heroId(battle));
  expect(run.beats[hit]!.hit!.amount).toBe(4);
  expect(flip).toBeLessThan(hit);
  expect(snap(battle).heroHp).toBe(6);
});

test("01097a The Break-In!: places threat at the start of every villain phase, before Rhino acts", () => {
  const battle = scenario({ top: ["01104"] });
  expect(mainScheme(battle).threatTarget).toBe(7);
  const run = endTurn(battle);
  const first = at(run, "step 1 threat", (b) => b.threat?.scheme === mainScheme(battle).id);
  expect(run.beats[first]!.threat!.delta).toBe(1);
  expect(first).toBeLessThan(at(run, "Rhino acts", (b) => !!b.enemyActivation));
  expect(mainScheme(battle).threat).toBe(2);
});

test("01097a The Break-In!: the players lose when its threat reaches the limit", () => {
  // Final stage text: "If this stage is completed, the players lose the game." Step 1 (+1) and Rhino's scheme (+1) take 5 to 7.
  const battle = scenario({ top: ["01104"], threatOf: { main: 5 } });
  const run = endTurn(battle);
  expect(snap(battle).outcome).toEqual({ result: "loss", reason: "mainSchemeCompleted" });
  expect(snap(battle).turn).toBe("finished");
  const placed = at(run, "threat placed", (b) => b.threat?.delta === 1 && b.threat.scheme === mainScheme(battle).id);
  expect(at(run, "game ended", (b) => !!b.gameEnded, placed)).toBeGreaterThan(placed);
  expect(run.beats.some((b) => b.phase === "hero")).toBe(false);
});

// ===============================================================================================================
// 01098 Armored Rhino Suit
// ===============================================================================================================

test("01098 Armored Rhino Suit: revealed, it attaches to Rhino", () => {
  const battle = scenario({ top: ["01105", "01098"] });
  const run = endTurn(battle);
  const reveal = at(run, "suit revealed", (b) => b.reveal?.name === "Armored Rhino Suit");
  expect(reveal).toBeGreaterThan(at(run, "boost", (b) => !!b.reveal?.boost));
  expect(enemyNamed(battle, "Armored Rhino Suit")).toMatchObject({ attachedTo: rhinoId(battle), type: "attachment" });
});

test("01098 Armored Rhino Suit: Spider-Man's basic attack lands on the suit instead of Rhino", () => {
  const battle = scenario({ attached: ["01098"] });
  toHero(battle);
  const atk = battle.basicPower(heroId(battle), "atk");
  expect(battle.heroAction("basicAttack")).toBe(true);
  expect(snap(battle).villainHp).toBe(14);
  expect(marker(enemyNamed(battle, "Armored Rhino Suit"), "damage")).toBe(atk);
  expect(enemyNamed(battle, "Armored Rhino Suit")?.attachedTo).toBe(rhinoId(battle));
});

test("01098 Armored Rhino Suit: with 5 or more damage on it the suit is discarded (all 8 damage goes on the suit)", () => {
  // "place it here instead. Then, if there is at least 5 damage here, discard Armored Rhino Suit."
  const battle = scenario({ attached: ["01098"], hand: ["01005", "01090", "01088"] });
  toHero(battle);
  expect(battle.pick(inHand(battle, "Swinging Web Kick").id)).toBe(true);
  spendAll(battle, "Strength", "Energy");
  expect(battle.pay()).toBe(true);
  const target = snap(battle).choice?.options.find((o) => o.cardId === rhinoId(battle));
  if (target) expect(battle.choose(target.id)).toBe(true);
  expect(snap(battle).villainHp).toBe(14);
  expect(enemyNamed(battle, "Armored Rhino Suit")).toBeUndefined();
  expect(encounterDiscardNames(battle)).toContain("Armored Rhino Suit");
});

test("01098 Armored Rhino Suit: takes the damage before a tough status, which is kept (FFG ruling July 20, 2023)", () => {
  const battle = scenario({ attached: ["01098"], villainStatus: { tough: 1 } });
  toHero(battle);
  expect(battle.heroAction("basicAttack")).toBe(true);
  expect(marker(enemyNamed(battle, "Armored Rhino Suit"), "damage")).toBeGreaterThan(0);
  expect(marker(snap(battle).villain, "tough")).toBe(1);
  expect(snap(battle).beats.some((b) => b.hit?.tough)).toBe(false);
});

// ===============================================================================================================
// 01099 Charge
// ===============================================================================================================

test("01099 Charge: revealed, it attaches to Rhino and the table shows his +3 ATK", () => {
  const battle = scenario({ top: ["01105", "01099"] });
  const run = endTurn(battle);
  const reveal = at(run, "Charge revealed", (b) => b.reveal?.name === "Charge");
  const mod = at(run, "ATK modifier", (b) => b.modifier?.id === rhinoId(battle) && b.modifier.count === 3);
  expect(mod).toBeGreaterThan(reveal);
  expect(enemyNamed(battle, "Charge")?.attachedTo).toBe(rhinoId(battle));
});

test("01099 Charge: Rhino's attack has overkill - a defending ally's excess damage goes to the hero - then Charge is discarded", () => {
  // RRG v1.8 "Overkill"; Charge text. Jessica Jones has 3 HP, Rhino hits for 2 + 3 = 5, so 2 excess reaches Spider-Man.
  const battle = scenario({ attached: ["01099"], top: ["01104"], hand: ["01059", "01090", "01088"] });
  toHero(battle);
  play(battle, "Jessica Jones", "Strength", "Energy");
  const jessica = snap(battle).inPlay.find((c) => c.name === "Jessica Jones")!;
  const run = endTurn(battle, defendWith(jessica.id));
  expect(snap(battle).inPlay.some((c) => c.id === jessica.id)).toBe(false);
  expect(snap(battle).discard.map((c) => c.id)).toContain(jessica.id);
  expect(snap(battle).heroHp).toBe(8);
  const ally = at(run, "hit on Jessica", (b) => b.hit?.target === jessica.id);
  const overflow = at(run, "overkill hit on Spider-Man", (b) => b.hit?.target === heroId(battle) && b.hit.amount === 2);
  expect(overflow).toBeGreaterThanOrEqual(ally);
  expect(enemyNamed(battle, "Charge")).toBeUndefined();
  expect(encounterDiscardNames(battle)).toContain("Charge");
  expect(
    at(run, "ATK back to printed", (b) => b.modifier?.id === rhinoId(battle) && b.modifier.count === 0),
  ).toBeGreaterThan(ally);
});

// ===============================================================================================================
// 01100 Enhanced Ivory Horn
// ===============================================================================================================

test("01100 Enhanced Ivory Horn: revealed, it attaches to Rhino for +1 ATK", () => {
  const battle = scenario({ top: ["01105", "01100"] });
  const run = endTurn(battle);
  const reveal = at(run, "Horn revealed", (b) => b.reveal?.name === "Enhanced Ivory Horn");
  expect(at(run, "ATK +1", (b) => b.modifier?.id === rhinoId(battle) && b.modifier.count === 1)).toBeGreaterThan(
    reveal,
  );
  expect(enemyNamed(battle, "Enhanced Ivory Horn")?.attachedTo).toBe(rhinoId(battle));
});

test("01100 Enhanced Ivory Horn: its Hero Action is reachable from the table and spends 3 physical to discard it", () => {
  const battle = scenario({ attached: ["01100"], hand: ["01090", "01003"] });
  toHero(battle);
  const horn = enemyNamed(battle, "Enhanced Ivory Horn")!;
  const actions = battle.fieldActions(horn.id);
  expect(actions.length).toBeGreaterThan(0);
  expect(battle.fieldAction(horn.id, actions[0]!.kind)).toBe(true);
  expect(snap(battle).payment).not.toBeNull();
  spendAll(battle, "Strength", "Backflip");
  expect(battle.pay()).toBe(true);
  expect(enemyNamed(battle, "Enhanced Ivory Horn")).toBeUndefined();
  expect(encounterDiscardNames(battle)).toContain("Enhanced Ivory Horn");
  expect(snap(battle).villain.markers.some((m) => m.name === "ATK")).toBe(false);
});

test("01100 Enhanced Ivory Horn: its Hero Action is not offered in alter-ego form", () => {
  // "Hero Action" - RRG v1.8 "Action" / "Form": only while in hero form.
  const battle = scenario({ attached: ["01100"], hand: ["01090", "01003"] });
  const horn = enemyNamed(battle, "Enhanced Ivory Horn")!;
  expect(battle.fieldActions(horn.id)).toEqual([]);
});

// ===============================================================================================================
// 01101 Hydra Mercenary (guard)
// ===============================================================================================================

test("01101 Hydra Mercenary: guard - with two engaged, a basic attack can only choose a Mercenary, never Rhino", () => {
  // RRG v1.8 "Guard": the engaged player cannot attack any villain.
  const battle = scenario({ inPlay: ["01101", "01101"] });
  toHero(battle);
  expect(battle.heroAction("basicAttack")).toBe(true);
  const choice = snap(battle).choice!;
  expect(choice).not.toBeNull();
  expect(choice.options).toHaveLength(2);
  expect(choice.options.some((o) => o.cardId === rhinoId(battle))).toBe(false);
  expect(battle.choose(choice.options[0]!.id)).toBe(true);
  expect(snap(battle).villainHp).toBe(14);
  expect(
    snap(battle)
      .enemyCards.filter((c) => c.name === "Hydra Mercenary")
      .map((c) => c.hp)
      .sort(),
  ).toEqual([1, 3]);
});

test("01101 Hydra Mercenary: killing the guard frees Spider-Man to attack Rhino; Swinging Web Kick can't target Rhino while it guards", () => {
  const battle = scenario({ inPlay: ["01101"], hand: ["01005", "01090", "01088"] });
  toHero(battle);
  const guard = enemyNamed(battle, "Hydra Mercenary")!;
  expect(battle.pick(inHand(battle, "Swinging Web Kick").id)).toBe(true);
  spendAll(battle, "Strength", "Energy");
  expect(battle.pay()).toBe(true);
  const targets = snap(battle).choice;
  if (targets) {
    expect(targets.options.some((o) => o.cardId === rhinoId(battle))).toBe(false);
    expect(battle.choose(targets.options.find((o) => o.cardId === guard.id)!.id)).toBe(true);
  }
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeUndefined();
  expect(encounterDiscardNames(battle)).toContain("Hydra Mercenary");
  expect(snap(battle).beats.some((b) => b.defeatedCard === guard.id)).toBe(true);
  expect(battle.heroAction("basicAttack")).toBe(true);
  expect(snap(battle).villainHp).toBe(12);
});

test("01101 Hydra Mercenary: an engaged minion attacks in the villain phase and is not dealt a boost card", () => {
  // RRG v1.8 "Boost": a minion without the villainous keyword skips the boost step.
  const battle = scenario({ inPlay: ["01101"], top: ["01104", "01108"] });
  toHero(battle);
  const run = endTurn(battle);
  const merc = enemyNamed(battle, "Hydra Mercenary")!;
  const hit = at(run, "Mercenary hit", (b) => b.hit?.source === merc.id && b.hit.target === heroId(battle));
  expect(run.beats[hit]!.hit!.amount).toBe(1);
  expect(run.beats.some((b) => b.text.includes("boost card to Hydra Mercenary"))).toBe(false);
  expect(snap(battle).heroHp).toBe(7);
});

// ===============================================================================================================
// 01102 Sandman (toughness)
// ===============================================================================================================

test("01102 Sandman: enters play with a tough status the table shows", () => {
  const battle = scenario({ top: ["01105", "01102"] });
  const run = endTurn(battle);
  const sandman = enemyNamed(battle, "Sandman")!;
  expect(marker(sandman, "tough")).toBe(1);
  const reveal = at(run, "Sandman revealed", (b) => b.reveal?.name === "Sandman");
  expect(at(run, "tough given", statusBeat(sandman.id, "tough", 1))).toBeGreaterThan(reveal);
  // No When Revealed to read out: the table lands him without waiting for Continue.
  expect(run.beats[reveal]!.reveal!.quick).toBe(true);
});

test("01102 Sandman: the first hit is absorbed by tough, leaving his HP alone", () => {
  // RRG v1.8 "Toughness" / "Status Cards": tough prevents the damage and is discarded. Sandman has 4 HP.
  const battle = scenario({ top: ["01105", "01102"] });
  endTurn(battle);
  const sandman = enemyNamed(battle, "Sandman")!;
  toHero(battle);
  expect(battle.heroAction("basicAttack")).toBe(true);
  expect(battle.choose(snap(battle).choice!.options.find((o) => o.cardId === sandman.id)!.id)).toBe(true);
  expect(snap(battle).beats.find((b) => b.hit?.target === sandman.id)?.hit).toMatchObject({ amount: 0, tough: true });
  expect(enemyNamed(battle, "Sandman")).toMatchObject({ hp: 4 });
  expect(marker(enemyNamed(battle, "Sandman"), "tough")).toBe(0);
});

test("01102 Sandman: as an engaged minion he schemes for 2 in alter-ego form", () => {
  const alter = scenario({ inPlay: ["01102"], top: ["01104"] });
  const schemed = endTurn(alter);
  const sandman = enemyNamed(alter, "Sandman")!;
  at(
    schemed,
    "Sandman schemes",
    (b) => b.threat?.scheme === mainScheme(alter).id && b.threat.delta === 2 && b.actor === sandman.id,
  );
  expect(mainScheme(alter).threat).toBe(4);
});

test("01102 Sandman: as an engaged minion he attacks for 3 in hero form", () => {
  const hero = scenario({ inPlay: ["01102"], top: ["01104"] });
  toHero(hero);
  const attacked = endTurn(hero);
  at(attacked, "Sandman attacks", (b) => b.hit?.source === enemyNamed(hero, "Sandman")!.id && b.hit.amount === 3);
  expect(snap(hero).heroHp).toBe(5);
});

// ===============================================================================================================
// 01103 Shocker
// ===============================================================================================================

test("01103 Shocker: When Revealed deals 1 damage to Spider-Man in hero form", () => {
  const battle = scenario({ top: ["01105", "01103"] });
  toHero(battle);
  const run = endTurn(battle);
  const reveal = at(run, "Shocker revealed", (b) => b.reveal?.name === "Shocker");
  // A minion goes straight to the mat (no Continue), and its When Revealed fires with a flash before the hit.
  expect(run.beats[reveal]!.reveal).toMatchObject({ quick: true, whenRevealed: true });
  const hit = at(run, "1 damage", (b) => b.hit?.target === heroId(battle) && b.hit.amount === 1);
  expect(hit).toBeGreaterThan(reveal);
  expect(snap(battle).heroHp).toBe(7);
  expect(enemyNamed(battle, "Shocker")).toBeDefined();
});

test("01103 Shocker: Peter Parker in alter-ego form is not a hero, so he takes no damage", () => {
  // RRG v1.8 "Form, Change Form": while in alter-ego form, card abilities that interact with their hero do not interact with their identity.
  const battle = scenario({ top: ["01105", "01103"] });
  const run = endTurn(battle);
  expect(snap(battle).heroHp).toBe(10);
  expect(run.beats.some((b) => b.hit?.target === heroId(battle))).toBe(false);
});

// ===============================================================================================================
// 01104 Hard to Keep Down, 01105 "I'm Tough!"
// ===============================================================================================================

test("01104 Hard to Keep Down: Rhino heals 4 and the table shows it", () => {
  const battle = scenario({ top: ["01105", "01104", "01101"], villainDamage: 6 });
  const run = endTurn(battle);
  const reveal = at(run, "revealed", (b) => b.reveal?.name === "Hard to Keep Down");
  const heal = at(run, "heal", statusBeat(rhinoId(battle), "damage", -4));
  expect(heal).toBeGreaterThan(reveal);
  expect(snap(battle).villainHp).toBe(12);
  expect(revealCount(run)).toBe(1);
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeUndefined();
});

test("01104 Hard to Keep Down: healing only the damage there is still counts as healing (no surge)", () => {
  const battle = scenario({ top: ["01105", "01104", "01101"], villainDamage: 2 });
  const run = endTurn(battle);
  expect(snap(battle).villainHp).toBe(14);
  expect(revealCount(run)).toBe(1);
});

test("01104 Hard to Keep Down: with no damage to heal it gains surge", () => {
  const battle = scenario({ top: ["01105", "01104", "01101"] });
  const run = endTurn(battle);
  expect(revealCount(run)).toBe(2);
  expect(at(run, "surged card", (b) => b.reveal?.name === "Hydra Mercenary")).toBeGreaterThan(
    at(run, "HtKD", (b) => b.reveal?.name === "Hard to Keep Down"),
  );
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeDefined();
});

test('01105 "I\'m Tough!": gives Rhino a tough status', () => {
  const battle = scenario({ top: ["01104", "01105", "01101"] });
  const run = endTurn(battle);
  expect(marker(snap(battle).villain, "tough")).toBe(1);
  at(run, "tough given", statusBeat(rhinoId(battle), "tough", 1));
  expect(revealCount(run)).toBe(1);
});

test('01105 "I\'m Tough!": if Rhino is already tough it gains surge and he does not get a second tough', () => {
  const battle = scenario({ top: ["01104", "01105", "01101"], villainStatus: { tough: 1 } });
  const run = endTurn(battle);
  expect(marker(snap(battle).villain, "tough")).toBe(1);
  expect(revealCount(run)).toBe(2);
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeDefined();
});

test("01105 \"I'm Tough!\": Rhino's tough absorbs Spider-Man's next hit", () => {
  const battle = scenario({ top: ["01104", "01105", "01101"] });
  endTurn(battle);
  toHero(battle);
  // The surge did not fire, so no Hydra Mercenary guards Rhino.
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeUndefined();
  expect(battle.heroAction("basicAttack")).toBe(true);
  expect(snap(battle).villainHp).toBe(14);
  expect(snap(battle).beats.some((b) => b.hit?.tough)).toBe(true);
});

// ===============================================================================================================
// 01106 Stampede
// ===============================================================================================================

test("01106 Stampede (alter-ego): gains surge", () => {
  const battle = scenario({ top: ["01104", "01106", "01101"] });
  const run = endTurn(battle);
  expect(revealCount(run)).toBe(2);
  expect(snap(battle).heroHp).toBe(10);
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeDefined();
});

test("01106 Stampede (hero): Rhino attacks again with a new boost card and Spider-Man, damaged, is stunned", () => {
  const battle = scenario({ top: ["01104", "01106", "01105"] });
  toHero(battle);
  const run = endTurn(battle);
  const reveal = at(run, "Stampede revealed", (b) => b.reveal?.name === "Stampede");
  const boost = at(run, "new boost card", (b) => !!b.encounterDeal && b.text.includes("boost card to Rhino"), reveal);
  const hit = at(run, "second Rhino hit", (b) => b.hit?.source === rhinoId(battle) && b.hit.amount === 2, boost);
  const stun = at(run, "stunned", statusBeat(heroId(battle), "stunned", 1));
  expect(stun).toBeGreaterThan(hit);
  expect(snap(battle).heroHp).toBe(6);
  expect(marker(snap(battle).hero, "stunned")).toBe(1);
});

test("01106 Stampede (hero): the stun cancels Spider-Man's next basic attack", () => {
  // RRG v1.8 "Stun, Stunned": the attack is replaced by removing the stunned card; costs (exhaust) are still paid.
  const battle = scenario({ top: ["01104", "01106", "01105"] });
  toHero(battle);
  endTurn(battle);
  expect(snap(battle).turn).toBe("player");
  expect(battle.heroAction("basicAttack")).toBe(true);
  expect(snap(battle).villainHp).toBe(14);
  expect(marker(snap(battle).hero, "stunned")).toBe(0);
  expect(snap(battle).hero.exhausted).toBe(true);
  expect(snap(battle).beats.some(statusBeat(heroId(battle), "stunned", -1))).toBe(true);
});

test("01106 Stampede (hero): a defending ally damaged by the attack is stunned", () => {
  const battle = scenario({ top: ["01104", "01106", "01105"], hand: ["01059", "01090", "01088"] });
  toHero(battle);
  play(battle, "Jessica Jones", "Strength", "Energy");
  const jessica = snap(battle).inPlay.find((c) => c.name === "Jessica Jones")!;
  // Rhino's own attack goes undefended; Jessica defends the Stampede attack only.
  let defenses = 0;
  const run = endTurn(battle, (choice) => {
    if (!choice.defense) return undefined;
    const option = choice.options.find((o) => o.cardId === jessica.id);
    return option && defenses++ === 1 ? [option.id] : undefined;
  });
  expect(
    marker(
      snap(battle).inPlay.find((c) => c.id === jessica.id),
      "stunned",
    ),
  ).toBe(1);
  expect(marker(snap(battle).hero, "stunned")).toBe(0);
  at(run, "Jessica stunned", statusBeat(jessica.id, "stunned", 1));
});

// ===============================================================================================================
// 01107 Breakin' & Takin', 01108 Crowd Control
// ===============================================================================================================

test("01107 Breakin' & Takin': enters with 2 threat plus 1 per hero, revealed before the threat is placed", () => {
  const battle = scenario({ top: ["01104", "01107"] });
  const run = endTurn(battle);
  const scheme = enemyNamed(battle, "Breakin' & Takin'")!;
  expect(scheme.threat).toBe(3);
  const reveal = at(run, "revealed", (b) => b.reveal?.id === scheme.id);
  expect(at(run, "threat on it", (b) => b.threat?.scheme === scheme.id && b.threat.delta > 0)).toBeGreaterThan(reveal);
  expect(run.beats.filter((b) => b.threat?.scheme === scheme.id).reduce((n, b) => n + b.threat!.delta, 0)).toBe(3);
});

test("01107 Breakin' & Takin': its hazard icon deals one extra encounter card in the villain phase", () => {
  // RRG v1.8 "Hazard Icon". Two cards are dealt and revealed instead of one.
  const battle = scenario({ inPlay: ["01107"], threatOf: { "01107": 3 }, top: ["01104", "01101", "01105"] });
  const run = endTurn(battle);
  expect(run.beats.filter((b) => b.encounterDeal && b.text === "Deal an encounter card")).toHaveLength(2);
  expect(revealCount(run)).toBe(2);
});

test("01108 Crowd Control: its crisis icon stops Spider-Man's thwart reaching the main scheme", () => {
  // RRG v1.8 "Crisis Icon": player cards cannot remove threat from the main scheme while a crisis icon is in play.
  const battle = scenario({ inPlay: ["01108"], threatOf: { "01108": 5, main: 3 } });
  toHero(battle);
  expect(battle.heroAction("basicThwart")).toBe(true);
  expect(snap(battle).choice).toBeNull();
  expect(mainScheme(battle).threat).toBe(3);
  expect(enemyNamed(battle, "Crowd Control")!.threat).toBe(4);
});

test("01108 Crowd Control: once it is defeated the main scheme can be thwarted again", () => {
  const battle = scenario({ inPlay: ["01108", "01059"], threatOf: { "01108": 1, main: 3 } });
  toHero(battle);
  const jessica = snap(battle).inPlay.find((c) => c.name === "Jessica Jones")!;
  expect(battle.heroAction("basicThwart")).toBe(true);
  expect(snap(battle).beats.some((b) => !!b.defeatedCard)).toBe(true);
  expect(enemyNamed(battle, "Crowd Control")).toBeUndefined();
  expect(encounterDiscardNames(battle)).toContain("Crowd Control");
  expect(battle.fieldAction(jessica.id, "basicThwart")).toBe(true);
  expect(mainScheme(battle).threat).toBeLessThan(3);
});

test("01108 Crowd Control: enters with 2 threat per hero", () => {
  const battle = scenario({ top: ["01104", "01108"] });
  endTurn(battle);
  expect(enemyNamed(battle, "Crowd Control")!.threat).toBe(2);
});

// ===============================================================================================================
// Bomb Scare set: 01109 - 01112
// ===============================================================================================================

test("01109 Bomb Scare: enters with 2 threat plus 1 per hero", () => {
  const battle = scenario({ top: ["01104", "01109"] });
  const run = endTurn(battle);
  expect(enemyNamed(battle, "Bomb Scare")!.threat).toBe(3);
  expect(at(run, "threat placed", (b) => b.threat?.scheme === enemyNamed(battle, "Bomb Scare")!.id)).toBeGreaterThan(
    at(run, "revealed", (b) => b.reveal?.name === "Bomb Scare"),
  );
});

test("01109 Bomb Scare: its acceleration icon adds 1 threat to the main scheme in step 1", () => {
  // RRG v1.8 "Acceleration Icon". Step 1 places 1 + 1, then Rhino's scheme adds 1.
  const battle = scenario({ inPlay: ["01109"], threatOf: { "01109": 3 }, top: ["01104", "01101"] });
  const run = endTurn(battle);
  const step1 = run.beats
    .slice(
      0,
      at(run, "Rhino acts", (b) => !!b.enemyActivation),
    )
    .filter((b) => b.threat?.scheme === mainScheme(battle).id);
  expect(step1.reduce((n, b) => n + b.threat!.delta, 0)).toBe(2);
  expect(mainScheme(battle).threat).toBe(3);
});

test("01110 Hydra Bomber: When Revealed lets the player take 2 damage", () => {
  const battle = scenario({ top: ["01104", "01110"] });
  const run = endTurn(battle, optionNamed("Take 2 damage"));
  const prompt = run.prompts.find((p) => p.options.some((o) => o.label === "Take 2 damage"))!;
  expect(prompt.options.map((o) => o.label)).toEqual(["Take 2 damage", "Place 1 threat on the main scheme"]);
  expect(snap(battle).heroHp).toBe(8);
  expect(mainScheme(battle).threat).toBe(2);
  expect(enemyNamed(battle, "Hydra Bomber")).toBeDefined();
  expect(at(run, "damage after reveal", (b) => b.hit?.target === heroId(battle) && b.hit.amount === 2)).toBeGreaterThan(
    at(run, "revealed", (b) => b.reveal?.name === "Hydra Bomber"),
  );
});

test("01110 Hydra Bomber: When Revealed lets the player place 1 threat on the main scheme instead", () => {
  const battle = scenario({ top: ["01104", "01110"] });
  const run = endTurn(battle, optionNamed("Place 1 threat on the main scheme"));
  expect(snap(battle).heroHp).toBe(10);
  expect(mainScheme(battle).threat).toBe(3);
  const reveal = at(run, "revealed", (b) => b.reveal?.name === "Hydra Bomber");
  expect(
    at(run, "threat after reveal", (b) => b.threat?.scheme === mainScheme(battle).id && b.threat.delta === 1, reveal),
  ).toBeGreaterThan(reveal);
});

test("01111 Explosion: with Bomb Scare in play it assigns X damage (the threat on Bomb Scare) to Spider-Man", () => {
  const battle = scenario({ inPlay: ["01109"], threatOf: { "01109": 3 }, top: ["01104", "01111"] });
  toHero(battle);
  const run = endTurn(battle);
  const reveal = at(run, "Explosion revealed", (b) => b.reveal?.name === "Explosion");
  const hit = at(run, "3 damage", (b) => b.hit?.target === heroId(battle) && b.hit.amount === 3, reveal);
  expect(hit).toBeGreaterThan(reveal);
  expect(snap(battle).heroHp).toBe(5);
  expect(revealCount(run)).toBe(1);
});

test("01111 Explosion: with no Bomb Scare in play it gains surge", () => {
  const battle = scenario({ top: ["01104", "01111", "01101"] });
  toHero(battle);
  const run = endTurn(battle);
  expect(revealCount(run)).toBe(2);
  expect(snap(battle).heroHp).toBe(8);
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeDefined();
});

test("01111 Explosion: an alter-ego Peter Parker is not a hero, so no damage is assigned to him", () => {
  // RRG v1.8 "Form, Change Form"; card script comment in packages/cards/src/core/modular/bomb-scare.ts.
  const battle = scenario({ inPlay: ["01109"], threatOf: { "01109": 3 }, top: ["01104", "01111"] });
  endTurn(battle);
  expect(snap(battle).heroHp).toBe(10);
});

test("01112 False Alarm: confuses Peter Parker and the table shows it", () => {
  const battle = scenario({ top: ["01104", "01112", "01101"] });
  const run = endTurn(battle);
  at(run, "confused", statusBeat(heroId(battle), "confused", 1));
  expect(marker(snap(battle).hero, "confused")).toBe(1);
  expect(revealCount(run)).toBe(1);
});

test("01112 False Alarm: if already confused it gains surge", () => {
  const battle = scenario({ top: ["01104", "01112", "01101"], heroStatus: { confused: 1 } });
  const run = endTurn(battle);
  expect(marker(snap(battle).hero, "confused")).toBe(1);
  expect(revealCount(run)).toBe(2);
});

test("01112 False Alarm: the confusion cancels Peter's next thwart", () => {
  // RRG v1.8 "Confuse, Confused": the thwart is replaced by discarding the confused status; the character still exhausts.
  const battle = scenario({ top: ["01104", "01112", "01101"], threatOf: { main: 2 } });
  endTurn(battle);
  // Alter-ego Peter has no basic thwart; the status stays on the identity when he changes form (RRG "Form").
  toHero(battle);
  const before = mainScheme(battle).threat;
  expect(battle.heroAction("basicThwart")).toBe(true);
  expect(mainScheme(battle).threat).toBe(before);
  expect(marker(snap(battle).hero, "confused")).toBe(0);
});

// ===============================================================================================================
// 01165 Eviction Notice (obligation)
// ===============================================================================================================

test("01165 Eviction Notice: Peter can exhaust to remove it from the game", () => {
  const battle = scenario({ top: ["01104", "01165", "01101"] });
  const run = endTurn(battle, optionNamed(/^Exhaust Peter Parker/));
  const prompt = run.prompts.find((p) => p.options.some((o) => o.label.startsWith("Exhaust")))!;
  expect(prompt.options.map((o) => o.label)).toEqual([
    "Exhaust Peter Parker → remove this obligation from the game",
    "Discard 1 card at random from your hand; this card gains surge",
  ]);
  expect(snap(battle).hero.exhausted).toBe(true);
  expect(revealCount(run)).toBe(1);
  expect(encounterDiscardNames(battle)).not.toContain("Eviction Notice");
  expect(enemyNamed(battle, "Eviction Notice")).toBeUndefined();
  expect(snap(battle).hand).toHaveLength(6);
});

test("01165 Eviction Notice: removed from the game, it leaves the table instead of standing by the villain", () => {
  // Adam, 2026-11-22: after "Exhaust Peter Parker" the card stayed beside Rhino for the rest of the game.
  const battle = scenario({ top: ["01104", "01165", "01101"] });
  const run = endTurn(battle, optionNamed(/^Exhaust Peter Parker/));
  const notice = run.beats.find((b) => b.reveal?.name === "Eviction Notice")!.reveal!.id;
  const gone = run.beats.find((b) => b.leftPlay === notice);
  expect(gone?.text).toBe("Eviction Notice is removed from the game");
});

test("01165 Eviction Notice: or he discards a card at random, the card gains surge, and the obligation is discarded", () => {
  const battle = scenario({ top: ["01104", "01165", "01101"] });
  const handBefore = snap(battle).hand.length;
  const run = endTurn(battle, optionNamed(/^Discard 1 card at random/));
  expect(snap(battle).hand).toHaveLength(handBefore - 1);
  expect(snap(battle).discard).toHaveLength(1);
  expect(snap(battle).hero.exhausted).toBe(false);
  expect(encounterDiscardNames(battle)).toContain("Eviction Notice");
  expect(revealCount(run)).toBe(2);
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeDefined();
});

test("01165 Eviction Notice: the card discarded at random is shown leaving the hand", () => {
  const battle = scenario({ top: ["01104", "01165", "01101"] });
  const run = endTurn(battle, optionNamed(/^Discard 1 card at random/));
  const lost = snap(battle).discard[0]!;
  expect(run.beats.some((b) => b.handDiscard?.includes(lost.id))).toBe(true);
});

test("01165 Eviction Notice: in hero form Spider-Man may flip to alter-ego first, then resolve it", () => {
  const battle = scenario({ top: ["01104", "01165", "01101"] });
  toHero(battle);
  const run = endTurn(
    battle,
    (choice) => optionNamed("Flip to alter-ego form")(choice) ?? optionNamed(/^Exhaust Peter Parker/)(choice),
  );
  expect(run.prompts.some((p) => p.options.some((o) => o.label === "Stay in hero form"))).toBe(true);
  expect(snap(battle).hero.name).toBe("Peter Parker");
  expect(snap(battle).hero.exhausted).toBe(true);
});

// ===============================================================================================================
// Spider-Man's nemesis set: 01166 - 01169, 01190
// ===============================================================================================================

test("01166 Highway Robbery: When Revealed tucks a random card from hand facedown under it", () => {
  const battle = scenario({ top: ["01104", "01166"] });
  const run = endTurn(battle);
  const scheme = enemyNamed(battle, "Highway Robbery")!;
  expect(scheme.threat).toBe(3);
  // Peter's hand is 6 at the end of his turn; one card is now under the scheme, not in the discard.
  expect(snap(battle).hand).toHaveLength(5);
  expect(snap(battle).discard).toHaveLength(0);
  // The table needs some way to show the facedown card under the scheme (marker or beat).
  expect(
    scheme.markers.some((m) => /tuck|facedown|under/i.test(m.name)) ||
      run.beats.some((b) => /facedown|under|tuck/i.test(b.text)),
  ).toBe(true);
});

test("01166 Highway Robbery: the stolen card is picked at random and stays facedown under it, until it comes back", () => {
  // Adam, 2026-11-22: the card was placed facedown, then disappeared. It stays under the scheme, its back showing.
  const battle = scenario({ top: ["01104", "01166"] });
  const run = endTurn(battle);
  const scheme = enemyNamed(battle, "Highway Robbery")!;
  const tuck = run.beats.find((b) => b.tucked)!;
  expect(tuck.random).toBe(true);
  expect(snap(battle).under).toEqual([expect.objectContaining({ id: tuck.tucked!.ids[0], under: scheme.id })]);
  // Its face stays hidden: the table only gets the card back.
  expect(snap(battle).under[0]!.art).toMatch(/player-back/);
});

test("01166 Highway Robbery: once defeated, nothing is left lying under it", () => {
  const battle = scenario({ inPlay: ["01166"], tucked: { "01166": ["01090"] }, threatOf: { "01166": 1 } });
  expect(snap(battle).under).toHaveLength(1);
  toHero(battle);
  expect(battle.heroAction("basicThwart")).toBe(true);
  expect(snap(battle).under).toHaveLength(0);
  expect(snap(battle).beats.some((b) => b.returned?.length && b.returnedFrom)).toBe(true);
});

test("01165 Eviction Notice: its discard at random is shown as picked at random", () => {
  const battle = scenario({ top: ["01104", "01165", "01101"] });
  const run = endTurn(battle, optionNamed(/^Discard 1 card at random/));
  expect(run.beats.find((b) => b.handDiscard)?.random).toBe(true);
});

test("01166 Highway Robbery: When Defeated returns the facedown card to its owner's hand", () => {
  const battle = scenario({ inPlay: ["01166"], tucked: { "01166": ["01090"] }, threatOf: { "01166": 1 } });
  toHero(battle);
  const handBefore = snap(battle).hand.length;
  expect(battle.heroAction("basicThwart")).toBe(true);
  expect(enemyNamed(battle, "Highway Robbery")).toBeUndefined();
  expect(encounterDiscardNames(battle)).toContain("Highway Robbery");
  expect(snap(battle).hand).toHaveLength(handBefore + 1);
  expect(snap(battle).hand.some((c) => c.name === "Strength")).toBe(true);
  expect(snap(battle).beats.some((b) => !!b.defeatedCard)).toBe(true);
});

test("01166 Highway Robbery: its acceleration icon adds 1 threat in step 1", () => {
  const battle = scenario({ inPlay: ["01166"], threatOf: { "01166": 3 }, top: ["01104"] });
  const run = endTurn(battle);
  const step1 = run.beats
    .slice(
      0,
      at(run, "Rhino acts", (b) => !!b.enemyActivation),
    )
    .filter((b) => b.threat?.scheme === mainScheme(battle).id);
  expect(step1.reduce((n, b) => n + b.threat!.delta, 0)).toBe(2);
});

test("01167 Vulture: quickstrike - he attacks Spider-Man as soon as he engages, after being revealed", () => {
  // RRG v1.8 "Quickstrike": after the minion engages a player in hero form, it attacks. Vulture has 3 ATK and gets no boost.
  const battle = scenario({ top: ["01104", "01167", "01105"] });
  toHero(battle);
  const run = endTurn(battle);
  const reveal = at(run, "Vulture revealed", (b) => b.reveal?.name === "Vulture");
  const hit = at(
    run,
    "Vulture hit",
    (b) => b.hit?.source === enemyNamed(battle, "Vulture")!.id && b.hit.target === heroId(battle),
  );
  expect(hit).toBeGreaterThan(reveal);
  expect(run.beats[hit]!.hit!.amount).toBe(3);
  expect(snap(battle).heroHp).toBe(5);
  expect(run.beats.some((b) => b.text.includes("boost card to Vulture"))).toBe(false);
});

test("01167 Vulture: no quickstrike attack against Peter Parker in alter-ego form", () => {
  const battle = scenario({ top: ["01104", "01167"] });
  const run = endTurn(battle);
  expect(enemyNamed(battle, "Vulture")).toBeDefined();
  expect(run.beats.some((b) => b.hit?.target === heroId(battle))).toBe(false);
  expect(snap(battle).heroHp).toBe(10);
});

test("01168 Sweeping Swoop: When Revealed stuns Spider-Man; no surge without Vulture", () => {
  const battle = scenario({ top: ["01104", "01168", "01101"] });
  toHero(battle);
  const run = endTurn(battle);
  const reveal = at(run, "revealed", (b) => b.reveal?.name === "Sweeping Swoop");
  expect(at(run, "stunned", statusBeat(heroId(battle), "stunned", 1))).toBeGreaterThan(reveal);
  expect(marker(snap(battle).hero, "stunned")).toBe(1);
  expect(revealCount(run)).toBe(1);
});

test("01168 Sweeping Swoop: with Vulture in play it also gains surge", () => {
  const battle = scenario({ inPlay: ["01167"], top: ["01104", "01168", "01101"] });
  toHero(battle);
  const run = endTurn(battle);
  expect(marker(snap(battle).hero, "stunned")).toBe(1);
  expect(revealCount(run)).toBe(2);
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeDefined();
});

test("01168 Sweeping Swoop: in alter-ego form there is nothing to stun, and still no surge without Vulture", () => {
  const battle = scenario({ top: ["01104", "01168", "01101"] });
  const run = endTurn(battle);
  expect(marker(snap(battle).hero, "stunned")).toBe(0);
  expect(revealCount(run)).toBe(1);
});

test("01168 Sweeping Swoop (boost): if Rhino's attack damages Spider-Man, he is stunned", () => {
  const battle = scenario({ top: ["01168", "01101"] });
  toHero(battle);
  const run = endTurn(battle);
  const flip = at(run, "boost flipped", (b) => !!b.reveal?.boost && b.reveal.name === "Sweeping Swoop");
  const hit = at(run, "Rhino hit", (b) => b.hit?.source === rhinoId(battle) && b.hit.amount === 2);
  const stun = at(run, "stunned", (b) => b.statusChange?.name === "stunned" && b.statusChange.delta === 1);
  expect(flip).toBeLessThan(hit);
  expect(stun).toBeGreaterThan(hit);
  expect(marker(snap(battle).hero, "stunned")).toBe(1);
});

test("01169 The Vulture's Plans: discards a random card from hand and places 1 threat per resource type", () => {
  // Hand and draw are all single-type resources, so any card discarded is exactly 1 type.
  const battle = scenario({
    top: ["01104", "01169"],
    hand: ["01090"],
    deckTop: ["01089", "01088", "01003", "01008", "01009"],
  });
  const run = endTurn(battle);
  expect(snap(battle).discard).toHaveLength(1);
  expect(snap(battle).hand).toHaveLength(5);
  // step 1: 1, Rhino: 1, Plans: 1
  expect(mainScheme(battle).threat).toBe(3);
  const reveal = at(run, "revealed", (b) => b.reveal?.name === "The Vulture's Plans");
  expect(
    at(run, "Plans threat", (b) => b.threat?.scheme === mainScheme(battle).id && b.threat.delta === 1, reveal),
  ).toBeGreaterThan(reveal);
});

// PRESENTATION GAP: the random hand discard changes state but emits no beat (model.ts #accept only beats cardMoved resolving->discard).
test("01169 The Vulture's Plans: the card discarded from hand is shown leaving it", () => {
  const battle = scenario({
    top: ["01104", "01169"],
    hand: ["01090"],
    deckTop: ["01089", "01088", "01003", "01008", "01009"],
  });
  const run = endTurn(battle);
  const lost = snap(battle).discard[0]!;
  expect(run.beats.some((b) => b.handDiscard?.includes(lost.id))).toBe(true);
});

test("01190 Shadow of the Past (hero): brings in Vulture and Highway Robbery and shuffles the rest of the set into the deck; Vulture attacks last", () => {
  const battle = scenario({ top: ["01104", "01190"] });
  toHero(battle);
  const deckBefore = snap(battle).encounterCount;
  const run = endTurn(battle);
  const shadow = at(run, "Shadow revealed", (b) => b.reveal?.name === "Shadow of the Past");
  const vulture = at(run, "Vulture revealed", (b) => b.reveal?.name === "Vulture");
  const robbery = at(run, "Highway Robbery revealed", (b) => b.reveal?.name === "Highway Robbery");
  const hit = at(
    run,
    "Vulture quickstrike",
    (b) => b.hit?.source === enemyNamed(battle, "Vulture")?.id && b.hit?.target === heroId(battle),
  );
  expect(shadow).toBeLessThan(vulture);
  expect(vulture).toBeLessThan(robbery);
  expect(hit).toBeGreaterThan(robbery);
  // Vulture's Quickstrike waits for the rest of Shadow: he is aimed at Spider-Man only once Shadow is done (Adam,
  // 2026-11-22: the reticle sat on Spider-Man through Highway Robbery with no attack in sight), and it says why.
  const aim = at(run, "Vulture aims", (b) => b.attackAim?.source === enemyNamed(battle, "Vulture")?.id);
  const shadowDone = at(run, "Shadow discarded", (b) => b.encounterResolved === run.beats[shadow]!.reveal!.id);
  expect(aim).toBeGreaterThan(shadowDone);
  expect(aim).toBeLessThan(hit);
  expect(run.beats[aim]!.activity).toBe("Quickstrike: Vulture attacks");
  expect(run.beats.slice(vulture, aim).some((b) => b.activity === "Quickstrike: Vulture attacks")).toBe(false);
  // Brought in by Shadow, not dealt, and the rest of the set going into the deck is named as the nemesis's cards.
  expect(run.beats[vulture]!.reveal).toMatchObject({ broughtBy: "Shadow of the Past", nemesis: true });
  expect(run.beats[robbery]!.reveal).toMatchObject({ broughtBy: "Shadow of the Past", nemesis: true });
  expect(run.beats[shadow]!.reveal!.broughtBy).toBeUndefined();
  expect(run.beats.find((b) => b.intoEncounterDeck)?.nemesis).toBe(true);
  expect(enemyNamed(battle, "Vulture")).toBeDefined();
  expect(enemyNamed(battle, "Highway Robbery")!.threat).toBe(3);
  expect(snap(battle).heroHp).toBe(5);
  // 2 cards leave the deck (boost + Shadow); the rest of the nemesis set comes back in.
  expect(snap(battle).encounterCount).toBe(deckBefore - 2 + (nemesisSetSize - 2));
  expect(revealCount(run)).toBe(3);
});

test("01190 Shadow of the Past (alter-ego): Vulture engages Peter but does not attack him", () => {
  const battle = scenario({ top: ["01104", "01190"] });
  const run = endTurn(battle);
  expect(enemyNamed(battle, "Vulture")).toBeDefined();
  expect(enemyNamed(battle, "Highway Robbery")).toBeDefined();
  expect(run.beats.some((b) => b.hit?.target === heroId(battle))).toBe(false);
});

test("01190 Shadow of the Past: with no nemesis set aside it gains surge", () => {
  const battle = scenario({ top: ["01104", "01190", "01101"], noNemesis: true });
  const run = endTurn(battle);
  expect(revealCount(run)).toBe(2);
  expect(enemyNamed(battle, "Vulture")).toBeUndefined();
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeDefined();
});

// ===============================================================================================================
// Standard set: 01186 - 01189
// ===============================================================================================================

test("01186 Advance: the villain schemes again, with its own boost card (alter-ego)", () => {
  const battle = scenario({ top: ["01104", "01186", "01104"] });
  const run = endTurn(battle);
  const reveal = at(run, "Advance revealed", (b) => b.reveal?.name === "Advance");
  at(run, "extra boost", (b) => !!b.encounterDeal && b.text.includes("boost card to Rhino"), reveal);
  const schemes = run.beats.filter((b) => b.threat?.scheme === mainScheme(battle).id && b.actor === rhinoId(battle));
  expect(schemes).toHaveLength(2);
  expect(mainScheme(battle).threat).toBe(3);
});

test("01186 Advance: in hero form Rhino still schemes (after his normal attack)", () => {
  const battle = scenario({ top: ["01104", "01186", "01104"] });
  toHero(battle);
  const run = endTurn(battle);
  const attack = at(run, "attack", (b) => b.hit?.source === rhinoId(battle));
  expect(
    at(
      run,
      "scheme",
      (b) => b.threat?.scheme === mainScheme(battle).id && b.actor === rhinoId(battle) && b.threat.delta === 1,
    ),
  ).toBeGreaterThan(attack);
  expect(mainScheme(battle).threat).toBe(2);
  expect(snap(battle).heroHp).toBe(8);
});

test("01187 Assault (hero): the villain attacks you with a new boost card", () => {
  const battle = scenario({ top: ["01104", "01187", "01104"] });
  toHero(battle);
  const run = endTurn(battle);
  const reveal = at(run, "Assault revealed", (b) => b.reveal?.name === "Assault");
  at(run, "attack after reveal", (b) => b.hit?.source === rhinoId(battle) && b.hit.amount === 2, reveal);
  expect(snap(battle).heroHp).toBe(6);
  expect(run.prompts.filter((p) => p.defense)).toHaveLength(2);
});

test("01187 Assault (alter-ego): gains surge", () => {
  const battle = scenario({ top: ["01104", "01187", "01101"] });
  const run = endTurn(battle);
  expect(snap(battle).heroHp).toBe(10);
  expect(revealCount(run)).toBe(2);
});

test("01188 Caught Off Guard: discards your only support or upgrade", () => {
  const battle = scenario({ inPlay: ["01092"], top: ["01104", "01188", "01101"] });
  const helicarrier = snap(battle).inPlay.find((c) => c.name === "Helicarrier")!;
  const run = endTurn(battle);
  expect(snap(battle).inPlay.some((c) => c.id === helicarrier.id)).toBe(false);
  expect(snap(battle).discard.map((c) => c.id)).toContain(helicarrier.id);
  expect(revealCount(run)).toBe(1);
});

// PRESENTATION GAP: the discarded support/upgrade vanishes with no beat (model.ts #accept has no beat for a card leaving play to the discard).
test("01188 Caught Off Guard: the discarded card is shown leaving play", () => {
  const battle = scenario({ inPlay: ["01092"], top: ["01104", "01188", "01101"] });
  const helicarrier = snap(battle).inPlay.find((c) => c.name === "Helicarrier")!;
  const run = endTurn(battle);
  expect(run.beats.some((b) => b.leftPlay === helicarrier.id)).toBe(true);
});

test("01188 Caught Off Guard: with two eligible cards the player chooses which to discard", () => {
  const battle = scenario({ inPlay: ["01092", "01064"], top: ["01104", "01188", "01101"] });
  const team = snap(battle).inPlay.find((c) => c.name === "Surveillance Team")!;
  const run = endTurn(battle, (choice) => {
    const option = choice.options.find((o) => o.cardId === team.id);
    return option ? [option.id] : undefined;
  });
  const prompt = run.prompts.find((p) => p.options.some((o) => o.cardId === team.id))!;
  expect(prompt.options.map((o) => o.label).sort()).toEqual(["Helicarrier", "Surveillance Team"]);
  expect(snap(battle).discard.map((c) => c.name)).toContain("Surveillance Team");
  expect(snap(battle).inPlay.map((c) => c.name)).toEqual(["Helicarrier"]);
  expect(revealCount(run)).toBe(1);
});

test("01188 Caught Off Guard: that prompt says which card is asking", () => {
  const battle = scenario({ inPlay: ["01092", "01064"], top: ["01104", "01188", "01101"] });
  const run = endTurn(battle);
  const prompt = run.prompts.find((p) => p.options.some((o) => o.label === "Surveillance Team"))!;
  expect(`${prompt.sourceTitle ?? ""} ${prompt.prompt} ${prompt.explanation ?? ""}`).toMatch(
    /Caught Off Guard|upgrade|support/i,
  );
});

test("01188 Caught Off Guard: with nothing to discard it gains surge", () => {
  const battle = scenario({ top: ["01104", "01188", "01101"] });
  const run = endTurn(battle);
  expect(revealCount(run)).toBe(2);
  expect(enemyNamed(battle, "Hydra Mercenary")).toBeDefined();
});

test("01189 Gang-Up (hero): the villain and each engaged minion attack you", () => {
  const battle = scenario({ inPlay: ["01101"], top: ["01104", "01189", "01104"] });
  toHero(battle);
  const run = endTurn(battle);
  const reveal = at(run, "Gang-Up revealed", (b) => b.reveal?.name === "Gang-Up");
  const merc = enemyNamed(battle, "Hydra Mercenary")!.id;
  at(run, "Rhino attack", (b) => b.hit?.source === rhinoId(battle), reveal);
  at(run, "Mercenary attack", (b) => b.hit?.source === merc, reveal);
  // Normal activations: Rhino 2 + Mercenary 1; Gang-Up: Rhino 2 + Mercenary 1.
  expect(snap(battle).heroHp).toBe(4);
});

test("01189 Gang-Up (alter-ego): gains surge", () => {
  const battle = scenario({ inPlay: ["01101"], top: ["01104", "01189", "01101"] });
  const run = endTurn(battle);
  expect(revealCount(run)).toBe(2);
  expect(snap(battle).heroHp).toBe(10);
  expect(snap(battle).enemyCards.filter((c) => c.name === "Hydra Mercenary")).toHaveLength(2);
});

test("01106 Stampede: Enhanced Spider-Sense interrupts its reveal and cancels the When Revealed attack", () => {
  // Enhanced Spider-Sense: Interrupt: cancel the When Revealed effects of a treachery. Stampede is still discarded.
  const battle = scenario({ top: ["01104", "01106", "01105"], hand: ["01004", "01090", "01088"] });
  toHero(battle);
  const discardOther: Answer = (choice) => {
    if (choice.discardFromHand) return [choice.options.find((o) => o.label === "Energy")!.id];
    const offer = choice.offers?.find((o) => o.question.includes("Enhanced Spider-Sense"));
    return offer ? [offer.id] : undefined;
  };
  expect(battle.endTurn()).toBe(true);
  const run = drive(battle, discardOther);
  // The accepted interrupt asks for its payment.
  expect(snap(battle).payment).not.toBeNull();
  spendAll(battle, "Strength");
  expect(battle.pay()).toBe(true);
  const rest = drive(battle);
  const all = [...run.beats, ...rest.beats];
  expect(snap(battle).heroHp).toBe(8);
  expect(marker(snap(battle).hero, "stunned")).toBe(0);
  expect(encounterDiscardNames(battle)).toContain("Stampede");
  expect(snap(battle).discard.map((c) => c.name)).toContain("Enhanced Spider-Sense");
  expect(all.filter((b) => b.hit?.source === rhinoId(battle))).toHaveLength(1);
});

// ===============================================================================================================
// More interactions, and presentation gaps found while driving the cards above.
// ===============================================================================================================

test("01094 Rhino II: after Stage I falls he attacks with ATK 3 and Breakin' & Takin's hazard icon adds an encounter card", () => {
  // Rhino (II) ATK 3 (printed); Breakin' & Takin' is revealed by his When Revealed (hazard icon: RRG v1.8 "Hazard Icon").
  const battle = scenario({ villainDamage: 13 });
  toHero(battle);
  expect(battle.heroAction("basicAttack")).toBe(true);
  expect(enemyNamed(battle, "Breakin' & Takin'")).toBeDefined();
  const run = endTurn(battle);
  const boost = run.beats.find((b) => b.reveal?.boost)?.reveal?.boost?.icons ?? 0;
  const hit = at(run, "Rhino II attack", (b) => b.hit?.source === rhinoId(battle) && b.hit.target === heroId(battle));
  expect(run.beats[hit]!.hit!.amount).toBe(3 + boost);
  expect(run.beats.filter((b) => b.text === "Deal an encounter card").length).toBeGreaterThanOrEqual(2);
});

test("01168 Sweeping Swoop (boost): a defending ally damaged by the attack is stunned", () => {
  const battle = scenario({ top: ["01168", "01108"], hand: ["01059", "01090", "01088"] });
  toHero(battle);
  play(battle, "Jessica Jones", "Strength", "Energy");
  const jessica = snap(battle).inPlay.find((c) => c.name === "Jessica Jones")!;
  const run = endTurn(battle, defendWith(jessica.id));
  expect(
    marker(
      snap(battle).inPlay.find((c) => c.id === jessica.id),
      "damage",
    ),
  ).toBe(2);
  expect(
    marker(
      snap(battle).inPlay.find((c) => c.id === jessica.id),
      "stunned",
    ),
  ).toBe(1);
  expect(marker(snap(battle).hero, "stunned")).toBe(0);
  at(run, "Jessica stunned", statusBeat(jessica.id, "stunned", 1));
});

test("01098 Armored Rhino Suit: the damage placed on the suit is shown as a hit or a counter change", () => {
  const battle = scenario({ attached: ["01098"] });
  toHero(battle);
  battle.heroAction("basicAttack");
  const suit = enemyNamed(battle, "Armored Rhino Suit")!;
  expect(
    snap(battle).beats.some(
      (b) => b.hit?.target === suit.id || (b.statusChange?.id === suit.id && b.statusChange.name === "damage"),
    ),
  ).toBe(true);
});

test("01098 Armored Rhino Suit: its discard at 5 damage is shown", () => {
  const battle = scenario({ attached: ["01098"], hand: ["01005", "01090", "01088"] });
  toHero(battle);
  const suit = enemyNamed(battle, "Armored Rhino Suit")!;
  battle.pick(inHand(battle, "Swinging Web Kick").id);
  spendAll(battle, "Strength", "Energy");
  battle.pay();
  const target = snap(battle).choice?.options.find((o) => o.cardId === rhinoId(battle));
  if (target) battle.choose(target.id);
  expect(snap(battle).beats.some((b) => b.leftPlay === suit.id || b.defeatedCard === suit.id)).toBe(true);
});

test("01100 Enhanced Ivory Horn: its discard is shown", () => {
  const battle = scenario({ attached: ["01100"], hand: ["01090", "01003"] });
  toHero(battle);
  const horn = enemyNamed(battle, "Enhanced Ivory Horn")!;
  battle.fieldAction(horn.id, battle.fieldActions(horn.id)[0]!.kind);
  spendAll(battle, "Strength", "Backflip");
  battle.pay();
  expect(snap(battle).beats.some((b) => b.leftPlay === horn.id || b.defeatedCard === horn.id)).toBe(true);
});

test("01099 Charge: its discard at the end of the attack is shown", () => {
  const battle = scenario({ attached: ["01099"], top: ["01104"] });
  toHero(battle);
  const charge = enemyNamed(battle, "Charge")!;
  const run = endTurn(battle);
  expect(run.beats.some((b) => b.leftPlay === charge.id || b.defeatedCard === charge.id)).toBe(true);
});

test("01099 Charge: the defending ally's defeat is shown", () => {
  const battle = scenario({ attached: ["01099"], top: ["01104"], hand: ["01059", "01090", "01088"] });
  toHero(battle);
  play(battle, "Jessica Jones", "Strength", "Energy");
  const jessica = snap(battle).inPlay.find((c) => c.name === "Jessica Jones")!;
  const run = endTurn(battle, defendWith(jessica.id));
  expect(run.beats.some((b) => b.defeatedCard === jessica.id)).toBe(true);
});

test("01166 Highway Robbery: the cards returned when it is defeated are shown entering the hand", () => {
  const battle = scenario({ inPlay: ["01166"], tucked: { "01166": ["01090"] }, threatOf: { "01166": 1 } });
  toHero(battle);
  const before = new Set(snap(battle).hand.map((c) => c.id));
  battle.heroAction("basicThwart");
  const returned = snap(battle).hand.find((c) => !before.has(c.id))!;
  expect(snap(battle).beats.some((b) => b.returned?.includes(returned.id))).toBe(true);
});
