import { describe, expect, test } from "vitest";
import { missLineOf } from "./deck-reveal.js";

describe("missLineOf", () => {
  test("Black Cat: no printed mental resource turned up", () => {
    const text =
      "Forced Response: After Black Cat enters play, discard the top 2 cards of your deck. Add each card with a printed mental resource discarded this way to your hand.";
    expect(missLineOf(text)).toBe("No mental resources");
  });

  test("a kind of card kept (Nova's Aggression cards, SP//dr's SP//dr cards)", () => {
    expect(
      missLineOf(
        "Response: discard the top card of your deck and add each Aggression (red) card discarded this way to your hand.",
      ),
    ).toBe("No Aggression cards");
    expect(
      missLineOf("Discard the top 2 cards of your deck → add each SP//dr card discarded this way to your hand."),
    ).toBe("No SP//dr cards");
  });

  test("any other keep-for-the-hand discard says nothing was added", () => {
    expect(
      missLineOf(
        "Name a card type, then discard the top card of your deck. If that card is of the named type, you may add it to your hand.",
      ),
    ).toBe("Nothing to add to your hand");
  });

  test("a discard that keeps nothing by design says nothing", () => {
    expect(missLineOf("When Revealed: Discard the top 3 cards of your deck.")).toBeNull();
    expect(
      missLineOf(
        "Discard the top card of your deck. If that card's resource has: mental — Discard a card from your hand.",
      ),
    ).toBeNull();
    expect(missLineOf("")).toBeNull();
  });
});
