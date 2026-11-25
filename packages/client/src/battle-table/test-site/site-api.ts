/**
 * The test site's small API (`/api/...`) and Adam's players page (`/admin`), behind the invite lock (gate.ts). The
 * data and its rules are in players.ts.
 *
 *   GET  /api/me       who this browser is: name, own link, open villains, whether saving works
 *   POST /api/me       { name }: become a player (from the shared invite link) or change your name
 *   POST /api/games    a finished game (saved, or updated when the same game ends again)
 *   GET  /api/record   this player's record
 *   POST /api/reports  a bug report from the menu's "Report a bug": the player's words and the moment (reports.ts),
 *                      filed on GitHub straight after the answer when the site has its token (file-report.ts)
 *   GET  /api/reports/<id>/state  Adam only: the engine state kept with a report (its issue links here)
 *   GET  /admin        every player, their record and link; POST adds a player or switches a link off/on
 */
import {
  allGames,
  allPlayers,
  cleanName,
  createPlayer,
  gamesOf,
  parseGameReport,
  playerByToken,
  recordOf,
  renamePlayer,
  saveGame,
  setDisabled,
  unlockedFrom,
  villainName,
  VILLAIN_CHAIN,
  type D1Like,
  type GameRow,
  type PlayerRow,
} from "./players.js";

import { parseReport, REPORT_LIMIT } from "../report/moment.js";
import { latestReports, reportState, saveReport, type ReportRow } from "./reports.js";
import { fileSiteReport, type GitHubFiling } from "./file-report.js";

export { ADMIN_COOKIE, ADMIN_PREFIX, PLAYER_COOKIE, PLAYER_PREFIX } from "./players.js";
import { PLAYER_COOKIE, PLAYER_PREFIX } from "./players.js";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const playerFromCookie = (db: D1Like, token: string) => playerByToken(db, token);

export interface Visitor {
  /** Holds the shared invite link's cookie. */
  invited: boolean;
  /** Holds Adam's admin cookie. */
  admin: boolean;
  /** The player this browser is signed in as. */
  player: PlayerRow | null;
}

export interface Me {
  /** The site can save games (its database is there). */
  saving: boolean;
  /** Asked for on first open: someone in on the shared invite link (or Adam) who isn't a player yet. */
  needsName: boolean;
  name: string | null;
  /** Their own link: their login on any device. */
  link: string | null;
  /** The villains open to them, in order. */
  unlocked: string[];
  admin: boolean;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

const playerLink = (origin: string, p: PlayerRow) => `${origin}${PLAYER_PREFIX}${encodeURIComponent(p.token)}`;

async function me(db: D1Like | undefined, who: Visitor, origin: string): Promise<Me> {
  if (!db)
    return { saving: false, needsName: false, name: null, link: null, unlocked: [...VILLAIN_CHAIN], admin: who.admin };
  const p = who.player;
  const unlocked = who.admin ? [...VILLAIN_CHAIN] : p ? unlockedFrom(await gamesOf(db, p.id)) : [VILLAIN_CHAIN[0]];
  return {
    saving: true,
    needsName: !p,
    name: p?.name ?? null,
    link: p ? playerLink(origin, p) : null,
    unlocked,
    admin: who.admin,
  };
}

async function readJson(request: Request, limit = 20_000): Promise<unknown> {
  // Only a JSON body: a form posted from another site can't send one (and SameSite cookies keep it out anyway).
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return null;
  const text = await request.text();
  if (text.length > limit) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface ApiOptions {
  /** Files each new report on GitHub; unset (no token), reports wait in the database for `pnpm table:reports`. */
  github?: GitHubFiling | undefined;
  /** Runs work after the answer has gone (the Worker's `waitUntil`); unset, the work is awaited before answering. */
  defer?: ((work: Promise<unknown>) => void) | undefined;
}

const STATE_ROUTE = /^\/api\/reports\/([^/]+)\/state$/;

export async function handleApi(
  request: Request,
  db: D1Like | undefined,
  who: Visitor,
  options: ApiOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname.replace(/\/$/, "")}`;
  try {
    const stateOf = request.method === "GET" ? STATE_ROUTE.exec(url.pathname) : null;
    if (stateOf) {
      if (!db || !who.admin) return json({ error: "Only Adam can open a report's engine state." }, 403);
      const state = await reportState(db, decodeURIComponent(stateOf[1]!));
      return state === null
        ? json({ error: "No engine state kept for that report." }, 404)
        : new Response(state, {
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          });
    }
    switch (route) {
      case "GET /api/me":
        return json(await me(db, who, url.origin));

      case "POST /api/me": {
        if (!db) return json({ error: "Saving isn't switched on." }, 503);
        const body = (await readJson(request)) as { name?: unknown } | null;
        const name = cleanName(body?.name);
        if (!name) return json({ error: "Type a name." }, 400);
        if (who.player) {
          await renamePlayer(db, who.player.id, name);
          return json(await me(db, { ...who, player: { ...who.player, name } }, url.origin));
        }
        if (!who.invited && !who.admin) return json({ error: "Not invited." }, 403);
        const player = await createPlayer(db, name);
        const cookie = `${PLAYER_COOKIE}=${encodeURIComponent(player.token)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
        return json(await me(db, { ...who, player }, url.origin), 200, { "set-cookie": cookie });
      }

      case "POST /api/games": {
        if (!db) return json({ saved: false });
        if (!who.player) return json({ error: "Not signed in." }, 403);
        const game = parseGameReport(await readJson(request));
        if (!game) return json({ error: "That game doesn't read right." }, 400);
        const before = unlockedFrom(await gamesOf(db, who.player.id));
        await saveGame(db, who.player.id, game);
        const games = await gamesOf(db, who.player.id);
        const unlocked = unlockedFrom(games);
        const versus = games.filter((g) => g.villain === game.villain);
        return json({
          saved: true,
          unlocked: who.admin ? [...VILLAIN_CHAIN] : unlocked,
          newlyUnlocked: unlocked.filter((v) => !before.includes(v)).map(villainName),
          versus: {
            won: versus.filter((g) => g.result === "win").length,
            lost: versus.filter((g) => g.result === "loss").length,
          },
        });
      }

      case "POST /api/reports": {
        if (!db) return json({ error: "Reports can't be kept on this site yet." }, 503);
        // A report with the engine state is far bigger than the other calls' bodies: its own cap.
        const report = parseReport(await readJson(request, REPORT_LIMIT));
        if (!report) return json({ error: "Type what happened first (and keep it short of a novel)." }, 400);
        const sender = who.player
          ? { key: who.player.id, name: who.player.name }
          : who.admin
            ? { key: "admin", name: "Adam (admin)" }
            : { key: "invited", name: "Someone on the invite link" };
        const saved = await saveReport(db, sender, report);
        if (!saved) return json({ error: "That's a lot of reports in an hour: try again a bit later." }, 429);
        if (options.github) {
          const record = { id: saved.id, from: saved.from_name, at: saved.at, text: saved.text, moment: report.moment };
          const filing = fileSiteReport(db, record, options.github, url.origin);
          if (options.defer) options.defer(filing);
          else await filing;
        }
        return json({ saved: true, id: saved.id });
      }

      case "GET /api/record": {
        if (!db || !who.player) return json({ error: "Not signed in." }, 403);
        const games = await gamesOf(db, who.player.id);
        return json({ name: who.player.name, link: playerLink(url.origin, who.player), ...recordOf(games) });
      }
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: "Something went wrong saving that." }, 500);
  }
}

// ── Adam's players page ──────────────────────────────────────────────────────────────────────────────────────────

const esc = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const REASONS: Record<string, string> = {
  villainDefeated: "Villain beaten",
  mainSchemeCompleted: "Scheme completed",
  allPlayersDefeated: "Hero knocked out",
};
const reasonText = (reason: string) => REASONS[reason] ?? reason;

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const pct = (won: number, played: number) => (played ? `${Math.round((won / played) * 100)}%` : "–");
const wl = (games: readonly GameRow[]) => {
  const won = games.filter((g) => g.result === "win").length;
  return games.length ? `${won}–${games.length - won}` : "–";
};

type ReportLine = Omit<ReportRow, "moment"> & { version: string | null; game: string };

export function adminPage(
  players: readonly PlayerRow[],
  games: readonly GameRow[],
  origin: string,
  added?: string,
  reports: readonly ReportLine[] = [],
) {
  const names = new Map(players.map((p) => [p.id, p.name]));
  const rows = players
    .map((p) => {
      const mine = games.filter((g) => g.player_id === p.id);
      const won = mine.filter((g) => g.result === "win").length;
      const link = playerLink(origin, p);
      const open = unlockedFrom(mine).map(villainName).join(", ");
      const mail = `mailto:?subject=${encodeURIComponent("Marvel Champions: your link")}&body=${encodeURIComponent(
        `Open this on your laptop to play (it's your login, keep it to yourself):\n\n${link}\n`,
      )}`;
      const classes = [p.id === added ? "added" : "", p.disabled ? "off" : ""].filter(Boolean).join(" ");
      return `<tr${classes ? ` class="${classes}"` : ""}>
        <td><b>${esc(p.name)}</b>${p.disabled ? " <small>(link off)</small>" : ""}</td>
        <td class="link"><code>${esc(link)}</code><br><button type="button" data-copy="${esc(link)}">Copy link</button> <a href="${esc(mail)}">Email it</a></td>
        <td>${mine.length}</td><td>${won}</td><td>${mine.length - won}</td><td>${pct(won, mine.length)}</td>
        ${VILLAIN_CHAIN.map((v) => `<td>${wl(mine.filter((g) => g.villain === v))}</td>`).join("")}
        <td>${esc(open)}</td>
        <td>${mine[0] ? esc(when(mine[0].ended_at)) : "–"}</td>
        <td><form method="post"><input type="hidden" name="id" value="${esc(p.id)}">
          <button name="action" value="${p.disabled ? "on" : "off"}">${p.disabled ? "Switch link on" : "Switch link off"}</button></form></td>
      </tr>`;
    })
    .join("");
  const latest = games
    .slice(0, 50)
    .map(
      (g) => `<tr><td>${esc(when(g.ended_at))}</td><td>${esc(names.get(g.player_id) ?? "?")}</td>
        <td>${esc(g.hero)} vs ${esc(villainName(g.villain))}</td>
        <td class="${g.result}">${g.result === "win" ? "Won" : "Lost"}</td><td>${esc(reasonText(g.reason))}</td>
        <td>${g.rounds}</td><td>${Math.max(0, Math.round((g.ended_at - g.started_at) / 60000))} min</td><td>v${esc(g.version)}</td></tr>`,
    )
    .join("");
  const reportRows = reports
    .map(
      (r) => `<tr><td>${esc(when(r.at))}</td><td>${esc(r.from_name)}</td>
        <td class="words">${esc(r.text.length > 400 ? `${r.text.slice(0, 400)}…` : r.text)}</td>
        <td>${esc(r.game ?? "")}</td><td>${r.version ? `v${esc(r.version)}` : "–"}</td>
        <td>${r.issue ? `<a href="${esc(r.issue)}">On GitHub</a>` : `<small>Not filed yet</small>`}</td></tr>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Players</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px 16px 48px; background: #070c12; color: #d8e2ec; font: 15px/1.45 system-ui, sans-serif; }
  main { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 32px 0 8px; }
  p.lead { color: #8a9bb0; margin: 0 0 20px; }
  form.add { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; }
  input[type=text] { background: #0f1822; color: inherit; border: 1px solid #2a3a4c; border-radius: 6px; padding: 8px 10px; font: inherit; min-width: 220px; }
  button { background: #1d6fd8; color: #fff; border: 0; border-radius: 6px; padding: 7px 12px; font: inherit; cursor: pointer; }
  td button { background: #223246; padding: 4px 9px; font-size: 13px; }
  a { color: #7fb4ff; font-size: 13px; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #18232f; vertical-align: top; white-space: nowrap; }
  th { color: #8a9bb0; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td.link code { user-select: all; display: inline-block; max-width: 240px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; font-size: 12px; color: #9fb3c8; }
  tr.added td { background: #10263d; } tr.off td { opacity: .5; }
  td.win { color: #7bd88f; } td.loss { color: #ff8a80; }
  .empty { color: #8a9bb0; }
  td.words { white-space: pre-wrap; min-width: 280px; max-width: 520px; }
</style>
<main>
  <h1>Players</h1>
  <p class="lead">Everyone who plays the test table, their record, and their own link. A link is that person's login on any device: send it to them, and switch it off if it gets passed around.</p>
  <form class="add" method="post"><input type="hidden" name="action" value="add">
    <input type="text" name="name" placeholder="Name of a new player" maxlength="40" required>
    <button>Add player and make their link</button></form>
  <div class="scroll"><table>
    <tr><th>Player</th><th>Their link</th><th>Games</th><th>Won</th><th>Lost</th><th>Win rate</th>
      ${VILLAIN_CHAIN.map((v) => `<th>vs ${villainName(v)}</th>`).join("")}<th>Unlocked</th><th>Last played</th><th></th></tr>
    ${rows || `<tr><td colspan="12" class="empty">No players yet.</td></tr>`}
  </table></div>
  <h2>Latest games</h2>
  <div class="scroll"><table>
    <tr><th>When</th><th>Player</th><th>Match</th><th>Result</th><th>How</th><th>Rounds</th><th>Time</th><th>Version</th></tr>
    ${latest || `<tr><td colspan="8" class="empty">No games yet.</td></tr>`}
  </table></div>
  <h2>Bug reports</h2>
  <p class="lead">Sent from the menu's Report a bug, with the moment on the table. The site files each one on GitHub as it arrives; one it couldn't (GitHub down, the token missing or run out) waits here for <code>pnpm table:reports</code>.</p>
  <div class="scroll"><table>
    <tr><th>When</th><th>From</th><th>What they wrote</th><th>Game</th><th>Version</th><th>Issue</th></tr>
    ${reportRows || `<tr><td colspan="6" class="empty">No reports yet.</td></tr>`}
  </table></div>
</main>
<script>
  // Some browsers refuse the clipboard API (Surf did, 2026-11-24): fall back to the old copy command, then to a box
  // holding the link ready selected.
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    area.remove();
    return ok;
  }
  for (const b of document.querySelectorAll("[data-copy]"))
    b.onclick = async () => {
      if (await copyText(b.dataset.copy)) b.textContent = "Copied";
      else { window.prompt("Copy this link:", b.dataset.copy); return; }
      setTimeout(() => (b.textContent = "Copy link"), 1500);
    };
</script>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

export async function handleAdmin(request: Request, db: D1Like | undefined): Promise<Response> {
  if (!db) return html("<!doctype html><meta charset='utf-8'><p>Saving isn't switched on for this site yet.</p>", 503);
  const url = new URL(request.url);
  if (request.method === "POST") {
    const form = await request.formData();
    const action = form.get("action");
    const id = String(form.get("id") ?? "");
    if (action === "add") {
      const name = cleanName(form.get("name"));
      if (!name) return Response.redirect(`${url.origin}/admin`, 303);
      const player = await createPlayer(db, name);
      return Response.redirect(`${url.origin}/admin?added=${encodeURIComponent(player.id)}`, 303);
    }
    if ((action === "off" || action === "on") && id) await setDisabled(db, id, action === "off");
    return Response.redirect(`${url.origin}/admin`, 303);
  }
  const [players, games, reports] = await Promise.all([allPlayers(db), allGames(db), latestReports(db)]);
  return html(adminPage(players, games, url.origin, url.searchParams.get("added") ?? undefined, reports));
}
