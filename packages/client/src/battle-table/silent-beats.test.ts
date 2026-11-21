import { describe, expect, test } from "vitest";
import { arrangeScene } from "./debug-scenes.js";
import { BattleModel, type BattleBeat } from "./model.js";

/** Plays on from `start` (answering every question with its last option, passing every offer) and collects beats. */
function playOn(battle: BattleModel, start: () => void, until = 40): BattleBeat[] {
  const beats: BattleBeat[] = [];
  start();
  beats.push(...battle.snapshot().beats);
  for (let i = 0; i < until; i++) {
    const s = battle.snapshot();
    if (!s.choice || (s.turn === "player" && !s.choice)) break;
    if (s.choice.offers?.length) battle.chooseMany([]);
    else if (s.choice.options.length) battle.choose(s.choice.options.at(-1)!.id);
    else break;
    beats.push(...battle.snapshot().beats);
  }
  return beats;
}

function scene(name: string): BattleModel {
  const battle = new BattleModel();
  battle.reset({ seed: 7, arrange: arrangeScene(name)! });
  return battle;
}

describe("changes that used to happen with nothing on screen", () => {
  test("Highway Robbery takes a card from the hand facedown under itself", () => {
    const battle = scene("robbery");
    const beats = playOn(battle, () => battle.endTurn());
    const tuck = beats.find((beat) => beat.tucked);
    expect(tuck?.tucked?.ids).toHaveLength(1);
    expect(tuck?.text).toMatch(/Highway Robbery/);
  });

  test("defeating Highway Robbery returns its cards from under it", () => {
    const battle = scene("robbed");
    const beats = playOn(battle, () => {
      battle.heroAction("basicThwart");
      const robbery = battle.snapshot().choice?.options.find((o) => /Highway/.test(o.label));
      if (robbery) battle.choose(robbery.id);
    });
    const back = beats.find((beat) => beat.returned);
    expect(back?.returnedFrom).toBeTruthy();
  });

  test("running the deck out shuffles the discard pile into a new deck", () => {
    const battle = scene("deckout");
    const beats = playOn(battle, () => battle.endTurn());
    const reset = beats.find((beat) => beat.deckReset);
    expect(reset?.deckReset).toBeGreaterThan(10);
  });

  test("Shadow of the Past shuffles the rest of the nemesis set into the encounter deck", () => {
    const battle = scene("shadow");
    const beats = playOn(battle, () => battle.endTurn());
    expect(beats.find((beat) => beat.intoEncounterDeck)?.intoEncounterDeck?.length).toBeGreaterThan(0);
    expect(beats.some((beat) => beat.encounterReset)).toBe(false);
  });

  test("running the encounter deck out shuffles its discard back in and adds an acceleration token", () => {
    const battle = scene("encounterout");
    const beats = playOn(battle, () => battle.endTurn());
    expect(beats.find((beat) => beat.encounterReset)?.encounterReset).toBeGreaterThan(5);
    expect(beats.find((beat) => beat.acceleration)?.acceleration).toBe(1);
  });

  test("Helicarrier's discount is called out when it is used", () => {
    const battle = scene("helicarrier");
    const heli = battle.snapshot().inPlay.find((card) => card.name === "Helicarrier")!;
    const action = battle.fieldActions(heli.id)[0]!;
    const beats = playOn(battle, () => battle.fieldAction(heli.id, action.kind));
    expect(beats.find((beat) => beat.discount)?.discount).toEqual({ amount: 1, source: heli.id });
  });
});
