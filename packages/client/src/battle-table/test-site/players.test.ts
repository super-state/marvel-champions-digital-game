import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { handleTableSiteRequest, INVITE_COOKIE, type TableSiteEnv } from "./gate.js";
import {
  addFactsColumn,
  ADMIN_COOKIE,
  ensureSchema,
  PLAYER_COOKIE,
  recordOf,
  unlockedFrom,
  type D1Like,
  type D1Statement,
  type GameRow,
} from "./players.js";

/** Cloudflare D1's statement API over node:sqlite, so the real SQL runs in the tests. */
function sqliteD1(db = new DatabaseSync(":memory:")): D1Like {
  const statement = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...v) => statement(sql, v),
    first: async <T>() => (db.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => db.prepare(sql).run(...(values as never[])),
  });
  return { prepare: (sql) => statement(sql) };
}

const KEY = "invite-key";
const ADMIN = "admin-key";

function site(db: D1Like | undefined = sqliteD1()): TableSiteEnv {
  return {
    INVITE_KEY: KEY,
    ADMIN_KEY: ADMIN,
    DB: db,
    ASSETS: { fetch: async () => new Response("page", { status: 200, headers: { "content-type": "text/html" } }) },
  };
}

const ORIGIN = "https://table.example";
function call(env: TableSiteEnv, path: string, cookie?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return handleTableSiteRequest(new Request(`${ORIGIN}${path}`, { ...init, headers }), env);
}
const post = (env: TableSiteEnv, path: string, cookie: string, body: unknown) =>
  call(env, path, cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const cookieOf = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0]!;

const invite = `${INVITE_COOKIE}=${KEY}`;
let gameNo = 0;
const game = (villain: string, result: "win" | "loss", extra: Record<string, unknown> = {}) => ({
  id: `game-${++gameNo}`,
  hero: "Spider-Man",
  villain,
  result,
  reason: result === "win" ? "villainDefeated" : "allPlayersDefeated",
  rounds: 7,
  version: "0.2.0",
  deck: ["Web-Shooter", "Black Cat"],
  startedAt: Date.now() - 20 * 60000,
  ...extra,
});

async function newPlayer(env: TableSiteEnv, name = "Sam") {
  const response = await post(env, "/api/me", invite, { name });
  expect(response.status).toBe(200);
  return {
    cookie: cookieOf(response),
    me: (await response.json()) as { link: string; unlocked: string[]; name: string },
  };
}

describe("players on the test site", () => {
  it("asks someone in on the shared invite link for their name, then gives them their own link", async () => {
    const env = site();
    const before = await (await call(env, "/api/me", invite)).json();
    expect(before).toMatchObject({ saving: true, needsName: true, unlocked: ["rhino"] });

    const { cookie, me } = await newPlayer(env, "  Sam   Jones ");
    expect(cookie.startsWith(`${PLAYER_COOKIE}=`)).toBe(true);
    expect(me.name).toBe("Sam Jones");
    expect(me.link).toMatch(new RegExp(`^${ORIGIN}/p/[\\w-]{32}$`));

    // The player cookie alone is enough to get in, without the shared invite's.
    expect((await call(env, "/battle/", cookie)).status).toBe(200);
    expect(await (await call(env, "/api/me", cookie)).json()).toMatchObject({ needsName: false, name: "Sam Jones" });
  });

  it("lets a player in on another device from their own link, as often as they like", async () => {
    const env = site();
    const { me } = await newPlayer(env);
    const path = new URL(me.link).pathname;
    for (let i = 0; i < 2; i++) {
      const response = await call(env, path);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/battle/");
      expect(cookieOf(response)).toBe(`${PLAYER_COOKIE}=${path.slice(3)}`);
    }
    expect((await call(env, "/p/not-a-real-token")).status).toBe(403);
  });

  it("refuses to make a player without an invite, and a name that is blank", async () => {
    const env = site();
    expect((await post(env, "/api/me", "", { name: "Sam" })).status).toBe(403);
    expect((await post(env, "/api/me", invite, { name: "   " })).status).toBe(400);
  });

  it("opens Klaw once Rhino is beaten and Ultron once Klaw is, and says so", async () => {
    const env = site();
    const { cookie } = await newPlayer(env);
    let saved = await (await post(env, "/api/games", cookie, game("rhino", "loss"))).json();
    expect(saved).toMatchObject({ saved: true, unlocked: ["rhino"], newlyUnlocked: [], versus: { won: 0, lost: 1 } });
    saved = await (await post(env, "/api/games", cookie, game("rhino", "win"))).json();
    expect(saved).toMatchObject({ unlocked: ["rhino", "klaw"], newlyUnlocked: ["Klaw"], versus: { won: 1, lost: 1 } });
    saved = await (await post(env, "/api/games", cookie, game("klaw", "win"))).json();
    expect(saved).toMatchObject({ unlocked: ["rhino", "klaw", "ultron"], newlyUnlocked: ["Ultron"] });
    expect((await (await call(env, "/api/me", cookie)).json()).unlocked).toEqual(["rhino", "klaw", "ultron"]);
  });

  it("counts a game once, with its last ending, when an ending is undone and played out again", async () => {
    const env = site();
    const { cookie } = await newPlayer(env);
    const lost = game("rhino", "loss");
    await post(env, "/api/games", cookie, lost);
    await post(env, "/api/games", cookie, { ...lost, result: "win", reason: "villainDefeated", rounds: 9 });
    const record = await (await call(env, "/api/record", cookie)).json();
    expect(record.total).toEqual({ played: 1, won: 1, lost: 0 });
    expect(record.recent[0]).toMatchObject({ villain: "Rhino", result: "win", rounds: 9, hero: "Spider-Man" });
  });

  it("refuses a game report that doesn't read right", async () => {
    const env = site();
    const { cookie } = await newPlayer(env);
    expect((await post(env, "/api/games", cookie, { ...game("rhino", "win"), result: "draw" })).status).toBe(400);
    expect((await post(env, "/api/games", invite, game("rhino", "win"))).status).toBe(403);
  });

  it("keeps a player's games apart from another's", async () => {
    const env = site();
    const sam = await newPlayer(env, "Sam");
    const jo = await newPlayer(env, "Jo");
    await post(env, "/api/games", sam.cookie, game("rhino", "win"));
    expect((await (await call(env, "/api/record", jo.cookie)).json()).total.played).toBe(0);
    expect((await (await call(env, "/api/me", jo.cookie)).json()).unlocked).toEqual(["rhino"]);
  });

  it("shuts a switched-off link out, and lets it back in when switched on", async () => {
    const env = site();
    const { cookie, me } = await newPlayer(env);
    const adminIn = cookieOf(await call(env, `/admin/${ADMIN}`));
    expect(adminIn).toBe(`${ADMIN_COOKIE}=${ADMIN}`);
    const page = await (await call(env, "/admin", adminIn)).text();
    const id = /name="id" value="([^"]+)"/.exec(page)![1]!;
    const form = (action: string) => new URLSearchParams({ action, id }).toString();
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    await call(env, "/admin", adminIn, { method: "POST", headers, body: form("off") });
    expect((await call(env, "/battle/", cookie)).status).toBe(403);
    expect((await call(env, new URL(me.link).pathname)).status).toBe(403);
    await call(env, "/admin", adminIn, { method: "POST", headers, body: form("on") });
    expect((await call(env, "/battle/", cookie)).status).toBe(200);
  });

  it("lets Adam add a player on the players page and shows their link and record", async () => {
    const env = site();
    const adminIn = cookieOf(await call(env, `/admin/${ADMIN}`));
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    const added = await call(env, "/admin", adminIn, {
      method: "POST",
      headers,
      body: "action=add&name=Alex%20%3Cb%3E",
    });
    expect(added.status).toBe(303);
    const page = await (
      await call(
        env,
        new URL(added.headers.get("location")!).pathname + new URL(added.headers.get("location")!).search,
        adminIn,
      )
    ).text();
    expect(page).toContain("Alex &lt;b&gt;");
    expect(page).toContain('class="added"');
    const link = /<code>([^<]+)<\/code>/.exec(page)![1]!;
    const cookie = cookieOf(await call(env, new URL(link).pathname));
    await post(env, "/api/games", cookie, game("rhino", "win"));
    const after = await (await call(env, "/admin", adminIn)).text();
    expect(after).toContain("Villain beaten");
    expect(after).toContain("100%");
  });

  it("keeps the players page from anyone without Adam's key", async () => {
    const env = site();
    const { cookie } = await newPlayer(env);
    expect((await call(env, "/admin", cookie)).status).toBe(403);
    expect((await call(env, "/admin/wrong-key")).status).toBe(403);
    expect((await call(env, `/admin/${ADMIN}`, undefined)).status).toBe(302);
    expect((await call(env, "/admin/x", undefined)).status).toBe(403);
    const noAdmin = { ...site(), ADMIN_KEY: undefined };
    expect((await call(noAdmin, "/admin/", undefined)).status).toBe(403);
  });

  it("plays on with nothing saved and nothing locked when the site has no database", async () => {
    const env = { ...site(), DB: undefined };
    expect(await (await call(env, "/api/me", invite)).json()).toMatchObject({
      saving: false,
      needsName: false,
      unlocked: ["rhino", "klaw", "ultron"],
    });
    expect(await (await post(env, "/api/games", invite, game("rhino", "win"))).json()).toEqual({ saved: false });
    expect((await call(env, "/p/anything")).status).toBe(403);
  });
});

describe("a player's record", () => {
  const row = (villain: string, result: "win" | "loss", hero = "Spider-Man", ended = 0): GameRow => ({
    player_id: "p",
    game_id: `${villain}-${result}-${ended}`,
    hero,
    villain,
    result,
    reason: "x",
    rounds: 5,
    version: "0.2.0",
    deck: "[]",
    started_at: ended - 60000 * 12,
    ended_at: ended,
  });

  it("tallies overall, per villain and per hero", () => {
    const record = recordOf([
      row("klaw", "loss", "Spider-Man", 3),
      row("rhino", "win", "Spider-Man", 2),
      row("rhino", "loss", "Iron Man", 1),
    ]);
    expect(record.total).toEqual({ played: 3, won: 1, lost: 2 });
    expect(record.byVillain.map((v) => [v.name, v.tally.won, v.tally.lost])).toEqual([
      ["Rhino", 1, 1],
      ["Klaw", 0, 1],
    ]);
    expect(record.byHero.map((h) => [h.hero, h.tally.played])).toEqual([
      ["Spider-Man", 2],
      ["Iron Man", 1],
    ]);
    expect(record.recent[0]).toMatchObject({ villain: "Klaw", minutes: 12 });
  });

  it("never skips a villain in the order", () => {
    expect(unlockedFrom([row("klaw", "win")])).toEqual(["rhino"]);
    expect(unlockedFrom([])).toEqual(["rhino"]);
  });
});

const FACTS = {
  v: 1,
  difficulty: "standard",
  modules: ["bomb_scare"],
  heroId: "01001a",
  aspects: ["justice"],
  deckSize: 40,
  starterDeck: "core-spider-man-justice",
  heroHp: 4,
  form: "hero",
  alliesPlayed: 2,
  undo: false,
  lastBlow: { cardId: "01001a", name: "Spider-Man" },
};

describe("the facts column", () => {
  /** The live `games` table as it was made before the facts (2026-11-24), with a game in it. */
  function oldShape() {
    const raw = new DatabaseSync(":memory:");
    raw.exec(`CREATE TABLE games (
      player_id TEXT NOT NULL, game_id TEXT NOT NULL, hero TEXT NOT NULL, villain TEXT NOT NULL, result TEXT NOT NULL,
      reason TEXT NOT NULL, rounds INTEGER NOT NULL, version TEXT NOT NULL, deck TEXT NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, PRIMARY KEY (player_id, game_id))`);
    raw.exec(`INSERT INTO games VALUES ('p1', 'g1', 'Spider-Man', 'rhino', 'win', 'villainDefeated', 6, '0.2.0',
      '["core-spider-man-justice"]', 1000, 2000)`);
    return raw;
  }
  const columns = (raw: DatabaseSync) =>
    (raw.prepare("PRAGMA table_info(games)").all() as { name: string }[]).map((c) => c.name);

  it("is added to a table made before it, and adding it again does nothing", async () => {
    const raw = oldShape();
    const db = sqliteD1(raw);
    await addFactsColumn(db);
    await addFactsColumn(db);
    expect(columns(raw).filter((c) => c === "facts")).toHaveLength(1);
    // The game saved before it is still there, with no facts.
    expect(raw.prepare("SELECT game_id, facts FROM games").all()).toEqual([{ game_id: "g1", facts: null }]);
  });

  it("is added at start by each worker, on an old table and on one that has it already", async () => {
    const raw = oldShape();
    await ensureSchema(sqliteD1(raw));
    // A second worker (its own connection object) starting on the table that now has the column.
    await ensureSchema(sqliteD1(raw));
    expect(columns(raw)).toContain("facts");
    const fresh = new DatabaseSync(":memory:");
    await ensureSchema(sqliteD1(fresh));
    await ensureSchema(sqliteD1(fresh));
    expect(columns(fresh).filter((c) => c === "facts")).toHaveLength(1);
  });

  it("keeps a game's facts, replaces them when the ending is played out again, and hands them back", async () => {
    const env = site();
    const { cookie } = await newPlayer(env);
    const first = game("rhino", "loss", { facts: { ...FACTS, heroHp: 0, form: "alterEgo" } });
    await post(env, "/api/games", cookie, first);
    await post(env, "/api/games", cookie, { ...first, result: "win", reason: "villainDefeated", facts: FACTS });
    const body = (await (await call(env, "/api/games", cookie)).json()) as { games: Record<string, unknown>[] };
    expect(body.games).toHaveLength(1);
    expect(body.games[0]).toMatchObject({ id: first.id, villain: "rhino", result: "win", facts: FACTS });
    expect(body.games[0]!.deck).toEqual(["Web-Shooter", "Black Cat"]);
  });

  it("still saves a game from a page made before the facts, and one whose facts don't read right, without them", async () => {
    const env = site();
    const { cookie } = await newPlayer(env);
    expect((await post(env, "/api/games", cookie, game("rhino", "win"))).status).toBe(200);
    const odd = game("rhino", "loss", { facts: { ...FACTS, heroHp: "lots" } });
    expect((await post(env, "/api/games", cookie, odd)).status).toBe(200);
    const body = (await (await call(env, "/api/games", cookie)).json()) as { games: { facts: unknown }[] };
    expect(body.games.map((g) => g.facts)).toEqual([null, null]);
  });

  it("lists games only for a player who is signed in", async () => {
    const env = site();
    expect((await call(env, "/api/games", invite)).status).toBe(403);
  });
});
