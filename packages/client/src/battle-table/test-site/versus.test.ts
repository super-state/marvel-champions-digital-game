import { describe, expect, it } from "vitest";
import type { FinishedGame } from "../record/game.js";
import { versusLine } from "./versus.js";

const game = (villain: string, result: "win" | "loss", difficulty: "standard" | "expert" | null): FinishedGame => ({
  id: `${villain}-${result}-${difficulty}-${Math.random()}`,
  hero: "Spider-Man",
  villain,
  result,
  reason: result === "win" ? "villainDefeated" : "allPlayersDefeated",
  rounds: 5,
  version: "dev",
  deck: [],
  startedAt: 0,
  endedAt: 1,
  facts: difficulty
    ? {
        v: 1,
        difficulty,
        modules: [],
        heroId: "01001a",
        aspects: ["justice"],
        deckSize: 40,
        starterDeck: null,
        heroHp: 1,
        form: "hero",
        alliesPlayed: 0,
        undo: false,
        lastBlow: null,
      }
    : null,
});

describe("versusLine: the game-over record line", () => {
  it("counts Standard and Expert apart", () => {
    const games = [game("rhino", "win", "standard"), game("rhino", "loss", "expert"), game("rhino", "win", "expert")];
    expect(versusLine("Rhino", games, "rhino")).toBe(
      "You against Rhino: on Standard 1 won, 0 lost; on Expert 1 won, 1 lost.",
    );
  });
  it("names the one difficulty played, and counts a game saved without facts as Standard", () => {
    expect(versusLine("Klaw", [game("klaw", "loss", null), game("rhino", "win", "expert")], "klaw")).toBe(
      "You against Klaw on Standard: 0 won, 1 lost.",
    );
    expect(versusLine("Klaw", [game("klaw", "win", "expert")], "klaw")).toBe(
      "You against Klaw on Expert: 1 won, 0 lost.",
    );
  });
});
