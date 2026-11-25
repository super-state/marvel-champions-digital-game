import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTableSiteRequest, INVITE_COOKIE, type SiteContext, type TableSiteEnv } from "./gate.js";
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
function call(env: TableSiteEnv, path: string, cookie?: string, init: RequestInit = {}, ctx?: SiteContext) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return handleTableSiteRequest(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx);
}
const post = (env: TableSiteEnv, path: string, cookie: string | undefined, body: unknown, ctx?: SiteContext) =>
  call(
    env,
    path,
    cookie,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    ctx,
  );
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

/** A pretend GitHub: answers the issue calls the site makes, and keeps what it was sent. */
function fakeGitHub(answers: { create?: (n: number) => Response | Error } = {}) {
  const issues: { title: string; body: string; labels: { name: string }[]; html_url: string }[] = [];
  const calls: { method: string; url: string; headers: Headers }[] = [];
  let creates = 0;
  const made = (sent: { title: string; body: string; labels: string[] }) => {
    const issue = {
      title: sent.title,
      body: sent.body,
      labels: sent.labels.map((name) => ({ name })),
      html_url: `https://github.com/super-state/marvel-champions-digital-game/issues/${900 + issues.length}`,
    };
    issues.push(issue);
    return issue;
  };
  const fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ method, url, headers: new Headers(init.headers) });
    if (method === "POST" && url.endsWith("/repos/super-state/marvel-champions-digital-game/issues")) {
      const answer = answers.create?.(++creates);
      const sent = JSON.parse(String(init.body)) as { title: string; body: string; labels: string[] };
      if (answer instanceof Error) throw answer;
      if (answer && !answer.ok) {
        // A 502 that made the issue anyway (GitHub did that on 2026-11-25).
        if (answer.status === 502) made(sent);
        return answer;
      }
      return Response.json(made(sent), { status: 201 });
    }
    if (method === "GET" && url.includes("/issues?labels=player%20report&state=all")) return Response.json(issues);
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return { issues, calls, fetch, creates: () => creates };
}

/** The Worker's waitUntil, kept so a test can wait for the filing to finish. */
function workerContext() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (work: Promise<unknown>) => void pending.push(work) },
    settle: () => Promise.all(pending),
  };
}

const issueOf = async (env: TableSiteEnv, id: string) =>
  ((await env.DB!.prepare("SELECT issue FROM reports WHERE id = ?").bind(id).first()) as { issue: string | null })
    .issue;

const idOf = async (response: Response) => ((await response.json()) as { id: string }).id;

describe("the test site files reports on GitHub itself", () => {
  afterEach(() => vi.unstubAllGlobals());
  const withToken = (): TableSiteEnv => ({ ...site(), REPORTS_GITHUB_TOKEN: "test-token" });

  it("files a report as it arrives, after answering, and notes the issue on the players page", async () => {
    const github = fakeGitHub();
    const env = withToken();
    const cookie = await newPlayer(env, "Sam");
    const { ctx, settle } = workerContext();
    const text = "Rhino @everyone hit twice";
    const sent = await post(env, "/api/reports", cookie, { text, moment: moment({ state: { a: 1 } }) }, ctx);
    expect(sent.status).toBe(200);
    const id = await idOf(sent);
    // The answer went before the filing: nothing on GitHub until the Worker's waitUntil work runs.
    await settle();

    expect(github.issues).toHaveLength(1);
    const [issue] = github.issues;
    expect(issue!.title).toBe("Player report: Rhino @​everyone hit twice");
    expect(issue!.labels).toEqual([{ name: "player report" }]);
    expect(issue!.body).toContain(`report \`${id}\``);
    expect(issue!.body).toContain("**From** Sam");
    // The engine state stays on the site, behind Adam's login: no gist.
    expect(issue!.body).toContain(`(${ORIGIN}/api/reports/${id}/state), kept with the report on the test site`);
    expect(await issueOf(env, id)).toBe(issue!.html_url);

    // GitHub refuses a call without these (a Worker's fetch sends no User-Agent of its own).
    const create = github.calls.find((c) => c.method === "POST")!;
    expect(create.headers.get("authorization")).toBe("Bearer test-token");
    expect(create.headers.get("user-agent")).toBeTruthy();
    expect(create.headers.get("accept")).toBe("application/vnd.github+json");
    expect(create.headers.get("x-github-api-version")).toBe("2022-11-28");

    const adminIn = cookieOf(await call(env, `/admin/${ADMIN}`));
    expect(await (await call(env, "/admin", adminIn)).text()).toContain(`<a href="${issue!.html_url}">On GitHub</a>`);
  });

  it("keeps the report unfiled when GitHub is down, and still tells the player it was sent", async () => {
    const github = fakeGitHub({ create: () => new Response("down", { status: 503 }) });
    const env = withToken();
    const cookie = await newPlayer(env);
    const { ctx, settle } = workerContext();
    const sent = await post(env, "/api/reports", cookie, { text: "Hi", moment: moment() }, ctx);
    expect(sent.status).toBe(200);
    const id = await idOf(sent);
    await settle();
    expect(github.creates()).toBe(3);
    expect(github.issues).toHaveLength(0);
    expect(await issueOf(env, id)).toBeNull();
  });

  it("keeps the report unfiled when GitHub can't be reached at all", async () => {
    const github = fakeGitHub({ create: () => new Error("network down") });
    const env = withToken();
    const cookie = await newPlayer(env);
    const { ctx, settle } = workerContext();
    const id = await idOf(await post(env, "/api/reports", cookie, { text: "Hi", moment: moment() }, ctx));
    await settle();
    expect(github.creates()).toBe(3);
    expect(await issueOf(env, id)).toBeNull();
  });

  it("doesn't file twice when GitHub made the issue but answered with an error", async () => {
    const github = fakeGitHub({
      create: (n) => (n === 1 ? new Response("bad gateway", { status: 502 }) : new Response(null)),
    });
    const env = withToken();
    const cookie = await newPlayer(env);
    const { ctx, settle } = workerContext();
    const id = await idOf(await post(env, "/api/reports", cookie, { text: "Hi", moment: moment() }, ctx));
    await settle();
    expect(github.creates()).toBe(1);
    expect(github.issues).toHaveLength(1);
    expect(await issueOf(env, id)).toBe(github.issues[0]!.html_url);
  });

  it("stops at a refusal (a token run out) and leaves the report for pnpm table:reports", async () => {
    const github = fakeGitHub({ create: () => new Response("Bad credentials", { status: 401 }) });
    const env = withToken();
    const cookie = await newPlayer(env);
    const { ctx, settle } = workerContext();
    const id = await idOf(await post(env, "/api/reports", cookie, { text: "Hi", moment: moment() }, ctx));
    await settle();
    expect(github.creates()).toBe(1);
    expect(await issueOf(env, id)).toBeNull();
  });

  it("files nothing without the token", async () => {
    const github = fakeGitHub();
    const env = site();
    const cookie = await newPlayer(env);
    const { ctx, settle } = workerContext();
    expect((await post(env, "/api/reports", cookie, { text: "Hi", moment: moment() }, ctx)).status).toBe(200);
    await settle();
    expect(github.fetch).not.toHaveBeenCalled();
  });

  it("opens a report's engine state to Adam only", async () => {
    fakeGitHub();
    const env = withToken();
    const cookie = await newPlayer(env);
    const state = { zones: ["hand", "deck"], round: 3 };
    const id = await idOf(await post(env, "/api/reports", cookie, { text: "Hi", moment: moment({ state }) }));
    const adminIn = cookieOf(await call(env, `/admin/${ADMIN}`));
    const opened = await call(env, `/api/reports/${id}/state`, adminIn);
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual(state);
    expect((await call(env, `/api/reports/${id}/state`, cookie)).status).toBe(403);
    expect((await call(env, `/api/reports/${id}/state`, invite)).status).toBe(403);
    expect((await call(env, `/api/reports/${id}/state`)).status).toBe(403);
    expect((await call(env, "/api/reports/r-none/state", adminIn)).status).toBe(404);
  });
});
