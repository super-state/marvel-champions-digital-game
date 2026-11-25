/**
 * Bug reports sent from the test site's table ("Report a bug" in the menu, `report/`), kept in the site's D1 database
 * beside the players (players.ts). The site files each one as a GitHub issue as it arrives (file-report.ts) and notes
 * the issue here; one it couldn't file waits for `pnpm table:reports` (scripts/file-table-reports.mjs). Adam's players
 * page lists them too, filed or not.
 *
 * A report holds the player's words, who sent it and the moment on the table (the engine state included, so it can be
 * a few hundred KB). A player can send at most `HOURLY_LIMIT` an hour, so a stuck key can't fill the database.
 */
import { ensureSchema, type D1Like } from "./players.js";
import type { ReportSent } from "../report/moment.js";

export const HOURLY_LIMIT = 12;

export interface ReportRow {
  id: string;
  /** The player's id, or "invited" / "admin" for someone in on the shared link or Adam's key without a player. */
  sender: string;
  from_name: string;
  at: number;
  text: string;
  /** The moment as JSON (`ReportMoment`). */
  moment: string;
  /** The GitHub issue it was filed as; null until filed. */
  issue: string | null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    sender TEXT NOT NULL,
    from_name TEXT NOT NULL,
    at INTEGER NOT NULL,
    text TEXT NOT NULL,
    moment TEXT NOT NULL,
    issue TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS reports_by_sender ON reports (sender, at)`,
];

const ready = new WeakMap<D1Like, Promise<void>>();
function ensureReports(db: D1Like): Promise<void> {
  let done = ready.get(db);
  if (!done) {
    done = (async () => {
      await ensureSchema(db);
      for (const sql of SCHEMA) await db.prepare(sql).run();
    })();
    done.catch(() => ready.delete(db));
    ready.set(db, done);
  }
  return done;
}

/** Keeps a report; null when this sender has sent too many this hour. */
export async function saveReport(
  db: D1Like,
  sender: { key: string; name: string },
  report: ReportSent,
  now = Date.now(),
): Promise<ReportRow | null> {
  await ensureReports(db);
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM reports WHERE sender = ? AND at > ?")
    .bind(sender.key, now - 60 * 60 * 1000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= HOURLY_LIMIT) return null;
  const row: ReportRow = {
    id: `r-${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    sender: sender.key,
    from_name: sender.name,
    at: now,
    text: report.text,
    moment: JSON.stringify(report.moment),
    issue: null,
  };
  await db
    .prepare("INSERT INTO reports (id, sender, from_name, at, text, moment, issue) VALUES (?, ?, ?, ?, ?, ?, NULL)")
    .bind(row.id, row.sender, row.from_name, row.at, row.text, row.moment)
    .run();
  return row;
}

/** The latest reports, newest first, without their moments (the players page shows only the words). */
export async function latestReports(
  db: D1Like,
  limit = 50,
): Promise<(Omit<ReportRow, "moment"> & { version: string | null; game: string })[]> {
  await ensureReports(db);
  const { results } = await db
    .prepare(
      `SELECT id, sender, from_name, at, text, issue,
        json_extract(moment, '$.version') AS version,
        json_extract(moment, '$.hero') || ' vs ' || json_extract(moment, '$.villain') || ', round ' ||
          json_extract(moment, '$.round') AS game
       FROM reports ORDER BY at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<Omit<ReportRow, "moment"> & { version: string | null; game: string }>();
  return results;
}

/** The engine state kept with a report, as JSON text; null when there is no such report or it has none. */
export async function reportState(db: D1Like, id: string): Promise<string | null> {
  await ensureReports(db);
  const row = await db
    .prepare(
      "SELECT json_extract(moment, '$.state') IS NOT NULL AS has, json(json_extract(moment, '$.state')) AS state FROM reports WHERE id = ?",
    )
    .bind(id)
    .first<{ has: number; state: string | null }>();
  return row?.has ? (row.state ?? null) : null;
}
