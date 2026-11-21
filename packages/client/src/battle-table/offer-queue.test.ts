import { describe, expect, test } from "vitest";
import { BattleModel, type BattleSnapshot } from "./model.js";
import { arrangeScene } from "./debug-scenes.js";
import { nextOfferIndex } from "./offer-queue.js";

describe("one question per card in a reaction window", () => {
  test("a second copy of a card is never asked about straight after the first, whatever the answer", () => {
    expect(nextOfferIndex(["Enhanced Spider-Sense", "Enhanced Spider-Sense"], 0)).toBe(2);
    expect(nextOfferIndex(["Backflip", "Backflip", "Emergency"], 0)).toBe(2);
  });

  test("other cards are still asked about, and copies need not sit together", () => {
    expect(nextOfferIndex(["Backflip", "Emergency", "Backflip", "Emergency", "Haymaker"], 0)).toBe(1);
    expect(nextOfferIndex(["Backflip", "Emergency", "Backflip", "Emergency", "Haymaker"], 1)).toBe(4);
    expect(nextOfferIndex(["Backflip", "Emergency", "Backflip", "Emergency", "Haymaker"], 4)).toBe(5);
  });
});

const spiderSense = (s: BattleSnapshot) =>
  s.choice?.offers?.filter((o) => /Enhanced Spider-Sense/.test(o.question)) ?? [];

/** End the turn on the two-Spider-Sense table and answer everything until Enhanced Spider-Sense is offered. */
function atTheOffer() {
  const battle = new BattleModel();
  battle.reset({ seed: 7, arrange: arrangeScene("senses")! });
  battle.endTurn();
  let s = battle.snapshot();
  for (let i = 0; i < 12 && !spiderSense(s).length; i++) {
    if (s.choice?.offers?.length) battle.chooseMany([]);
    else if (s.choice) battle.choose(s.choice.options.at(-1)?.id ?? null);
    s = battle.snapshot();
  }
  return { battle, s };
}

const copiesInHand = (s: BattleSnapshot) => s.hand.filter((card) => card.name === "Enhanced Spider-Sense").length;

describe("two Enhanced Spider-Senses as a treachery is revealed", () => {
  test("after one cancels its When Revealed, the other is not offered again and stays in hand", () => {
    const { battle, s } = atTheOffer();
    expect(spiderSense(s)).toHaveLength(2);
    battle.chooseMany([spiderSense(s)[0]!.id]);
    const payment = battle.snapshot().payment!;
    expect(payment.subject.name).toBe("Enhanced Spider-Sense");
    battle.toggle(payment.sources.find((source) => source.label !== "Enhanced Spider-Sense")!.id);
    expect(battle.pay()).toBe(true);
    const after = battle.snapshot();
    expect(spiderSense(after)).toHaveLength(0);
    expect(copiesInHand(after)).toBe(1);
  });

  test("a no leaves both copies in hand; the next question about them is for the next treachery, not this one", () => {
    const { battle, s } = atTheOffer();
    const revealed = s.choice!.event!.subject;
    battle.chooseMany([]);
    const after = battle.snapshot();
    expect(copiesInHand(after)).toBe(2);
    // Hard to Keep Down surges into "I'm Tough!", a treachery of its own: Spider-Sense may be offered for that one.
    if (spiderSense(after).length) expect(after.choice!.event!.subject).not.toBe(revealed);
  });
});
