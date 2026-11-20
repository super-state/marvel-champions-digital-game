import { describe, expect, test } from "vitest";
import { BattleModel } from "./model.js";
import { arrangeScene } from "./debug-scenes.js";
import { holdsEncounter, revealWindowFor, type Reaction } from "./reveal-hold.js";

/** End the turn on the Spider-Sense table and answer everything until Enhanced Spider-Sense is offered. */
function atTheOffer() {
  const battle = new BattleModel();
  battle.reset({ seed: 7, arrange: arrangeScene("sense")! });
  battle.endTurn();
  let s = battle.snapshot();
  for (let i = 0; i < 12 && !s.choice?.offers?.some((o) => /Enhanced/.test(o.question)); i++) {
    if (s.choice?.offers?.length) battle.chooseMany([]);
    else if (s.choice) battle.choose(s.choice.options.at(-1)?.id ?? null);
    s = battle.snapshot();
  }
  const offer = s.choice!.offers!.find((o) => /Enhanced/.test(o.question))!;
  const revealed = s.choice!.event!.subject!;
  const reacting: Reaction = { card: offer.cardId, subject: revealed, kind: "encounterCardRevealing", amount: 1 };
  return { battle, offer, revealed, reacting };
}

describe("holding a revealed encounter card up", () => {
  test("while the question about its reveal is up", () => {
    const { battle, revealed } = atTheOffer();
    expect(holdsEncounter(battle.snapshot(), null, revealed)).toBe(true);
    expect(revealWindowFor(battle.snapshot(), null, revealed)).toBe(true);
  });

  test("while its reaction is paid for, and while that reaction plays out", () => {
    const { battle, offer, revealed, reacting } = atTheOffer();
    battle.chooseMany([offer.id]);
    expect(holdsEncounter(battle.snapshot(), reacting, revealed)).toBe(true);
    battle.toggle(battle.snapshot().payment!.sources[0]!.id);
    battle.pay();
    expect(holdsEncounter(battle.snapshot(), reacting, revealed)).toBe(true);
    // Once the presenter lets go of the reaction, nothing holds the card any more.
    expect(holdsEncounter(battle.snapshot(), null, revealed)).toBe(false);
  });

  test("not once the reaction is called off", () => {
    const { battle, offer, revealed } = atTheOffer();
    battle.chooseMany([offer.id]);
    battle.cancel();
    expect(holdsEncounter(battle.snapshot(), null, revealed)).toBe(false);
  });

  test("not once the question is passed", () => {
    const { battle, revealed } = atTheOffer();
    battle.chooseMany([]);
    expect(holdsEncounter(battle.snapshot(), null, revealed)).toBe(false);
  });
});
