import { describe, expect, test } from "vitest";
import { arrangeHand, moveInHand, rememberOrder, slotAt } from "./hand-order.js";

const hand = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (cards: readonly { id: string }[]) => cards.map((card) => card.id);

describe("the player's own hand order", () => {
  test("with no order of the player's, the hand is shown as the game has it", () => {
    expect(ids(arrangeHand(hand("a", "b", "c"), []))).toEqual(["a", "b", "c"]);
  });

  test("cards the player arranged keep that order", () => {
    expect(ids(arrangeHand(hand("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  test("a drawn card comes in where the game puts it, and the rest keep the player's order", () => {
    expect(ids(arrangeHand(hand("new", "a", "b", "c"), ["c", "a", "b"]))).toEqual(["new", "c", "a", "b"]);
  });

  test("a card that left the hand leaves no gap", () => {
    expect(ids(arrangeHand(hand("a", "c"), ["c", "b", "a"]))).toEqual(["c", "a"]);
  });

  test("a card new to the hand is remembered next to its neighbour", () => {
    expect(rememberOrder(["c", "a", "b"], ["new", "c", "a", "b"])).toEqual(["new", "c", "a", "b"]);
    expect(rememberOrder(["c", "a", "b"], ["c", "a", "new", "b"])).toEqual(["c", "a", "new", "b"]);
    expect(rememberOrder([], ["a", "b"])).toEqual(["a", "b"]);
  });

  test("a card taken out to be played and then cancelled comes back to the slot the player gave it", () => {
    // Dragged into c, a, b; a is clicked to play, so the hand shows c, b; the play is cancelled.
    const order = rememberOrder(["c", "a", "b"], ["c", "b"]);
    expect(order).toEqual(["c", "a", "b"]);
    expect(ids(arrangeHand(hand("a", "b", "c"), order))).toEqual(["c", "a", "b"]);
  });

  test("moving a card files it at the slot it was let go over", () => {
    expect(ids(moveInHand(hand("a", "b", "c", "d"), "a", 2))).toEqual(["b", "c", "a", "d"]);
    expect(ids(moveInHand(hand("a", "b", "c", "d"), "d", 0))).toEqual(["d", "a", "b", "c"]);
    expect(ids(moveInHand(hand("a", "b", "c", "d"), "b", 9))).toEqual(["a", "c", "d", "b"]);
  });

  test("the slot under the pointer is the nearest one, and past either end the end one", () => {
    // Four slots 100px apart around x = 500: 350, 450, 550, 650.
    const slots = { center: 500, count: 4, step: 100 };
    expect(slotAt(350, slots)).toBe(0);
    expect(slotAt(560, slots)).toBe(2);
    expect(slotAt(605, slots)).toBe(3);
    expect(slotAt(-50, slots)).toBe(0);
    expect(slotAt(2000, slots)).toBe(3);
    expect(slotAt(123, { center: 500, count: 1, step: 100 })).toBe(0);
  });
});
