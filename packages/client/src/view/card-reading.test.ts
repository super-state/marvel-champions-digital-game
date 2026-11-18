import { describe, expect, test } from "vitest";
import { readingResources, readingStats } from "./card-reading.js";

describe("reading a card", () => {
  test("keeps the count and type of each icon a player would spend", () => {
    expect(readingResources(["energy", "physical", "energy"])).toBe("2 energy · 1 physical");
    expect(readingResources([])).toBe("");
  });

  test("names the stat while retaining its modifier, printed star and unavailable dash", () => {
    expect(readingStats([{ label: "THW", value: "2", bonus: 1, star: true }])).toBe("Thwart 2 ★ (+1)");
    expect(readingStats([{ label: "ATK", value: "—", bonus: 0 }])).toBe("Attack —");
    expect(readingStats([{ label: "HP", value: "7/10", bonus: 0 }])).toBe("Hit points 7/10");
  });
});
