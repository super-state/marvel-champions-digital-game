import { describe, expect, test } from "vitest";
import { handBetweenBeats } from "./hand-flow.js";
import type { BattleCard } from "./model.js";

const card = (id: string) => ({ id, name: id }) as BattleCard;
const ids = (hand: readonly BattleCard[]) => hand.map((c) => c.id);

describe("the hand shown between beats", () => {
  test("Black Cat's pick-up: the card paid for and the spent resources don't get their slots back", () => {
    const showing = ["power", "tracer", "webbed", "room", "strength", "cat"].map(card);
    const final = ["webbed", "room", "strength", "genius"].map(card);
    expect(ids(handBetweenBeats(showing, final, [], null))).toEqual(["webbed", "room", "strength", "genius"]);
  });

  test("a card drawn by an effect (Avengers Mansion) comes in on the left, where the final hand has it", () => {
    const final = ["drawn", "a", "b"].map(card);
    expect(ids(handBetweenBeats(["a", "b"].map(card), final, [], null))).toEqual(["drawn", "a", "b"]);
  });

  test("a card a later beat brings in waits for its beat", () => {
    const final = ["a", "b", "drawn"].map(card);
    expect(ids(handBetweenBeats(["a", "b"].map(card), final, [{ draw: ["drawn"] } as never], null))).toEqual([
      "a",
      "b",
    ]);
  });

  test("a card a later beat discards from hand stays showing until then", () => {
    const final = ["a"].map(card);
    const later = [{ handDiscard: ["b"] } as never];
    expect(ids(handBetweenBeats(["b", "a"].map(card), final, later, null))).toEqual(["b", "a"]);
  });

  test("a card a later beat puts facedown under Highway Robbery stays showing until then", () => {
    const later = [{ tucked: { ids: ["b"], host: "robbery", count: 1 } } as never];
    expect(ids(handBetweenBeats(["b", "a"].map(card), ["a"].map(card), later, null))).toEqual(["b", "a"]);
  });

  test("the staged event is not in the hand", () => {
    expect(ids(handBetweenBeats(["a"].map(card), ["a", "event"].map(card), [], "event"))).toEqual(["a"]);
  });
});
