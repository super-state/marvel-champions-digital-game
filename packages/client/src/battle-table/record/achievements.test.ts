import { describe, expect, test } from "vitest";
import { achievementsOf, DEFINITIONS, HEROES, newlyEarned, stampsOf, statsOf, trophyRoom } from "./achievements.js";
import type { FinishedGame, GameFacts } from "./game.js";

const FACTS: GameFacts = {
  v: 1,
  difficulty: "standard",
  modules: ["bomb_scare"],
  heroId: "01001a",
  aspects: ["justice"],
  deckSize: 40,
  starterDeck: "core-spider-man-justice",
  heroHp: 6,
  form: "hero",
  alliesPlayed: 2,
  undo: true,
  lastBlow: null,
};

let clock = 0;
function game(
  villain: string,
  result: "win" | "loss",
  extra: Partial<FinishedGame> = {},
  facts: Partial<GameFacts> | null = {},
) {
  clock += 60 * 60000;
  return {
    id: `g${clock}`,
    hero: "Spider-Man",
    villain,
    result,
    reason: result === "win" ? "villainDefeated" : "allPlayersDefeated",
    rounds: 8,
    version: "0.3.0",
    deck: ["core-spider-man-justice"],
    startedAt: clock - 30 * 60000,
    endedAt: clock,
    facts: facts === null ? null : { ...FACTS, ...facts },
    ...extra,
  } satisfies FinishedGame;
}
const earned = (games: FinishedGame[]) =>
  achievementsOf(games)
    .filter((a) => a.earned)
    .map((a) => a.id);
const one = (games: FinishedGame[], id: string) => achievementsOf(games).find((a) => a.id === id)!;

describe("the achievements", () => {
  test("each has an id, a name, how to earn it and a reward id; ids are unique", () => {
    const ids = DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of achievementsOf([])) {
      expect(a.name && a.how && a.reward).toBeTruthy();
      expect(a.reward).toMatch(/^(mat|decor|deckbox|tokens|silly):/);
      expect(a.earned).toBe(false);
    }
    // The plan's first list: villains 8, heroes 5 + 4 + 1, modules 5, decks 2, feats 4, for trying 3.
    expect(ids).toHaveLength(32);
    expect(HEROES.map((h) => h.name)).toEqual([
      "Spider-Man",
      "Captain Marvel",
      "She-Hulk",
      "Iron Man",
      "Black Panther",
    ]);
  });

  test("no games, nothing earned", () => {
    expect(earned([])).toEqual([]);
  });

  test("a win against Rhino with the starter deck", () => {
    expect(earned([game("rhino", "win")])).toEqual([
      "beat-rhino",
      "win-as-spider-man",
      "win-with-justice",
      "win-with-bomb-scare",
    ]);
  });

  test("beating all three, and on Expert", () => {
    const games = [game("rhino", "win"), game("klaw", "win"), game("ultron", "loss")];
    expect(one(games, "beat-all-villains")).toMatchObject({ earned: false, progress: { have: 2, need: 3 } });
    const all = [...games, game("ultron", "win")];
    expect(one(all, "beat-all-villains")).toMatchObject({ earned: true, earnedAt: all[3]!.endedAt });
    expect(one(all, "beat-all-villains-expert").earned).toBe(false);
    const expert = ["rhino", "klaw", "ultron"].map((v) => game(v, "win", {}, { difficulty: "expert" }));
    expect(earned(expert)).toEqual(expect.arrayContaining(["beat-rhino-expert", "beat-all-villains-expert"]));
  });

  test("the feats, each from one win", () => {
    expect(earned([game("rhino", "win", {}, { heroHp: 1 })])).toContain("win-on-one-hp");
    expect(earned([game("rhino", "win", { rounds: 5 })])).toContain("win-in-five-rounds");
    expect(earned([game("rhino", "win", { rounds: 6 })])).not.toContain("win-in-five-rounds");
    expect(earned([game("rhino", "win", {}, { alliesPlayed: 0 })])).toContain("win-without-ally");
    expect(earned([game("rhino", "win", {}, { undo: false })])).toContain("win-without-undo");
    // A loss earns no feat.
    expect(earned([game("rhino", "loss", { rounds: 2 }, { heroHp: 1, alliesPlayed: 0, undo: false })])).toEqual([]);
  });

  test("decks: one you built, and 50 cards", () => {
    const built = game("rhino", "win", { deck: ["01002", "01003"] }, { starterDeck: null, deckSize: 50 });
    expect(earned([built])).toEqual(expect.arrayContaining(["win-built-deck", "win-fifty-cards"]));
    expect(earned([game("rhino", "win")])).not.toContain("win-built-deck");
  });

  test("for trying: ten losses, a round-1 loss, five scheme losses", () => {
    const losses = Array.from({ length: 9 }, () => game("rhino", "loss"));
    expect(one(losses, "lose-ten")).toMatchObject({ earned: false, progress: { have: 9, need: 10 } });
    expect(one([...losses, game("klaw", "loss")], "lose-ten").earned).toBe(true);
    expect(earned([game("rhino", "loss", { rounds: 1 })])).toContain("lose-in-round-one");
    const scheme = Array.from({ length: 5 }, () => game("klaw", "loss", { reason: "mainSchemeCompleted" }));
    expect(one(scheme, "lose-to-scheme-five")).toMatchObject({ earned: true, progress: { have: 5, need: 5 } });
  });

  test("every hero against every villain counts stamps", () => {
    const games = [
      game("rhino", "win"),
      game("rhino", "win"),
      game("klaw", "win", { hero: "Iron Man" }, { heroId: "01029a" }),
    ];
    expect(one(games, "every-hero-every-villain").progress).toEqual({ have: 2, need: 15 });
    const stamps = stampsOf(games);
    expect(stamps).toHaveLength(15);
    expect(stamps.filter((s) => s.won).map((s) => `${s.hero} vs ${s.villain}`)).toEqual([
      "Spider-Man vs Rhino",
      "Iron Man vs Klaw",
    ]);
  });
});

describe("games saved before the record kept facts", () => {
  test("count for what the table always did then, and never earn a feat they can't prove", () => {
    const old = game("klaw", "win", { rounds: 4 }, null);
    expect(earned([old])).toEqual([
      "beat-klaw",
      "win-as-spider-man",
      "win-with-justice",
      "win-with-masters-of-evil",
      "win-in-five-rounds",
    ]);
  });
});

describe("what one game earned (the pop-up)", () => {
  test("only what that game earned, not what was earned before it", () => {
    const first = game("rhino", "win");
    const second = game("rhino", "win", {}, { undo: false });
    expect(newlyEarned([first], first.id).map((a) => a.id)).toEqual([
      "beat-rhino",
      "win-as-spider-man",
      "win-with-justice",
      "win-with-bomb-scare",
    ]);
    expect(newlyEarned([second, first], second.id).map((a) => a.id)).toEqual(["win-without-undo"]);
    expect(newlyEarned([second, first], "not-there")).toEqual([]);
  });
});

describe("the stats", () => {
  test("wins and losses by villain and hero, fastest win, longest winning run", () => {
    const games = [
      game("rhino", "win", { rounds: 9 }),
      game("rhino", "win", { rounds: 6 }),
      game("klaw", "loss"),
      game("klaw", "win", { rounds: 6, startedAt: 0 }),
      game("klaw", "win", { hero: "Iron Man" }, { heroId: "01029a" }),
      game("ultron", "win"),
      game("ultron", "loss"),
    ];
    const stats = statsOf(games);
    expect(stats.total).toEqual({ played: 7, won: 5, lost: 2 });
    expect(stats.byVillain.map((v) => [v.name, v.tally.won, v.tally.lost])).toEqual([
      ["Rhino", 2, 0],
      ["Klaw", 2, 1],
      ["Ultron", 1, 1],
    ]);
    expect(stats.byHero.map((h) => [h.name, h.tally.played])).toEqual([
      ["Spider-Man", 6],
      ["Iron Man", 1],
    ]);
    expect(stats.fastestWin).toMatchObject({ rounds: 6, minutes: 30, villain: "Rhino", hero: "Spider-Man" });
    expect(stats.longestWinningRun).toBe(3);
    expect(stats.currentWinningRun).toBe(0);
    expect(statsOf([]).fastestWin).toBeNull();
  });

  test("one call has everything the cabinet and the board show", () => {
    const room = trophyRoom([game("rhino", "win")]);
    expect(room.earned).toBe(4);
    expect(room.achievements).toHaveLength(32);
    expect(room.stamps).toHaveLength(15);
    expect(room.stats.total.won).toBe(1);
  });
});

describe("each achievement's symbol", () => {
  test("names a card the Core Set has, or an icon the table draws", async () => {
    const { CORE_CARDS } = await import("@mc/content");
    // The table's icons (icons.ts) these use; its set is not exported, so the names are checked against its source.
    const source = (await import("node:fs")).readFileSync(new URL("../icons.ts", import.meta.url), "utf8");
    const ICON_NAMES = [...source.matchAll(/^  ([a-z-]+): \[/gm)].map((m) => m[1]);
    for (const a of achievementsOf([])) {
      if (a.symbol.cardId)
        expect(
          CORE_CARDS.some((c) => c.id === a.symbol.cardId),
          a.id,
        ).toBe(true);
      expect(ICON_NAMES, a.id).toContain(a.symbol.icon);
    }
    // The villain and hero ones show that villain's and hero's own card.
    expect(achievementsOf([]).find((a) => a.id === "beat-rhino")!.symbol.cardId).toBe("01094");
    expect(achievementsOf([]).find((a) => a.id === "win-as-spider-man")!.symbol.cardId).toBe("01001a");
  });
});
