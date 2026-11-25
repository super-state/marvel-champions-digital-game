/**
 * A finished game kept whole on the test site plays again, move for move, to the same table (Adam, 2026-11-25: the
 * friend's Ultron game, whose threat counter jumped, couldn't be replayed from its one-line summary).
 *
 * Plays whole games through the model with a simple player (some moves undone, as players do), sends each ending the
 * way the page does (packed) to the site's API over a real SQLite, reads it back through Adam's admin route, and
 * replays it: the engine state, the beats and the log must come out the same.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { BattleModel, type DealOptions } from "../model.js";
import { handleTableSiteRequest, INVITE_COOKIE, type TableSiteEnv } from "../test-site/gate.js";
import { ADMIN_COOKIE, type D1Like, type D1Statement } from "../test-site/players.js";
import { packGame, unpackGame, type SavedGame } from "./replay-pack.js";
import { replayGame } from "./replay.js";
import type { GameReplay } from "../model.js";

function sqliteD1(db = new DatabaseSync(":memory:")): D1Like {
  const statement = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...v) => statement(sql, v),
    first: async <T>() => (db.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => db.prepare(sql).run(...(values as never[])),
  });
  return { prepare: (sql) => statement(sql) };
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays a game to its end (or `limit` steps) the way a hurried player would: answers every question with what it
 * offers first, pays with what's there, plays a card or attacks now and then, ends the turn, and undoes a move now
 * and then. The log is every beat's words, as the page writes them.
 */
function playThrough(deal: DealOptions, seed: number, limit = 4000): { model: BattleModel; log: string[] } {
  const rnd = mulberry(seed);
  const model = new BattleModel();
  model.reset({ ...deal, mulligan: true });
  const log: string[] = [];
  let beats = model.snapshot().beats;
  for (let step = 0; step < limit; step++) {
    const s = model.snapshot();
    if (s.outcome) break;
    if (s.payment) {
      for (const source of s.payment.sources) {
        if (model.snapshot().payment?.canPay) break;
        if (source.available && !source.selected) model.toggle(source.id);
      }
      if (!model.pay()) model.cancel();
    } else if (s.choice) {
      const ids = s.choice.options.map((o) => o.id);
      const take = ids.slice(0, Math.max(s.choice.min, rnd() < 0.5 ? 0 : Math.min(1, s.choice.max)));
      if (!(s.choice.max === 1 && take.length === 1 && model.choose(take[0]!)) && !model.chooseMany(take))
        model.choose(null);
    } else {
      const playable = s.hand.filter((c) => c.playable);
      const power = (kind: string) => s.heroActions.find((a) => a.kind === kind);
      const hit =
        rnd() < 0.6 ? (power("basicThwart") ?? power("basicAttack")) : (power("basicAttack") ?? power("basicThwart"));
      if (playable.length && rnd() < 0.5) model.pick(playable[Math.floor(rnd() * playable.length)]!.id);
      else if (hit) model.heroAction(hit.kind);
      else if (power("changeForm") && rnd() < 0.8) model.heroAction("changeForm");
      else model.endTurn();
    }
    const now = model.snapshot();
    if (now.beats !== beats) {
      beats = now.beats;
      log.push(...beats.map((b) => b.text).filter(Boolean));
      if (rnd() < 0.06 && model.canUndo && !now.payment && !now.choice?.canCancel) {
        model.undo();
        beats = model.snapshot().beats;
        log.push("(undone)");
      }
    }
  }
  return { model, log };
}

const beatText = (model: BattleModel) => model.snapshot().beats.map((b) => b.text);

describe("a finished game kept whole", () => {
  it.each([
    { name: "Spider-Man against Rhino", deal: { hero: "spider-man", villain: "rhino" }, seed: 101 },
    { name: "Captain Marvel against Klaw", deal: { hero: "captain-marvel", villain: "klaw" }, seed: 202 },
    { name: "She-Hulk against Ultron", deal: { hero: "she-hulk", villain: "ultron" }, seed: 303 },
    {
      name: "Spider-Man against Ultron on Expert",
      deal: { hero: "spider-man", villain: "ultron", difficulty: "expert" },
      seed: 404,
    },
  ] as { name: string; deal: DealOptions; seed: number }[])("replays to the same table: $name", ({ deal, seed }) => {
    const { model } = playThrough({ ...deal, seed }, seed);
    const replay = model.replay!;
    expect(replay.moves.length).toBeGreaterThan(20);
    // Through JSON, as it is kept.
    const again = replayGame(JSON.parse(JSON.stringify(replay)) as GameReplay);
    expect(again.refusedAt).toBeNull();
    expect(again.played).toBe(replay.moves.length);
    expect(again.model.game).toEqual(model.game);
    expect(beatText(again.model)).toEqual(beatText(model));
    expect(again.model.events).toEqual(model.events);
  });

  it("stops at a move that doesn't fit, rather than playing on wrong", () => {
    const { model } = playThrough({ hero: "spider-man", villain: "rhino", seed: 7 }, 7, 200);
    const replay = model.replay!;
    const at = replay.moves.findIndex((m, i) => i > 3 && m.type === "resolveChoice");
    expect(at).toBeGreaterThan(0);
    const moves = replay.moves.map((m, i) => (i === at ? { ...m, choiceId: "not-this-game" } : m));
    const again = replayGame({ ...replay, moves } as GameReplay);
    expect(again.refusedAt).toBe(at);
    expect(again.played).toBe(at);
  });

  it("is saved with the game on the test site, read back by Adam, and replays", async () => {
    const env: TableSiteEnv = {
      INVITE_KEY: "invite",
      ADMIN_KEY: "admin",
      DB: sqliteD1(),
      ASSETS: { fetch: async () => new Response("page", { status: 200 }) },
    };
    const call = (path: string, cookie: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", cookie);
      return handleTableSiteRequest(new Request(`https://table.example${path}`, { ...init, headers }), env);
    };
    const post = (path: string, cookie: string, body: unknown) =>
      call(path, cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const joined = await post("/api/me", `${INVITE_COOKIE}=invite`, { name: "Mr Moomin" });
    const player = (joined.headers.get("set-cookie") ?? "").split(";")[0]!;

    const { model, log } = playThrough({ hero: "spider-man", villain: "ultron", seed: 31337 }, 31337);
    const whole: SavedGame = { v: 1, replay: model.replay!, log };
    const packed = await packGame(whole);
    expect(packed).not.toBeNull();
    const raw = JSON.stringify(whole).length;
    console.log(
      `one game (${model.snapshot().round} rounds, ${whole.replay.moves.length} moves, ${log.length} log lines): ` +
        `${(raw / 1024).toFixed(1)} KB as JSON, ${(packed!.length / 1024).toFixed(1)} KB packed`,
    );
    const outcome = model.snapshot().outcome;
    const sent = {
      id: "game-moomin",
      hero: "Spider-Man",
      villain: "ultron",
      result: outcome?.result === "win" ? "win" : "loss",
      reason: outcome?.reason ?? "allPlayersDefeated",
      rounds: model.snapshot().round,
      version: "0.2.2",
      deck: ["core-spider-man-justice"],
      startedAt: Date.now() - 600_000,
      facts: null,
      replay: packed,
    };
    const saved = await post("/api/games", player, sent);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ saved: true });

    // A player can't read it; Adam can, unpacked.
    expect((await call("/api/games/game-moomin/replay", player)).status).toBe(403);
    const admin = `${ADMIN_COOKIE}=admin`;
    const read = await call("/api/games/game-moomin/replay", admin);
    expect(read.status).toBe(200);
    const body = (await read.json()) as SavedGame & { player: string; game: { villain: string } };
    expect(body.player).toBe("Mr Moomin");
    expect(body.game.villain).toBe("ultron");
    expect(body.log).toEqual(log);
    const again = replayGame(body.replay as GameReplay);
    expect(again.refusedAt).toBeNull();
    expect(again.model.game).toEqual(model.game);

    // The players page links it.
    expect(await (await call("/admin", admin)).text()).toContain("/api/games/game-moomin/replay");
  });

  it("saves the game without it when it is missing, too big or not packed", async () => {
    const env: TableSiteEnv = {
      INVITE_KEY: "invite",
      ADMIN_KEY: "admin",
      DB: sqliteD1(),
      ASSETS: { fetch: async () => new Response("page", { status: 200 }) },
    };
    const call = (path: string, cookie: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", cookie);
      return handleTableSiteRequest(new Request(`https://table.example${path}`, { ...init, headers }), env);
    };
    const post = (path: string, cookie: string, body: unknown) =>
      call(path, cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const player = (
      (await post("/api/me", `${INVITE_COOKIE}=invite`, { name: "Sam" })).headers.get("set-cookie") ?? ""
    ).split(";")[0]!;
    const game = (id: string, replay: unknown) => ({
      id,
      hero: "Spider-Man",
      villain: "rhino",
      result: "win",
      reason: "villainDefeated",
      rounds: 5,
      version: "0.2.2",
      deck: [],
      startedAt: Date.now() - 60_000,
      facts: null,
      ...(replay === undefined ? {} : { replay }),
    });
    for (const [id, replay] of [
      ["old-page", undefined],
      ["not-packed", "{not base64}"],
      ["too-big", "A".repeat(500_000)],
    ] as const) {
      const saved = await post("/api/games", player, game(id, replay));
      expect(saved.status, id).toBe(200);
      expect((await call(`/api/games/${id}/replay`, `${ADMIN_COOKIE}=admin`)).status, id).toBe(404);
    }
    const record = (await (await call("/api/games", player)).json()) as { games: unknown[] };
    expect(record.games).toHaveLength(3);
    expect(await unpackGame("AAAA")).toBeNull();
  });

  // `pnpm table:game <id>` saves a player's game; this plays it, printing what the table said after every move.
  it.runIf(!!process.env.TABLE_GAME)("plays a saved file (TABLE_GAME=<file from pnpm table:game>)", () => {
    const saved = JSON.parse(readFileSync(process.env.TABLE_GAME!, "utf8")) as SavedGame & { game?: unknown };
    console.log(JSON.stringify(saved.game ?? {}));
    const again = replayGame(saved.replay as GameReplay, {
      each: (i, model) => {
        const s = model.snapshot();
        console.log(
          `move ${i} (${JSON.stringify(saved.replay.moves[i]).slice(0, 160)}) -> round ${s.round}, ${s.turn}, ` +
            `hero ${s.heroHp} HP, villain ${s.villainHp} HP, ` +
            `${s.enemyCards
              .filter((c) => c.threat !== null)
              .map((c) => `${c.name} ${c.threat}/${c.threatTarget ?? "-"}`)
              .join(", ")}`,
        );
        for (const beat of s.beats) if (beat.text) console.log(`    ${beat.text}`);
      },
    });
    console.log(
      again.refusedAt === null
        ? `played all ${again.played} moves: ${JSON.stringify(again.model.snapshot().outcome)}`
        : `move ${again.refusedAt} was refused: this checkout isn't the code the game was played on`,
    );
    expect(again.refusedAt).toBeNull();
  });
});
