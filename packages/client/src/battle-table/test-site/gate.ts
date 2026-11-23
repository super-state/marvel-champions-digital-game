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
 */

export interface TableSiteEnv {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly INVITE_KEY?: string;
}

export const INVITE_COOKIE = "mc_table_invite";
export const JOIN_PREFIX = "/join/";
const TABLE_PATH = "/battle/";
/** About a year: a friend shouldn't need the link again. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Compares two strings in time that doesn't depend on where they first differ. */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function locked(): Response {
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

function redirect(location: string, extra: Record<string, string> = {}): Response {
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
    const offered = decodeURIComponent(url.pathname.slice(JOIN_PREFIX.length).replace(/\/$/, ""));
    if (!sameKey(offered, key)) return locked();
    const cookie = `${INVITE_COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
    return redirect(TABLE_PATH, { "set-cookie": cookie });
  }

  const held = cookieValue(request.headers.get("cookie"), INVITE_COOKIE);
  if (held === undefined || !sameKey(held, key)) return locked();

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
