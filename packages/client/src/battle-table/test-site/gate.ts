/**
 * The invite-only lock on the 3D table's test site (https://champions-table.pages.dev, `wrangler.table.jsonc`), where a
 * friend plays a shipped version (0.0.1, 0.0.2...) while Adam builds the next one on his own PC.
 *
 * Shipped as Pages' `_worker.js`, it sees every request before any static file, so a card scan or script is locked too,
 * not only the page. A friend opens the invite link once (`/join/<key>`); that leaves a cookie holding the key and
 * lands them on the table. After that the site works like any other. Without the cookie, every address answers 403.
 *
 * The key is the Pages secret `INVITE_KEY` (`wrangler pages secret put INVITE_KEY --project-name champions-table`).
 * Changing it locks out every invite link handed out so far.
 *
 * Since 2026-11-24 a player's own link (`/p/<token>`) lets them in too, and the table keeps their games and unlocks
 * (players.ts, site-api.ts); `/admin/<ADMIN_KEY>` lets Adam into the players page, `/admin`.
 */

import type { D1Like } from "./players.js";
import {
  handleApi,
  handleAdmin,
  playerFromCookie,
  ADMIN_COOKIE,
  ADMIN_PREFIX,
  PLAYER_COOKIE,
  PLAYER_PREFIX,
} from "./site-api.js";

export interface TableSiteEnv {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly INVITE_KEY?: string;
  /** Adam's own key, for the players page (`/admin/<ADMIN_KEY>`); unset, there is no players page. */
  readonly ADMIN_KEY?: string | undefined;
  /** The players and their games (players.ts); unset, the table plays and saves nothing. */
  readonly DB?: D1Like | undefined;
}

export const INVITE_COOKIE = "mc_table_invite";
export const JOIN_PREFIX = "/join/";
const TABLE_PATH = "/battle/";
/** About a year: a friend shouldn't need the link again. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Compares two strings in time that doesn't depend on where they first differ. */
export function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A path part as text; a malformed escape reads as nothing rather than throwing. */
function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return "";
  }
}

export function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return safeDecode(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function locked(): Response {
  const page =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Invite only</title>" +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#070c12;color:#d8e2ec;' +
    'font:16px system-ui,sans-serif;text-align:center;padding:16px">' +
    "<p>This table is invite-only.<br>Open the invite link you were sent.</p></body>";
  return new Response(page, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

export function redirect(location: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", ...extra } });
}

/** Answers one request to the test site. */
export async function handleTableSiteRequest(request: Request, env: TableSiteEnv): Promise<Response> {
  const url = new URL(request.url);
  const key = env.INVITE_KEY ?? "";

  // Nothing is ever indexed, invited or not.
  if (url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
  }

  // No key set means no invites work: fail closed rather than open.
  if (!key) return locked();

  if (url.pathname.startsWith(JOIN_PREFIX)) {
    const offered = safeDecode(url.pathname.slice(JOIN_PREFIX.length).replace(/\/$/, ""));
    if (!sameKey(offered, key)) return locked();
    const cookie = `${INVITE_COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
    return redirect(TABLE_PATH, { "set-cookie": cookie });
  }

  // A player's own link: their login, on any device, as often as they like. Opening it changes nothing on the server
  // (WhatsApp's link preview opens it too), it only leaves the cookie.
  if (url.pathname.startsWith(PLAYER_PREFIX)) {
    const token = safeDecode(url.pathname.slice(PLAYER_PREFIX.length).replace(/\/$/, ""));
    if (!env.DB) return locked();
    const player = await playerFromCookie(env.DB, token).catch(() => null);
    if (!player) return locked();
    const cookie = `${PLAYER_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
    return redirect(TABLE_PATH, { "set-cookie": cookie });
  }

  // Adam's own way in to the players page.
  if (url.pathname.startsWith(ADMIN_PREFIX)) {
    const adminKey = env.ADMIN_KEY ?? "";
    const offered = safeDecode(url.pathname.slice(ADMIN_PREFIX.length).replace(/\/$/, ""));
    if (!adminKey || !sameKey(offered, adminKey)) return locked();
    const cookie = `${ADMIN_COOKIE}=${encodeURIComponent(adminKey)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
    return redirect("/admin", { "set-cookie": cookie });
  }

  const cookies = request.headers.get("cookie");
  const heldInvite = cookieValue(cookies, INVITE_COOKIE);
  const invited = heldInvite !== undefined && sameKey(heldInvite, key);
  const heldAdmin = cookieValue(cookies, ADMIN_COOKIE);
  const admin = !!env.ADMIN_KEY && heldAdmin !== undefined && sameKey(heldAdmin, env.ADMIN_KEY);
  const heldPlayer = cookieValue(cookies, PLAYER_COOKIE);
  const player = env.DB && heldPlayer ? await playerFromCookie(env.DB, heldPlayer).catch(() => null) : null;
  if (!invited && !admin && !player) return locked();

  const who = { invited, admin, player };
  if (url.pathname.startsWith("/api/")) return handleApi(request, env.DB, who);
  if (url.pathname === "/admin") {
    if (!admin) return locked();
    return handleAdmin(request, env.DB);
  }

  // The site is the 3D table: the old 2D game's front page isn't part of it.
  if (url.pathname === "/" || url.pathname === "/index.html") return redirect(TABLE_PATH);

  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex");
  // Card scans and Vite's hashed scripts never change at one address (the cache headers of cloudflare/game/_headers):
  // a browser keeps them, so a game after the first doesn't fetch them again.
  if (response.ok && /^\/(assets|card-art[^/]*)\//.test(url.pathname)) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
