/**
 * Free Play's audit (room plan step 0.4.0): every card of the Expert set, Legions of Hydra and The Doomsday Chair
 * revealed and resolved on the table's model, as a boost too, and each villain's Expert stages (the game starts at
 * stage II and ends when stage III falls). Each test checks what the table shows: the beats the player watches, the
 * prompts and their labels, the targets offered. In the manner of `deck-audit-encounter.test.ts`, with the deal's
 * difficulty and modules chosen as Free Play's tray chooses them.
 *
 * Rules answered by the rules-expert agent (2026-11-25):
 * - Expert opens at stage II and resolves its When Revealed in setup (RRG v1.8 Appendix II step 12c; When Revealed
 *   Abilities p. 48): Rhino's Breakin' & Takin' and Klaw's The "Immortal" Klaw are in play from the start.
 * - Madame Hydra can't be the target of a basic attack while Legions of Hydra is in play (RRG v1.8 Target p. 42; FFG
 *   ruling 2026-03-19 #2).
 * - Masterplan's "discard until a side scheme" stops when the encounter deck runs out (RRG v1.8 Encounter Deck p. 17).
 */
import { expect, test, vi } from "vitest";
import * as engine from "@mc/engine";
import {
  BattleModel,
  EITHER_OTHERWISE,
  EITHER_SPEND,
  type BattleBeat,
  type BattleChoice,
  type DealOptions,
} from "./model.js";
import { watchThisFile } from "./shown-check.js";

// Watched for anything happening unseen (`shown-check.ts`).
watchThisFile({ gate: true });

type State = engine.GameState;
type Id = engine.InstanceId;

const codeOf = (state: State, id: string) => state.instances[id as Id]?.cardId;

/** Take one copy of `code` from wherever the deal left it. */
function take(state: State, code: string, used: Set<string>): Id {
  const piles = engine.activeEncounterDeck(state);
  const p = state.players[0]!;
  const pools = [piles.deck, piles.discard, state.encounterSetAside, state.villainArea, p.setAside, p.deck, p.hand];
  for (const pool of pools) {
    const id = pool.find((i) => codeOf(state, i) === code && !used.has(i));
    if (id) {
      used.add(id);
      return id;
    }
  }
  throw new Error(`setup: no spare copy of ${code}`);
}

interface Setup {
  /** The game Free Play deals: Rhino, Standard, his recommended module unless given. */
  deal?: Pick<DealOptions, "villain" | "difficulty" | "modules">;
  /** Encounter cards on top of the deck, top first: the villain's boost card comes before the dealt card. */
  top?: string[];
  /** Encounter cards in the discard pile. */
  discard?: string[];
  /** Replace the whole hand with exactly these cards. */
  hand?: string[];
  /** Cards already in play: minions engaged with the hero, side schemes, the player's allies (face up). */
  inPlay?: string[];
  /** Encounter cards attached to a minion in play, by the minion's code. */
  attached?: Record<string, string[]>;
  /** Threat on a card in play, by code ("main" is the main scheme). */
  threatOf?: Record<string, number>;
  /** Damage on a card in play, by code ("villain", "hero"). */
  damageOf?: Record<string, number>;
  /** Encounter cards the deal put in play that go to the discard pile instead (Expert Rhino's Breakin' & Takin'). */
  clear?: string[];
  /** The villain's stage, counted from 0 (2 is stage III). */
  stage?: number;
}

function arrange(state: State, s: Setup): State {
  const used = new Set<string>();
  const cleared = (s.clear ?? []).map((c) => take(state, c, used));
  const top = (s.top ?? []).map((c) => take(state, c, used));
  const discard = (s.discard ?? []).map((c) => take(state, c, used));
  const hand = s.hand ? s.hand.map((c) => take(state, c, used)) : null;
  const inPlay = (s.inPlay ?? []).map((c) => [c, take(state, c, used)] as const);
  const attached = Object.entries(s.attached ?? {}).map(
    ([host, codes]) => [host, codes.map((c) => take(state, c, used))] as const,
  );
  const gone = new Set<string>(used);
  const strip = (list: readonly Id[]) => list.filter((i) => !gone.has(i));
  const player = state.players[0]!;
  const instances = { ...state.instances };
  const isEncounter = (id: Id) => !!engine.cardOf(state, id) && !player.deck.includes(id) && !player.hand.includes(id);
  const typeOf = (id: Id) => engine.cardOf(state, id)?.type;
  const idOf = (code: string): Id =>
    code === "villain"
      ? state.villains[0]!.instanceId
      : code === "hero"
        ? player.identity.instanceId
        : code === "main"
          ? state.mainScheme.instanceId
          : (inPlay.find(([c]) => c === code)?.[1] ??
            (state.villainArea.find((i) => codeOf(state, i) === code) as Id) ??
            (player.playArea.find((i) => codeOf(state, i) === code) as Id));
  for (const [, id] of inPlay)
    instances[id] = {
      ...instances[id]!,
      faceup: true,
      engagedWith: typeOf(id) === "minion" ? player.playerId : null,
    };
  for (const [host, ids] of attached) {
    const hostId = idOf(host);
    instances[hostId] = { ...instances[hostId]!, attachments: [...instances[hostId]!.attachments, ...ids] };
    for (const id of ids) instances[id] = { ...instances[id]!, faceup: true, attachedTo: hostId };
  }
  for (const [code, threat] of Object.entries(s.threatOf ?? {}))
    instances[idOf(code)] = { ...instances[idOf(code)]!, threat };
  for (const [code, damage] of Object.entries(s.damageOf ?? {}))
    instances[idOf(code)] = { ...instances[idOf(code)]!, damage };
  const key = engine.activeEncounterDeckId(state);
  const piles = engine.activeEncounterDeck(state);
  const schemes = inPlay.map(([, id]) => id).filter((id) => typeOf(id) === "side_scheme");
  const minions = inPlay.map(([, id]) => id).filter((id) => typeOf(id) === "minion");
  const allies = inPlay.map(([, id]) => id).filter((id) => !schemes.includes(id) && !minions.includes(id));
  return {
    ...state,
    instances,
    villains:
      s.stage === undefined
        ? state.villains
        : [{ ...state.villains[0]!, stageIndex: s.stage }, ...state.villains.slice(1)],
    players: [
      {
        ...player,
        hand: hand ?? strip(player.hand),
        deck: [...strip(player.deck), ...(hand ? strip(player.hand) : [])],
        playArea: [...strip(player.playArea), ...minions, ...allies.filter((id) => !isEncounter(id) || true)],
        setAside: strip(player.setAside),
      },
    ],
    villainArea: [...strip(state.villainArea), ...schemes],
    encounterSetAside: strip(state.encounterSetAside),
    encounterDecks: {
      ...state.encounterDecks,
      [key]: {
        ...piles,
        deck: [...top, ...strip(piles.deck)],
        discard: [...discard, ...cleared, ...strip(piles.discard)],
      },
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
    battle.reset({ villain: "rhino", ...s.deal });
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
 * Answer whatever the table asks, the way main.ts does, collecting every beat the player would watch. Defaults:
 * trigger offers declined, a defense declined, anything else the first `min` options.
 */
function drive(battle: BattleModel, answer: Answer = () => undefined, run: Run = { beats: [], prompts: [] }): Run {
  run.beats.push(...battle.snapshot().beats);
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

const snap = (b: BattleModel) => b.snapshot();
const heroId = (b: BattleModel) => snap(b).hero.id;
const villainId = (b: BattleModel) => snap(b).villain.id;
const enemyNamed = (b: BattleModel, name: string) => snap(b).enemyCards.find((c) => c.name === name);
const enemiesNamed = (b: BattleModel, name: string) => snap(b).enemyCards.filter((c) => c.name === name);
const marker = (c: { markers: { name: string; count: number }[] } | undefined, name: string) =>
  c?.markers.find((m) => m.name === name)?.count ?? 0;
const toHero = (b: BattleModel) => expect(b.heroAction("changeForm")).toBe(true);
const reveals = (r: Run) => r.beats.filter((b) => b.reveal && !b.reveal.boost).map((b) => b.reveal!.name);
/** Index of the first beat matching `pred`, asserted to exist so "after" comparisons can't pass on -1. */
function at(r: Run, label: string, pred: (b: BattleBeat) => boolean, from = 0): number {
  const i = r.beats.findIndex((b, n) => n >= from && pred(b));
  expect(i, `beat missing: ${label}`).toBeGreaterThanOrEqual(0);
  return i;
}
/** Spider-Man's basic attack at `target` (a card id), through the target pick the table shows. */
function attack(b: BattleModel, target: string) {
  expect(b.heroAction("basicAttack")).toBe(true);
  const choice = snap(b).choice;
  if (choice) {
    const option = choice.options.find((o) => o.cardId === target);
    expect(option, `attack target offered: ${JSON.stringify(choice.options)}`).toBeDefined();
    expect(b.choose(option!.id)).toBe(true);
  }
  return drive(b);
}
/**
 * The targets the basic attack offers: the pick's options, or, when only one target is left (the table aims at it
 * without asking), the one it hit.
 */
function attackTargets(b: BattleModel): string[] {
  const before = snap(b).beats;
  expect(b.heroAction("basicAttack")).toBe(true);
  const choice = snap(b).choice;
  if (choice) {
    const options = choice.options.map((o) => o.cardId ?? "");
    b.cancel();
    return options;
  }
  const after = snap(b).beats;
  return after === before
    ? []
    : after.flatMap((beat) => (beat.attackAim ? [beat.attackAim.target] : beat.hit ? [beat.hit.target] : []));
}

const EXPERT = { difficulty: "expert" } as const;
/** Expert Rhino without Breakin' & Takin' (its hazard icon would deal a second encounter card each villain phase). */
const expertRhino = (s: Setup = {}) => scenario({ deal: EXPERT, clear: ["01107"], ...s });
const HYDRA = { modules: ["legions_of_hydra"] } as const;
const CHAIR = { modules: ["the_doomsday_chair"] } as const;
/** An encounter card that does nothing much when revealed: Rhino gains a tough status (no surge unless already tough). */
const QUIET = "01105";

// ===============================================================================================================
// The Expert set: Exhaustion, Masterplan, Under Fire
// ===============================================================================================================

test("01191 Exhaustion (hero form): exhausts Spider-Man, the table shows it, and it surges into another card", () => {
  const battle = expertRhino({ top: [QUIET, "01191", QUIET] });
  toHero(battle);
  const run = endTurn(battle);
  expect(reveals(run).slice(0, 2)).toEqual(["Exhaustion", '"I\'m Tough!"']);
  const turned = at(run, "Spider-Man exhausted", (b) => b.turned?.id === heroId(battle) && b.turned.exhausted);
  at(run, "surge after Exhaustion", (b) => !!b.surge, turned);
  expect(snap(battle).hero.exhausted).toBe(true);
  // Exhausted into the next turn: no basic powers until he readies.
  expect(snap(battle).heroActions.some((a) => a.kind === "basicAttack")).toBe(false);
});

test("01191 Exhaustion (alter-ego): exhausts Peter Parker, and still surges", () => {
  const battle = expertRhino({ top: [QUIET, "01191", QUIET] });
  const run = endTurn(battle);
  at(run, "Peter Parker exhausted", (b) => b.turned?.id === heroId(battle) && b.turned.exhausted);
  expect(reveals(run).slice(0, 2)).toEqual(["Exhaustion", '"I\'m Tough!"']);
  expect(snap(battle).hero.exhausted).toBe(true);
  expect(snap(battle).heroActions.some((a) => a.kind === "basicRecover")).toBe(false);
});

test("01192 Masterplan: places 4 threat on each side scheme in play, each shown on its scheme", () => {
  const battle = scenario({ deal: EXPERT, top: [QUIET, "01192", QUIET], inPlay: ["01108"], threatOf: { "01108": 2 } });
  const before = Object.fromEntries(enemiesNamed(battle, "Crowd Control").map((c) => [c.id, c.threat]));
  const schemes = snap(battle)
    .enemyCards.filter((c) => c.type === "side_scheme")
    .map((c) => c.id);
  expect(schemes).toHaveLength(2);
  const run = endTurn(battle);
  for (const scheme of schemes)
    at(run, `4 threat on ${scheme}`, (b) => b.threat?.scheme === scheme && b.threat.delta === 4);
  const crowd = enemyNamed(battle, "Crowd Control")!;
  expect(crowd.threat).toBe(before[crowd.id]! + 4);
});

test("01192 Masterplan: with no side scheme in play it discards until one, shows the discards, and reveals it", () => {
  // Rhino's own set and Bomb Scare hold side schemes: Crowd Control comes after two cards that aren't.
  const battle = expertRhino({ top: [QUIET, "01192", "01104", "01106", "01108", QUIET] });
  expect(snap(battle).enemyCards.some((c) => c.type === "side_scheme")).toBe(false);
  const run = endTurn(battle);
  const masterplan = at(run, "Masterplan revealed", (b) => b.reveal?.name === "Masterplan" && !b.reveal.boost);
  const crowd = at(run, "Crowd Control revealed", (b) => b.reveal?.name === "Crowd Control", masterplan);
  // The cards it went through, the side scheme last, land in the encounter discard pile, and the table says so (with
  // the card that did it) before the side scheme is revealed from there.
  const discards = run.beats.slice(masterplan, crowd).filter((b) => b.encounterMilled?.length);
  expect(discards).toHaveLength(1);
  expect(discards[0]!.encounterMilled).toHaveLength(3);
  expect(discards[0]!.text).toBe(
    "Masterplan: discard the top 3 cards of the encounter deck (Hard to Keep Down, Stampede, Crowd Control)",
  );
  expect(enemyNamed(battle, "Crowd Control")).toBeDefined();
  const pile = snap(battle).encounterDiscard.map((c) => c.name);
  expect(pile).toEqual(expect.arrayContaining(["Hard to Keep Down", "Stampede"]));
});

test("01193 Under Fire: reveals the top card of the encounter deck, then surges into another", () => {
  const battle = expertRhino({ top: [QUIET, "01193", QUIET, "01108"] });
  const run = endTurn(battle);
  const revealed = reveals(run);
  expect(revealed.slice(0, 3)).toEqual(["Under Fire", '"I\'m Tough!"', "Crowd Control"]);
  at(run, "surge for Under Fire", (b) => !!b.surge);
});

// ===============================================================================================================
// Legions of Hydra
// ===============================================================================================================

test("01180 Legions of Hydra: brings Madame Hydra in engaged from the encounter deck and places 2 threat per Hydra enemy", () => {
  const battle = scenario({ deal: HYDRA, top: [QUIET, "01180"] });
  const run = endTurn(battle);
  at(run, "Legions of Hydra revealed", (b) => b.reveal?.name === "Legions of Hydra");
  const madame = enemyNamed(battle, "Madame Hydra");
  expect(madame?.type).toBe("minion");
  at(run, "Madame Hydra enters play", (b) => b.entersPlay === madame!.id || b.reveal?.name === "Madame Hydra");
  // 3 (printed) + 2 for Madame Hydra, the one Hydra enemy.
  expect(enemyNamed(battle, "Legions of Hydra")!.threat).toBe(5);
});

test("01180 Legions of Hydra: finds Madame Hydra in the encounter discard pile too", () => {
  const battle = scenario({ deal: HYDRA, top: [QUIET, "01180"], discard: ["01181"] });
  expect(snap(battle).encounterDiscard.some((c) => c.name === "Madame Hydra")).toBe(true);
  const run = endTurn(battle);
  const madame = enemyNamed(battle, "Madame Hydra");
  expect(madame).toBeDefined();
  expect(snap(battle).encounterDiscard.some((c) => c.name === "Madame Hydra")).toBe(false);
  at(run, "Madame Hydra enters play", (b) => b.entersPlay === madame!.id || b.reveal?.name === "Madame Hydra");
});

test("01180 Legions of Hydra: with Madame Hydra already in play no search, and her Hydra Soldier counts too", () => {
  const battle = scenario({ deal: HYDRA, top: [QUIET, "01180"], inPlay: ["01181", "01182"] });
  endTurn(battle);
  expect(enemiesNamed(battle, "Madame Hydra")).toHaveLength(1);
  // 3 + 2 × (Madame Hydra, Hydra Soldier).
  expect(enemyNamed(battle, "Legions of Hydra")!.threat).toBe(7);
});

test("01181 Madame Hydra: while Legions of Hydra is in play she is not offered as a basic attack's target", () => {
  const battle = scenario({ deal: HYDRA, inPlay: ["01180", "01181"], threatOf: { "01180": 3 } });
  toHero(battle);
  const madame = enemyNamed(battle, "Madame Hydra")!;
  expect(attackTargets(battle)).not.toContain(madame.id);
});

test("01181 Madame Hydra: once Legions of Hydra is gone she can be attacked and takes the damage", () => {
  const battle = scenario({ deal: HYDRA, inPlay: ["01181"] });
  toHero(battle);
  const madame = enemyNamed(battle, "Madame Hydra")!;
  const run = attack(battle, madame.id);
  at(run, "hit on Madame Hydra", (b) => b.hit?.target === madame.id && b.hit.amount === 2);
  expect(marker(enemyNamed(battle, "Madame Hydra"), "damage")).toBe(2);
});

test("01181 Madame Hydra: after she attacks, 2 threat goes on Legions of Hydra, shown after her hit", () => {
  const battle = scenario({
    deal: HYDRA,
    inPlay: ["01180", "01181"],
    threatOf: { "01180": 3 },
    top: [QUIET, QUIET],
  });
  toHero(battle);
  const madame = enemyNamed(battle, "Madame Hydra")!;
  const legions = enemyNamed(battle, "Legions of Hydra")!;
  const run = endTurn(battle);
  const hit = at(run, "Madame Hydra's attack", (b) => b.hit?.source === madame.id && b.hit.target === heroId(battle));
  at(run, "2 threat on Legions of Hydra", (b) => b.threat?.scheme === legions.id && b.threat.delta === 2, hit);
  expect(enemyNamed(battle, "Legions of Hydra")!.threat).toBe(5);
});

test("01181 Madame Hydra: after she schemes (alter-ego), 2 threat goes on Legions of Hydra", () => {
  const battle = scenario({
    deal: HYDRA,
    inPlay: ["01180", "01181"],
    threatOf: { "01180": 3 },
    top: [QUIET, QUIET],
  });
  const legions = enemyNamed(battle, "Legions of Hydra")!;
  const run = endTurn(battle);
  at(run, "2 threat on Legions of Hydra", (b) => b.threat?.scheme === legions.id && b.threat.delta === 2);
});

test("01182 Hydra Soldier: guard keeps Rhino off the basic attack's targets", () => {
  const battle = scenario({ deal: HYDRA, inPlay: ["01182"] });
  toHero(battle);
  const targets = attackTargets(battle);
  expect(targets).not.toContain(villainId(battle));
  expect(targets).toContain(enemyNamed(battle, "Hydra Soldier")!.id);
});

test("01182 Hydra Soldier: When Defeated deals an encounter card in the hero phase, shown facedown, revealed in the villain phase", () => {
  const battle = scenario({ deal: HYDRA, inPlay: ["01182"], damageOf: { "01182": 2 }, top: ["01108", QUIET, QUIET] });
  toHero(battle);
  const soldier = enemyNamed(battle, "Hydra Soldier")!;
  const run = attack(battle, soldier.id);
  const defeated = at(run, "Hydra Soldier defeated", (b) => b.defeatedCard === soldier.id || b.defeat === soldier.id);
  at(run, "an encounter card dealt", (b) => !!b.encounterDeal, defeated);
  expect(snap(battle).facedownEncounters).toHaveLength(1);
  const villainPhase = endTurn(battle);
  expect(reveals(villainPhase)).toContain("Crowd Control");
});

// ===============================================================================================================
// The Doomsday Chair
// ===============================================================================================================

test("01183 The Doomsday Chair: enters with 8 threat and brings M.O.D.O.K. in engaged", () => {
  const battle = scenario({ deal: CHAIR, top: [QUIET, "01183"] });
  const run = endTurn(battle);
  at(run, "The Doomsday Chair revealed", (b) => b.reveal?.name === "The Doomsday Chair");
  const modok = enemyNamed(battle, "M.O.D.O.K.");
  expect(modok?.type).toBe("minion");
  at(run, "M.O.D.O.K. enters play", (b) => b.entersPlay === modok!.id || b.reveal?.name === "M.O.D.O.K.");
  expect(enemyNamed(battle, "The Doomsday Chair")!.threat).toBe(8);
});

test("01183 The Doomsday Chair: finds M.O.D.O.K. in the discard pile, and not again once he is in play", () => {
  const battle = scenario({ deal: CHAIR, top: [QUIET, "01183"], discard: ["01184"] });
  endTurn(battle);
  expect(enemiesNamed(battle, "M.O.D.O.K.")).toHaveLength(1);
  expect(snap(battle).encounterDiscard.some((c) => c.name === "M.O.D.O.K.")).toBe(false);
});

test("01184 M.O.D.O.K.: Retaliate 2 hits Spider-Man after his attack, shown as a hit from M.O.D.O.K.", () => {
  const battle = scenario({ deal: CHAIR, inPlay: ["01184"] });
  toHero(battle);
  const modok = enemyNamed(battle, "M.O.D.O.K.")!;
  const run = attack(battle, modok.id);
  const hit = at(run, "Spider-Man hits M.O.D.O.K.", (b) => b.hit?.target === modok.id);
  at(run, "Retaliate", (b) => b.hit?.source === modok.id && b.hit.target === heroId(battle) && b.hit.amount === 2, hit);
  expect(snap(battle).heroHp).toBe(8);
});

test("01184 M.O.D.O.K.: Retaliate 2 hits an ally that attacks him", () => {
  const battle = scenario({ deal: CHAIR, inPlay: ["01184", "01059"] });
  const modok = enemyNamed(battle, "M.O.D.O.K.")!;
  const jessica = snap(battle).inPlay.find((c) => c.name === "Jessica Jones")!;
  const attackAction = battle.fieldActions(jessica.id).find((a) => /attack/i.test(a.label));
  expect(attackAction, JSON.stringify(battle.fieldActions(jessica.id))).toBeDefined();
  expect(battle.fieldAction(jessica.id, attackAction!.kind)).toBe(true);
  const choice = snap(battle).choice;
  if (choice) expect(battle.choose(choice.options.find((o) => o.cardId === modok.id)!.id)).toBe(true);
  const run = drive(battle);
  at(run, "Retaliate on Jessica Jones", (b) => b.hit?.source === modok.id && b.hit.target === jessica.id);
  // 3 HP: 1 from her consequential damage, 2 from Retaliate.
  expect(run.beats.some((b) => b.defeatedCard === jessica.id)).toBe(true);
});

test("01185 Biomechanical Upgrades: attaches to the minion with the highest printed hit points, and surges", () => {
  const battle = scenario({ deal: CHAIR, inPlay: ["01184", "01101"], top: [QUIET, "01185", QUIET] });
  const modok = enemyNamed(battle, "M.O.D.O.K.")!;
  const run = endTurn(battle);
  const upgrade = enemyNamed(battle, "Biomechanical Upgrades");
  expect(upgrade?.attachedTo).toBe(modok.id);
  at(run, "surge", (b) => !!b.surge);
  expect(reveals(run)).toContain('"I\'m Tough!"');
});

test("01185 Biomechanical Upgrades: with no minion in play it has nothing to attach to, goes to the discard pile, and still surges", () => {
  const battle = scenario({ deal: CHAIR, top: [QUIET, "01185", QUIET] });
  const run = endTurn(battle);
  expect(enemyNamed(battle, "Biomechanical Upgrades")).toBeUndefined();
  expect(snap(battle).encounterDiscard.some((c) => c.name === "Biomechanical Upgrades")).toBe(true);
  at(run, "surge", (b) => !!b.surge);
});

test("01185 Biomechanical Upgrades: two minions tied on printed hit points, the player picks, and the prompt says why", () => {
  const battle = scenario({ deal: CHAIR, inPlay: ["01101", "01101"], top: [QUIET, "01185", QUIET] });
  const mercenaries = enemiesNamed(battle, "Hydra Mercenary").map((c) => c.id);
  const run = endTurn(battle);
  // Not the minions' activation order: the host pick, which names the card and gives its rule.
  const asked = run.prompts.find(
    (p) => p.options.some((o) => mercenaries.includes(o.cardId ?? "")) && !/activate/i.test(p.prompt),
  );
  expect(asked?.prompt).toBe("Choose a minion to attach it to");
  expect(asked?.sourceTitle).toBe("Biomechanical Upgrades");
  expect(asked?.explanation).toBe(
    "Attach to the minion with the highest printed hit points and without another Biomechanical Upgrades attached.",
  );
  const upgrade = enemyNamed(battle, "Biomechanical Upgrades");
  expect(mercenaries).toContain(upgrade?.attachedTo);
});

test("01185 Biomechanical Upgrades: when its minion would be defeated it heals instead and the upgrade is discarded", () => {
  const battle = scenario({
    deal: CHAIR,
    inPlay: ["01184"],
    attached: { "01184": ["01185"] },
    damageOf: { "01184": 7 },
  });
  toHero(battle);
  const modok = enemyNamed(battle, "M.O.D.O.K.")!;
  const upgrade = enemyNamed(battle, "Biomechanical Upgrades")!;
  const run = attack(battle, modok.id);
  expect(run.beats.some((b) => b.defeatedCard === modok.id)).toBe(false);
  at(run, "upgrade discarded", (b) => b.leftPlay === upgrade.id || b.defeatedCard === upgrade.id);
  expect(marker(enemyNamed(battle, "M.O.D.O.K."), "damage")).toBe(0);
  expect(enemyNamed(battle, "Biomechanical Upgrades")).toBeUndefined();
});

// ===============================================================================================================
// Each of the nine as a boost card
// ===============================================================================================================

const BOOSTS = [
  { code: "01191", name: "Exhaustion", icons: 2, deal: EXPERT },
  { code: "01192", name: "Masterplan", icons: 2, deal: EXPERT },
  { code: "01193", name: "Under Fire", icons: 3, deal: EXPERT },
  { code: "01180", name: "Legions of Hydra", icons: 3, deal: HYDRA },
  { code: "01181", name: "Madame Hydra", icons: 2, deal: HYDRA },
  { code: "01182", name: "Hydra Soldier", icons: 1, deal: HYDRA },
  { code: "01183", name: "The Doomsday Chair", icons: 3, deal: CHAIR },
  { code: "01184", name: "M.O.D.O.K.", icons: 2, deal: CHAIR },
  { code: "01185", name: "Biomechanical Upgrades", icons: 1, deal: CHAIR },
] as const;

test.each(BOOSTS)(
  "$code $name as a boost card: its $icons boost icons add to Rhino's attack, and nothing else of it happens",
  (card) => {
    const expert = card.deal === EXPERT;
    const battle = scenario({ deal: card.deal, clear: expert ? ["01107"] : [], top: [card.code, QUIET] });
    toHero(battle);
    const before = snap(battle).enemyCards.length;
    const run = endTurn(battle);
    const boost = at(run, "boost card turned up", (b) => b.reveal?.name === card.name && !!b.reveal.boost);
    expect(run.beats[boost]!.reveal!.boost!.icons).toBe(card.icons);
    // Rhino I has ATK 2, Rhino II (Expert's first stage) ATK 3.
    at(
      run,
      "Rhino's boosted hit",
      (b) => b.hit?.source === villainId(battle) && b.hit.amount === (expert ? 3 : 2) + card.icons,
    );
    // A boost card's When Revealed doesn't happen: no Madame Hydra, M.O.D.O.K. or side scheme comes in with it.
    expect(snap(battle).enemyCards.filter((c) => c.name === card.name)).toHaveLength(0);
    expect(snap(battle).enemyCards.length).toBeLessThanOrEqual(before + 1);
  },
);

// ===============================================================================================================
// The Expert stages
// ===============================================================================================================

const VILLAIN_CARDS = { rhino: "01094", klaw: "01113", ultron: "01134" } as const;
const art = (code: string, stage: number) =>
  `/card-art/bundles/cards/${(Number(code) + stage - 1).toString().padStart(5, "0")}.png`;

test.each(["rhino", "klaw", "ultron"] as const)(
  "%s on Expert: the game opens on stage II, and the matchup's opening is told",
  (villain) => {
    const battle = new BattleModel();
    battle.reset({ villain, difficulty: "expert", seed: 41, mulligan: true });
    expect(snap(battle).villain.art).toBe(art(VILLAIN_CARDS[villain], 2));
    expect(battle.encounter.difficulty).toBe("expert");
    const notes = battle.setupNotes.join(" | ");
    if (villain === "rhino") expect(notes).toMatch(/Breakin' & Takin' comes into play/);
    if (villain === "klaw") expect(notes).toMatch(/The "Immortal" Klaw comes into play/);
  },
);

test("Rhino on Expert: defeating stage II brings in stage III, shown as a stage beat, with his toughness and the stun on Spider-Man", () => {
  const battle = expertRhino({ damageOf: { villain: 14 } });
  toHero(battle);
  const run = attack(battle, villainId(battle));
  at(run, "Rhino III", (b) => b.villainStage === 3);
  expect(snap(battle).villain.art).toBe(art("01094", 3));
  expect(marker(snap(battle).villain, "tough")).toBe(1);
  expect(marker(snap(battle).hero, "stunned")).toBe(1);
  expect(snap(battle).outcome).toBeFalsy();
});

test("Klaw on Expert: defeating stage II brings in stage III, shown as a stage beat, with his toughness", () => {
  const battle = scenario({ deal: { villain: "klaw", ...EXPERT } });
  const hp = snap(battle).villainHp;
  const patched = scenario({ deal: { villain: "klaw", ...EXPERT }, damageOf: { villain: hp - 1 } });
  toHero(patched);
  const run = attack(patched, villainId(patched));
  at(run, "Klaw III", (b) => b.villainStage === 3);
  expect(snap(patched).villain.art).toBe(art("01113", 3));
  expect(marker(snap(patched).villain, "tough")).toBe(1);
});

test("Ultron on Expert: defeating stage II brings in stage III, and his When Revealed brings Ultron's Imperative", () => {
  const battle = scenario({ deal: { villain: "ultron", ...EXPERT } });
  const hp = snap(battle).villainHp;
  const patched = scenario({ deal: { villain: "ultron", ...EXPERT }, damageOf: { villain: hp - 1 } });
  toHero(patched);
  // The setup Drone guards nothing (Drones have no guard), so Spider-Man can attack Ultron.
  const run = attack(patched, villainId(patched));
  at(run, "Ultron III", (b) => b.villainStage === 3);
  expect(snap(patched).villain.art).toBe(art("01134", 3));
  expect(enemyNamed(patched, "Ultron's Imperative")).toBeDefined();
});

test.each(["rhino", "klaw"] as const)("%s on Expert: defeating stage III wins the game", (villain) => {
  const deal = { villain, ...EXPERT };
  const clear = villain === "rhino" ? ["01107"] : [];
  const hp = (() => {
    const battle = scenario({ deal, clear, stage: 2 });
    return snap(battle).villainHp;
  })();
  const battle = scenario({ deal, clear, stage: 2, damageOf: { villain: hp - 1 } });
  toHero(battle);
  const run = attack(battle, villainId(battle));
  expect(run.beats.some((b) => b.gameEnded)).toBe(true);
  expect(snap(battle).outcome?.result ?? snap(battle).outcome).toBeTruthy();
});

test("Ultron on Expert: stage III can't be hurt while a Drone is in play, and the table doesn't offer him as a target", () => {
  const battle = scenario({ deal: { villain: "ultron", ...EXPERT }, stage: 2 });
  toHero(battle);
  expect(snap(battle).enemyCards.some((c) => c.name === "Drone")).toBe(true);
  expect(attackTargets(battle)).not.toContain(villainId(battle));
});

// ===============================================================================================================
// Found playing Free Play (2026-11-25)
// ===============================================================================================================

test("01123 Sonic Boom: Spend takes only picks that pay it; picks that don't would exhaust everyone with the cards kept", () => {
  const battle = scenario({
    deal: { villain: "klaw" },
    hand: ["01088", "01089", "01090"],
    top: ["01124", "01122", "01123"],
  });
  // Spider-Man, so Klaw attacks (with his two boost cards) instead of scheming his main scheme over.
  toHero(battle);
  expect(battle.endTurn()).toBe(true);
  // Sonic Boom's either-or, asked in two steps (`BattleChoice.eitherOr`): its two halves first.
  const sonicBoom = (choice: BattleChoice) => choice.eitherOr === "choose";
  // Answer everything else the usual way until Sonic Boom asks.
  for (let i = 0; i < 20 && snap(battle).choice && !sonicBoom(snap(battle).choice!); i++) {
    const choice = snap(battle).choice!;
    const picks = choice.offers?.length
      ? []
      : choice.defense
        ? choice.options.filter((o) => !o.cardId).map((o) => o.id)
        : choice.options.slice(0, choice.min).map((o) => o.id);
    expect(battle.chooseMany(picks)).toBe(true);
  }
  expect(snap(battle).choice!.options.map((o) => o.label)).toEqual([
    "Spend 1 energy, 1 mental, 1 physical",
    "Exhaust each character you control",
  ]);
  expect(battle.choose(EITHER_SPEND)).toBe(true);
  const choice = snap(battle).choice!;
  expect(choice).toMatchObject({ eitherOr: "spend", prompt: "Spend 1 energy, 1 mental, 1 physical" });
  // One card can't pay three types: refused, and the question stays (the engine would take it as not spending and
  // exhaust everyone with the card kept).
  const one = [choice.options[0]!.id];
  expect(battle.spendPays(one)).toBe(false);
  expect(battle.chooseMany(one)).toBe(false);
  expect(snap(battle).choice?.id).toBe(choice.id);
  // Back to the two halves; the other one is the "or", taken as it says.
  battle.cancel();
  expect(snap(battle).choice?.eitherOr).toBe("choose");
  expect(battle.choose(EITHER_OTHERWISE)).toBe(true);
  expect(snap(battle).hero.exhausted).toBe(true);
});

test("an ally's own damage for attacking is taken, not dealt to itself: 'Jessica Jones takes 1 damage'", () => {
  const battle = scenario({ inPlay: ["01059"] });
  const jessica = snap(battle).inPlay.find((c) => c.name === "Jessica Jones")!;
  const attack = battle.fieldActions(jessica.id).find((a) => /attack/i.test(a.label))!;
  expect(battle.fieldAction(jessica.id, attack.kind)).toBe(true);
  const run = drive(battle);
  const texts = run.beats.map((b) => b.text);
  expect(texts).toContain("Jessica Jones takes 1 damage");
  expect(texts.some((t) => /Jessica Jones deals \d+ damage to Jessica Jones/.test(t))).toBe(false);
});

test("01006 Aunt May: her action says what it does, not only its exhaust cost", () => {
  const battle = scenario({ inPlay: ["01006"] });
  const may = snap(battle).inPlay.find((c) => c.name === "Aunt May")!;
  expect(battle.fieldActions(may.id).map((a) => a.label)).toEqual(["Heal 4 damage from Peter Parker"]);
});
