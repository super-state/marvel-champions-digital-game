import { CORE_DEPS, coreScenario } from "@mc/cards";
import { createGame, type GameEvent, type GameState, type InstanceId } from "@mc/engine";
import { describe, expect, test } from "vitest";
import { BattleModel } from "../model.js";
import { CORE_MODULES, deckOf, factsOf, heroOf, modulesOf } from "./facts.js";
import { readFacts } from "./game.js";

function deal(villain = "rhino", options: { difficulty?: "expert"; modularSetIds?: string[] } = {}): GameState {
  const created = createGame(
    coreScenario(villain, {
      seed: 75,
      players: [{ starterDeckId: "core-spider-man-justice" }],
      ...(options.difficulty ? { difficulty: options.difficulty } : {}),
      ...(options.modularSetIds ? { modularSetIds: options.modularSetIds } : {}),
    } as Parameters<typeof coreScenario>[1]),
    CORE_DEPS,
  );
  if (!created.ok) throw Error(created.error.message);
  return created.state;
}

const instanceOf = (state: GameState, name: string) =>
  Object.values(state.instances).find((i) => state.cardPool[i.cardId]?.name === name)!.instanceId as InstanceId;

describe("the facts of a finished game", () => {
  test("the Core Set's five modules", () => {
    expect([...CORE_MODULES].sort()).toEqual(
      ["bomb_scare", "legions_of_hydra", "masters_of_evil", "the_doomsday_chair", "under_attack"].sort(),
    );
  });

  test("Spider-Man's starter deck: 40 cards, Justice, the starter by its id", () => {
    const state = deal();
    expect(heroOf(state)).toEqual({ id: "01001a", name: "Spider-Man" });
    const deck = deckOf(state);
    expect(deck).toMatchObject({ size: 40, aspects: ["justice"], starterDeck: "core-spider-man-justice" });
  });

  test("the module and difficulty dealt", () => {
    expect(modulesOf(deal("rhino"))).toEqual(["bomb_scare"]);
    expect(modulesOf(deal("klaw", { modularSetIds: ["legions_of_hydra"] }))).toEqual(["legions_of_hydra"]);
    expect(factsOf(deal("rhino"), [], false).difficulty).toBe("standard");
    expect(factsOf(deal("rhino", { difficulty: "expert" }), [], false).difficulty).toBe("expert");
  });

  test("a win: the card that dealt the villain its last damage, allies played, hit points and form", () => {
    const state = deal();
    const rhino = instanceOf(state, "Rhino");
    const spidey = state.players[0]!.identity.instanceId;
    const blackCat = Object.values(state.instances).find((i) => state.cardPool[i.cardId]?.name === "Black Cat")!;
    const events = [
      {
        type: "cardPlayed",
        playerId: state.players[0]!.playerId,
        instanceId: blackCat.instanceId,
        cardId: blackCat.cardId,
      },
      { type: "damageDealt", targetInstanceId: rhino, amount: 2, sourceInstanceId: blackCat.instanceId },
      { type: "damageDealt", targetInstanceId: rhino, amount: 3, sourceInstanceId: spidey },
      { type: "damageDealt", targetInstanceId: spidey, amount: 1, sourceInstanceId: rhino },
    ] as unknown as GameEvent[];
    const won = { ...state, outcome: { result: "win", reason: "villainDefeated" } } as GameState;
    const facts = factsOf(won, events, true);
    expect(facts).toMatchObject({
      heroId: "01001a",
      alliesPlayed: 1,
      undo: true,
      lastBlow: { cardId: "01001a", name: "Spider-Man" },
      heroHp: 10,
      form: "alterEgo",
      modules: ["bomb_scare"],
      deckSize: 40,
      starterDeck: "core-spider-man-justice",
    });
    // What the page sends is what the site reads back.
    expect(readFacts(JSON.parse(JSON.stringify(facts)))).toEqual(facts);
  });

  test("a knock-out names what hit the hero last; a scheme loss names nothing", () => {
    const state = deal();
    const rhino = instanceOf(state, "Rhino");
    const spidey = state.players[0]!.identity.instanceId;
    const events = [
      { type: "damageDealt", targetInstanceId: rhino, amount: 3, sourceInstanceId: spidey },
      { type: "damageDealt", targetInstanceId: spidey, amount: 4, sourceInstanceId: rhino },
    ] as unknown as GameEvent[];
    const out = { ...state, outcome: { result: "loss", reason: "allPlayersDefeated" } } as GameState;
    expect(factsOf(out, events, false).lastBlow).toEqual({ cardId: "01094", name: "Rhino" });
    const scheme = { ...state, outcome: { result: "loss", reason: "mainSchemeCompleted" } } as GameState;
    expect(factsOf(scheme, events, false).lastBlow).toBeNull();
    // The killing blow named no source: nothing, not the hit before it.
    const unnamed = [...events, { type: "damagePlaced", targetInstanceId: spidey, amount: 1, sourceInstanceId: null }];
    expect(factsOf(out, unnamed as unknown as GameEvent[], false).lastBlow).toBeNull();
  });

  test("a player card facedown as a Drone hits as the Drone, not as the card underneath", () => {
    const state = deal("ultron");
    const spidey = state.players[0]!.identity.instanceId;
    const helicarrier = instanceOf(state, "Helicarrier");
    const events = [
      { type: "cardPutIntoPlayFacedown", instanceId: helicarrier, playerId: state.players[0]!.playerId, as: "minion" },
      { type: "damageDealt", targetInstanceId: spidey, amount: 1, sourceInstanceId: helicarrier },
    ] as unknown as GameEvent[];
    const out = { ...state, outcome: { result: "loss", reason: "allPlayersDefeated" } } as GameState;
    expect(factsOf(out, events, false).lastBlow).toEqual({ cardId: "drone", name: "Drone" });
    // Once it has left play, the same card hits as itself.
    const later = [
      ...events.slice(0, 1),
      { type: "cardMoved", instanceId: helicarrier },
      events[1]!,
    ] as unknown as GameEvent[];
    expect(factsOf(out, later, false).lastBlow).toEqual({ cardId: "01092", name: "Helicarrier" });
  });
});

describe("the table's game keeps its events for the record", () => {
  test("each move's events are kept, and an undone move's are dropped", () => {
    const model = new BattleModel();
    model.reset();
    expect(model.events).toHaveLength(0);
    expect(model.game.players[0]!.identity.cardId).toBe("01001a");
    expect(model.endTurn()).toBe(true);
    const first = model.events.length;
    expect(first).toBeGreaterThan(0);
    // The villain phase leaves the next hero phase's question: answer whatever is asked, or end the turn again.
    const snap = model.snapshot();
    const second = snap.choice ? model.choose(snap.choice.options[0]?.id ?? null) : model.endTurn();
    expect(second).toBe(true);
    expect(model.events.length).toBeGreaterThan(first);
    expect(model.undo()).toBe(true);
    expect(model.events).toHaveLength(first);
    expect(model.undo()).toBe(true);
    expect(model.events).toHaveLength(0);
    model.reset();
    expect(model.events).toHaveLength(0);
  });
});

describe("facts read back from storage", () => {
  test("anything off makes the whole block null, never half-right", () => {
    const good = factsOf(deal(), [], false);
    expect(readFacts(good)).toEqual(good);
    expect(readFacts({ ...good, v: 2 })).toBeNull();
    expect(readFacts({ ...good, heroHp: -1 })).toBeNull();
    expect(readFacts({ ...good, modules: "bomb_scare" })).toBeNull();
    expect(readFacts({ ...good, lastBlow: { cardId: "x" } })).toBeNull();
    expect(readFacts(null)).toBeNull();
  });
});
