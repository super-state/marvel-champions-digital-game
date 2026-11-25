import { describe, expect, test } from "vitest";
import { searchQuestion } from "./search-question.js";

describe("searchQuestion", () => {
  test("Masters of Mayhem: the minion to choose, and where it goes; no piles, no shuffle", () => {
    expect(
      searchQuestion(
        "Search the encounter deck and discard pile for a Masters of Evil minion and put it into play engaged with you, then shuffle the encounter deck",
        1,
      ),
    ).toEqual({ title: "Choose a Masters of Evil minion", help: "It comes into play engaged with you." });
  });

  test("other searches", () => {
    expect(
      searchQuestion("Search your deck for an upgrade and add it to your hand, then shuffle your deck.", 1),
    ).toEqual({ title: "Choose an upgrade", help: "It goes into your hand." });
    expect(searchQuestion("Search the encounter deck and discard pile for a Police minion and reveal it.", 1)).toEqual({
      title: "Choose a Police minion",
      help: "It is revealed.",
    });
    expect(searchQuestion("Search the encounter deck for Defense Network", 1)).toEqual({
      title: "Choose Defense Network",
      help: null,
    });
  });

  test("a short question stays; a long one becomes the plain ask", () => {
    expect(searchQuestion("Choose cards", 3)).toEqual({ title: "Choose cards", help: null });
    expect(
      searchQuestion("Look at the top 3 cards of your deck and choose any number of them to keep in your hand", 3),
    ).toEqual({ title: "Choose cards", help: null });
    expect(searchQuestion("Look at the top 3 cards of your deck and choose one to put into your hand", 1)).toEqual({
      title: "Choose a card",
      help: null,
    });
  });
});
