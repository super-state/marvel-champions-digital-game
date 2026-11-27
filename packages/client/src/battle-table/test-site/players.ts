/**
 * Players on the test site: who is playing, every game they finish, and which villains they have unlocked.
 *
 * - A player is a name and a long random token. Their personal link, `/p/<token>`, is their login: it works on any
 *   device and in any browser, as often as they like (WhatsApp's link preview opens it too, so opening it changes
 *   nothing). It leaves a cookie holding the token, good for a year.
 * - Somebody who came in on the shared invite link (`/join/<INVITE_KEY>`, gate.ts) is asked their name on first open;
 *   that makes them a player, with their own link from then on.
 * - Each finished game is saved under the id the table gave it when it was dealt: an ending undone and played out
 *   again updates the same game, so the last ending of a game is what counts.
 * - The villains open in order (Adam, 2026-11-24): Rhino from the start, Klaw once Rhino has been beaten, Ultron once
 *   Klaw has. Worked out from the saved games, so it follows the player to every device.
 * - Adam's own page, `/admin` (in through `/admin/<ADMIN_KEY>`, a second Pages secret), lists every player with their
 *   record and link, adds a player and switches a link off or on. Admin has every villain open.
 *
 * - Each game also keeps its facts (difficulty, modules, how the hero stood at the end, allies, Undo, the last blow:
 *   `record/game.ts`) as one block of JSON in the `facts` column, added to the live table by `addFactsColumn` at start.
 *   A game saved before the column has none and counts for what it can.
 *
 * Everything lives in the Pages project's D1 database (binding `DB`, created by `pnpm table:ship`). Without it the
 * table still plays: nothing is saved and nothing is locked.
 */

import { factsFromText, readFacts, type FinishedGame, type GameFacts } from "../record/game.js";
import { isPacked } from "../record/replay-pack.js";

/** The part of Cloudflare D1 this uses (so tests can run it on node:sqlite). */
export interface D1Like {
  prepare(sql: string): D1Statement;
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

/** The order the villains open in. */
export const VILLAIN_CHAIN = ["rhino", "klaw", "ultron"] as const;
const VILLAIN_NAMES: Record<string, string> = {
  rhino: "Rhino",
  klaw: "Klaw",
  ultron: "Ultron",
  // The Green Goblin pack's scenarios, named by the scenario (one villain fronts both).
  "risky-business": "Risky Business",
  "mutagen-formula": "Mutagen Formula",
};
export const villainName = (id: string) => VILLAIN_NAMES[id] ?? id;

export const PLAYER_COOKIE = "mc_table_player";
export const ADMIN_COOKIE = "mc_table_admin";
export const PLAYER_PREFIX = "/p/";
export const ADMIN_PREFIX = "/admin/";

export interface PlayerRow {
  id: string;
  token: string;
  name: string;
  created_at: number;
  disabled: number;
}

export interface GameRow {
  player_id: string;
  game_id: string;
  hero: string;
  villain: string;
  result: "win" | "loss";
  reason: string;
  rounds: number;
  version: string;
  deck: string;
  started_at: number;
  ended_at: number;
  /** The game's facts as JSON (`GameFacts`); null for a game saved before they were kept. */
  facts?: string | null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS games (
    player_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    hero TEXT NOT NULL,
    villain TEXT NOT NULL,
    result TEXT NOT NULL,
    reason TEXT NOT NULL,
    rounds INTEGER NOT NULL,
    version TEXT NOT NULL,
    deck TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, game_id)
  )`,
  `CREATE INDEX IF NOT EXISTS games_by_end ON games (ended_at)`,
  // The whole game, to play it again (`record/replay-pack.ts`): apart from `games`, which every page load reads whole.
  `CREATE TABLE IF NOT EXISTS game_replays (
    player_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    saved_at INTEGER NOT NULL,
    packed TEXT NOT NULL,
    PRIMARY KEY (player_id, game_id)
  )`,
];

/** Whether `games` has the `facts` column; false when the database won't say (then adding it settles it). */
async function hasFactsColumn(db: D1Like): Promise<boolean> {
  try {
    return (await db.prepare("PRAGMA table_info(games)").all<{ name: string }>()).results.some(
      (c) => c.name === "facts",
    );
  } catch {
    return false;
  }
}

/**
 * Adds the `facts` column to a `games` table made before it (the live one, 2026-11-24). `SCHEMA` only creates a table
 * that is missing, so the column is added by this step rather than in the table's definition. Safe to run at every
 * start, on a table with or without the column: it looks first, and a second worker adding it at the same moment
 * ("duplicate column") is fine too.
 */
export async function addFactsColumn(db: D1Like): Promise<void> {
  if (await hasFactsColumn(db)) return;
  try {
    await db.prepare("ALTER TABLE games ADD COLUMN facts TEXT").run();
  } catch (error) {
    if (!/duplicate column/i.test(String(error)) && !(await hasFactsColumn(db))) throw error;
  }
}

const ready = new WeakMap<D1Like, Promise<void>>();
/** Makes the tables (and adds any column they gained since) once per database per running worker. */
export function ensureSchema(db: D1Like): Promise<void> {
  let done = ready.get(db);
  if (!done) {
    done = (async () => {
      for (const sql of SCHEMA) await db.prepare(sql).run();
      await addFactsColumn(db);
    })();
    done.catch(() => ready.delete(db));
    ready.set(db, done);
  }
  return done;
}

/** A random token: 24 bytes as URL-safe base64, 32 characters. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A name as typed: trimmed, inner spaces squeezed, at most 40 characters, no control characters. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40)
  );
}

export async function createPlayer(db: D1Like, name: string, now = Date.now()): Promise<PlayerRow> {
  await ensureSchema(db);
  const row: PlayerRow = { id: crypto.randomUUID(), token: newToken(), name, created_at: now, disabled: 0 };
  await db
    .prepare("INSERT INTO players (id, token, name, created_at, disabled) VALUES (?, ?, ?, ?, 0)")
    .bind(row.id, row.token, row.name, row.created_at)
    .run();
  return row;
}

export async function renamePlayer(db: D1Like, id: string, name: string): Promise<void> {
  await ensureSchema(db);
  await db.prepare("UPDATE players SET name = ? WHERE id = ?").bind(name, id).run();
}

/** The player a token belongs to, unless their link has been switched off. */
export async function playerByToken(db: D1Like, token: string | undefined): Promise<PlayerRow | null> {
  if (!token || token.length > 100) return null;
  await ensureSchema(db);
  const row = await db.prepare("SELECT * FROM players WHERE token = ?").bind(token).first<PlayerRow>();
  return row && !row.disabled ? row : null;
}

export async function setDisabled(db: D1Like, id: string, disabled: boolean): Promise<void> {
  await ensureSchema(db);
  await db
    .prepare("UPDATE players SET disabled = ? WHERE id = ?")
    .bind(disabled ? 1 : 0, id)
    .run();
}

export async function allPlayers(db: D1Like): Promise<PlayerRow[]> {
  await ensureSchema(db);
  return (await db.prepare("SELECT * FROM players ORDER BY created_at").all<PlayerRow>()).results;
}

/** A finished game as the table sends it; anything off is refused rather than saved half-right. */
export interface GameReport {
  id: string;
  hero: string;
  villain: string;
  result: "win" | "loss";
  reason: string;
  rounds: number;
  version: string;
  deck: string[];
  startedAt: number;
  /** Null from a page made before the facts were kept, or facts that don't read right: the game still saves. */
  facts: GameFacts | null;
  /**
   * The whole game packed (`record/replay-pack.ts`): null from a page made before games were kept whole, or one too
   * big or not packed right. The game still saves without it.
   */
  replay: string | null;
}

const short = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;

export function parseGameReport(body: unknown): GameReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!short(b.id, 64) || !short(b.hero, 60) || !short(b.villain, 30) || !short(b.reason, 40)) return null;
  if (b.result !== "win" && b.result !== "loss") return null;
  const rounds = Number(b.rounds);
  const startedAt = Number(b.startedAt);
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > 999) return null;
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  const deck = Array.isArray(b.deck) ? b.deck.filter((c): c is string => short(c, 80)).slice(0, 80) : [];
  return {
    id: b.id as string,
    hero: b.hero as string,
    villain: b.villain as string,
    result: b.result,
    reason: b.reason as string,
    rounds,
    version: short(b.version, 20) ? (b.version as string) : "dev",
    deck,
    startedAt,
    facts: readFacts(b.facts),
    replay: isPacked(b.replay) ? b.replay : null,
  };
}

/** Saves a game, or updates it when the same game ends again (an undo, then a different ending). */
export async function saveGame(db: D1Like, playerId: string, game: GameReport, now = Date.now()): Promise<void> {
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO games (player_id, game_id, hero, villain, result, reason, rounds, version, deck, started_at, ended_at, facts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (player_id, game_id) DO UPDATE SET
         result = excluded.result, reason = excluded.reason, rounds = excluded.rounds, ended_at = excluded.ended_at,
         facts = excluded.facts`,
    )
    .bind(
      playerId,
      game.id,
      game.hero,
      game.villain,
      game.result,
      game.reason,
      game.rounds,
      game.version,
      JSON.stringify(game.deck),
      Math.min(game.startedAt, now),
      now,
      game.facts ? JSON.stringify(game.facts) : null,
    )
    .run();
  // The same game ending again (after an undo) keeps its latest moves.
  if (game.replay)
    await db
      .prepare(
        `INSERT INTO game_replays (player_id, game_id, saved_at, packed) VALUES (?, ?, ?, ?)
         ON CONFLICT (player_id, game_id) DO UPDATE SET saved_at = excluded.saved_at, packed = excluded.packed`,
      )
      .bind(playerId, game.id, now, game.replay)
      .run();
}

/** A game kept whole, packed, with its player's name; null when there is none for that game id. */
export async function packedGame(
  db: D1Like,
  gameId: string,
): Promise<{ player: string; game: GameRow; packed: string } | null> {
  await ensureSchema(db);
  const row = await db
    .prepare(
      `SELECT r.packed AS packed, p.name AS player, g.* FROM game_replays r
       JOIN games g ON g.player_id = r.player_id AND g.game_id = r.game_id
       LEFT JOIN players p ON p.id = r.player_id
       WHERE r.game_id = ? ORDER BY r.saved_at DESC LIMIT 1`,
    )
    .bind(gameId)
    .first<GameRow & { packed: string; player: string | null }>();
  if (!row) return null;
  const { packed, player, ...game } = row;
  return { player: player ?? "?", game, packed };
}

/** The ids of the games kept whole (the players page links them). */
export async function keptWhole(db: D1Like): Promise<Set<string>> {
  await ensureSchema(db);
  const { results } = await db.prepare("SELECT game_id FROM game_replays").all<{ game_id: string }>();
  return new Set(results.map((r) => r.game_id));
}

export async function gamesOf(db: D1Like, playerId: string): Promise<GameRow[]> {
  await ensureSchema(db);
  return (
    await db.prepare("SELECT * FROM games WHERE player_id = ? ORDER BY ended_at DESC").bind(playerId).all<GameRow>()
  ).results;
}

export async function allGames(db: D1Like): Promise<GameRow[]> {
  await ensureSchema(db);
  return (await db.prepare("SELECT * FROM games ORDER BY ended_at DESC").all<GameRow>()).results;
}

/** A saved game in the record's own shape (`record/game.ts`), the same as this browser's storage keeps. */
export function finishedGameOf(row: GameRow): FinishedGame {
  let deck: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.deck);
    if (Array.isArray(parsed)) deck = parsed.filter((c): c is string => typeof c === "string");
  } catch {
    // An unreadable deck reads as none.
  }
  return {
    id: row.game_id,
    hero: row.hero,
    villain: row.villain,
    result: row.result,
    reason: row.reason,
    rounds: row.rounds,
    version: row.version,
    deck,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    facts: factsFromText(row.facts),
  };
}

/** Which villains are open, from the games won: each one opens when the one before it has been beaten. */
export function unlockedFrom(games: readonly Pick<GameRow, "villain" | "result">[]): string[] {
  const beaten = new Set(games.filter((g) => g.result === "win").map((g) => g.villain));
  const open: string[] = [];
  for (const [i, villain] of VILLAIN_CHAIN.entries()) {
    if (i === 0 || beaten.has(VILLAIN_CHAIN[i - 1]!)) open.push(villain);
    else break;
  }
  return open;
}

export interface Tally {
  played: number;
  won: number;
  lost: number;
}
export interface Record_ {
  total: Tally;
  byVillain: { villain: string; name: string; tally: Tally }[];
  byHero: { hero: string; tally: Tally }[];
  recent: {
    when: number;
    hero: string;
    villain: string;
    result: "win" | "loss";
    reason: string;
    rounds: number;
    version: string;
    minutes: number;
  }[];
}

const tally = (games: readonly GameRow[]): Tally => {
  const won = games.filter((g) => g.result === "win").length;
  return { played: games.length, won, lost: games.length - won };
};

/** A player's record: overall, per villain, per hero, and the latest games (newest first). */
export function recordOf(games: readonly GameRow[], recent = 10): Record_ {
  const villains = [...new Set([...VILLAIN_CHAIN, ...games.map((g) => g.villain)])];
  const heroes = [...new Set(games.map((g) => g.hero))];
  return {
    total: tally(games),
    byVillain: villains
      .map((villain) => ({
        villain,
        name: villainName(villain),
        tally: tally(games.filter((g) => g.villain === villain)),
      }))
      .filter((v) => v.tally.played > 0),
    byHero: heroes.map((hero) => ({ hero, tally: tally(games.filter((g) => g.hero === hero)) })),
    recent: games.slice(0, recent).map((g) => ({
      when: g.ended_at,
      hero: g.hero,
      villain: villainName(g.villain),
      result: g.result,
      reason: g.reason,
      rounds: g.rounds,
      version: g.version,
      minutes: Math.max(0, Math.round((g.ended_at - g.started_at) / 60000)),
    })),
  };
}
