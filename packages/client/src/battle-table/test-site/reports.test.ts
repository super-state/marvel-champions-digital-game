import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { handleTableSiteRequest, INVITE_COOKIE, type TableSiteEnv } from "./gate.js";
import type { D1Like, D1Statement } from "./players.js";
import { HOURLY_LIMIT } from "./reports.js";

/** Cloudflare D1's statement API over node:sqlite, so the real SQL runs in the tests (as players.test.ts). */
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
const ORIGIN = "https://table.example";
const invite = `${INVITE_COOKIE}=${KEY}`;

function site(db: D1Like | undefined = sqliteD1()): TableSiteEnv {
  return {
    INVITE_KEY: KEY,
    ADMIN_KEY: ADMIN,
    DB: db,
    ASSETS: { fetch: async () => new Response("page", { status: 200, headers: { "content-type": "text/html" } }) },
  };
}
function call(env: TableSiteEnv, path: string, cookie?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return handleTableSiteRequest(new Request(`${ORIGIN}${path}`, { ...init, headers }), env);
}
const post = (env: TableSiteEnv, path: string, cookie: string | undefined, body: unknown) =>
  call(env, path, cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const cookieOf = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0]!;

async function newPlayer(env: TableSiteEnv, name = "Sam") {
  return cookieOf(await post(env, "/api/me", invite, { name }));
}

const moment = (extra: Record<string, unknown> = {}) => ({
  version: "0.2.3",
  page: "/battle/",
  inGame: true,
  hero: "Spider-Man",
  villain: "Rhino",
  difficulty: "standard",
  modules: ["Bomb Scare"],
  seed: 75,
  round: 3,
  turn: "player",
  setup: false,
  outcome: null,
  heroHp: 9,
  villainHp: 11,
  heroCard: "Spider-Man",
  villainCard: "Rhino",
  hand: ["Backflip"],
  inPlay: [],
  enemies: ["The Break-In! 2/7 threat"],
  asking: "",
  log: ["Rhino attacks"],
  screen: { width: 1440, height: 900, pixelRatio: 2 },
  input: "mouse",
  browser: "test",
  ...extra,
});

describe("bug reports on the test site", () => {
  it("keeps a player's report, engine state and all, and lists it on Adam's players page", async () => {
    const env = site();
    const cookie = await newPlayer(env, "Sam <i>");
    // An engine state is far bigger than any other call's body (the others stop at 20,000 characters).
    const state = { zones: "x".repeat(150_000) };
    const sent = await post(env, "/api/reports", cookie, {
      text: "Web-Shooter didn't stop it",
      moment: moment({ state }),
    });
    expect(sent.status).toBe(200);
    const { id } = (await sent.json()) as { id: string };
    expect(id).toMatch(/^r-/);

    const row = (await env
      .DB!.prepare("SELECT from_name, text, moment, issue FROM reports WHERE id = ?")
      .bind(id)
      .first()) as { from_name: string; text: string; moment: string; issue: string | null };
    expect(row).toMatchObject({ from_name: "Sam <i>", text: "Web-Shooter didn't stop it", issue: null });
    expect(JSON.parse(row.moment)).toMatchObject({ hero: "Spider-Man", round: 3, state });

    const adminIn = cookieOf(await call(env, `/admin/${ADMIN}`));
    const page = await (await call(env, "/admin", adminIn)).text();
    expect(page).toContain("Bug reports");
    expect(page).toContain("Web-Shooter didn&#39;t stop it");
    expect(page).toContain("Sam &lt;i&gt;");
    expect(page).toContain("Spider-Man vs Rhino, round 3");
    expect(page).toContain("Not filed yet");
  });

  it("takes a report from someone on the invite link who hasn't given a name, and from Adam", async () => {
    const env = site();
    expect((await post(env, "/api/reports", invite, { text: "Hi", moment: moment() })).status).toBe(200);
    const adminIn = cookieOf(await call(env, `/admin/${ADMIN}`));
    expect((await post(env, "/api/reports", adminIn, { text: "Hi", moment: moment() })).status).toBe(200);
    const page = await (await call(env, "/admin", adminIn)).text();
    expect(page).toContain("Someone on the invite link");
    expect(page).toContain("Adam (admin)");
  });

  it("never takes a report from outside the invite", async () => {
    const env = site();
    expect((await post(env, "/api/reports", undefined, { text: "Hi", moment: moment() })).status).toBe(403);
  });

  it("refuses a report with no words, and one too big to be a report", async () => {
    const env = site();
    const cookie = await newPlayer(env);
    expect((await post(env, "/api/reports", cookie, { text: "   ", moment: moment() })).status).toBe(400);
    const huge = { text: "big", moment: moment({ state: "x".repeat(1_000_000) }) };
    expect((await post(env, "/api/reports", cookie, huge)).status).toBe(400);
  });

  it(`stops a player at ${HOURLY_LIMIT} reports an hour`, async () => {
    const env = site();
    const cookie = await newPlayer(env);
    for (let i = 0; i < HOURLY_LIMIT; i++)
      expect((await post(env, "/api/reports", cookie, { text: `report ${i}`, moment: moment() })).status).toBe(200);
    expect((await post(env, "/api/reports", cookie, { text: "one more", moment: moment() })).status).toBe(429);
    // Someone else can still send theirs.
    const other = await newPlayer(env, "Alex");
    expect((await post(env, "/api/reports", other, { text: "mine", moment: moment() })).status).toBe(200);
  });

  it("says reports can't be kept when the site has no database", async () => {
    // (site(undefined) would take the default database.)
    const env = { ...site(), DB: undefined };
    expect((await post(env, "/api/reports", invite, { text: "Hi", moment: moment() })).status).toBe(503);
  });
});
