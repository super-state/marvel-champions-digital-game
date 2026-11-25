import { describe, expect, test } from "vitest";
import { BROWSER_RECORD_KEY, browserHome, type GameReport, type StorageLike } from "./home.js";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const report = (id: string, villain: string, result: "win" | "loss", extra: Partial<GameReport> = {}): GameReport => ({
  id,
  hero: "Spider-Man",
  villain,
  result,
  reason: result === "win" ? "villainDefeated" : "allPlayersDefeated",
  rounds: 6,
  version: "dev",
  deck: ["core-spider-man-justice"],
  startedAt: 1_000,
  facts: null,
  ...extra,
});

describe("the record in this browser", () => {
  test("keeps each finished game, newest first, and says how you stand against that villain", async () => {
    let clock = 10_000;
    const home = browserHome(memory(), () => clock++);
    expect(await home.save(report("a", "rhino", "loss"))).toEqual({ saved: true, versus: { won: 0, lost: 1 } });
    expect(await home.save(report("b", "rhino", "win"))).toEqual({ saved: true, versus: { won: 1, lost: 1 } });
    await home.save(report("c", "klaw", "loss"));
    const games = (await home.games())!;
    expect(games.map((g) => g.id)).toEqual(["c", "b", "a"]);
    expect(games[0]).toMatchObject({ villain: "klaw", endedAt: 10_002, facts: null });
  });

  test("an ending undone and played out again replaces the game, not adds one", async () => {
    const home = browserHome(memory());
    await home.save(report("a", "rhino", "loss"));
    await home.save(report("a", "rhino", "win"));
    const games = (await home.games())!;
    expect(games).toHaveLength(1);
    expect(games[0]!.result).toBe("win");
  });

  test("storage that refuses (a private window) keeps nothing and says it wasn't saved", async () => {
    const refusing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(await browserHome(refusing).save(report("a", "rhino", "win"))).toEqual({ saved: false });
    expect(await browserHome(null).save(report("a", "rhino", "win"))).toEqual({ saved: false });
  });

  test("anything unreadable in storage is skipped, not fatal", async () => {
    const store = memory();
    store.data.set(BROWSER_RECORD_KEY, JSON.stringify({ v: 1, games: [{ id: "x" }, report("a", "rhino", "win")] }));
    // The report has no endedAt: it doesn't read as a finished game.
    expect(await browserHome(store).games()).toEqual([]);
    store.data.set(BROWSER_RECORD_KEY, "not json");
    expect(await browserHome(store).games()).toEqual([]);
  });
});
