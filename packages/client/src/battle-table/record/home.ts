/**
 * The record's two homes, behind one interface:
 *
 * - the test site's database, through its API (`/api/games`, `test-site/site-api.ts`), for a friend signed in there;
 * - this browser's storage everywhere else (Adam's own table, the browser tests), so his games count too.
 *
 * `test-site/player.ts` picks the home (it knows who is signed in). Villain unlocks stay the site's: with the browser
 * home every villain is open, as it always was there.
 */
import { readFacts, type FinishedGame, type GameFacts, type Result } from "./game.js";

/** A finished game as the table hands it over (the home stamps when it ended). */
export interface GameReport {
  id: string;
  hero: string;
  villain: string;
  result: Result;
  reason: string;
  rounds: number;
  version: string;
  deck: string[];
  startedAt: number;
  facts: GameFacts | null;
}

export interface SaveOutcome {
  saved: boolean;
  /** The site's answer: the villains open now, and the ones this game opened (by name). */
  unlocked?: string[];
  newlyUnlocked?: string[];
  /** Games won and lost against this game's villain, this one included. */
  versus?: { won: number; lost: number };
}

export interface RecordHome {
  readonly where: "site" | "browser";
  /** Saves a game, or replaces it when the same game ends again (an undo, then another ending). */
  save(game: GameReport): Promise<SaveOutcome>;
  /** Every finished game, newest first; null when they can't be read just now. */
  games(): Promise<FinishedGame[] | null>;
}

const versusOf = (games: readonly FinishedGame[], villain: string) => {
  const against = games.filter((g) => g.villain === villain);
  const won = against.filter((g) => g.result === "win").length;
  return { won, lost: against.length - won };
};

// ── This browser ─────────────────────────────────────────────────────────────────────────────────────────────────

export const BROWSER_RECORD_KEY = "mc-table-record";
/** The newest games kept; older ones drop off (a few hundred bytes each, far inside the browser's storage). */
const KEEP = 2000;

/** The part of `Storage` this uses, so the tests can hand it a plain map. */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function gameFrom(raw: unknown): FinishedGame | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  const id = text(g.id);
  const hero = text(g.hero);
  const villain = text(g.villain);
  const reason = text(g.reason);
  if (!id || !hero || !villain || !reason || (g.result !== "win" && g.result !== "loss")) return null;
  const rounds = Number(g.rounds);
  const startedAt = Number(g.startedAt);
  const endedAt = Number(g.endedAt);
  if (!Number.isFinite(rounds) || !Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return {
    id,
    hero,
    villain,
    result: g.result,
    reason,
    rounds,
    version: text(g.version) ?? "dev",
    deck: Array.isArray(g.deck) ? g.deck.filter((c): c is string => typeof c === "string") : [],
    startedAt,
    endedAt,
    facts: readFacts(g.facts),
  };
}

/** The record kept in this browser's storage. A private window that refuses storage keeps nothing, and says so. */
export function browserHome(storage: StorageLike | null = safeLocalStorage(), now = () => Date.now()): RecordHome {
  const read = (): FinishedGame[] => {
    try {
      const parsed: unknown = JSON.parse(storage?.getItem(BROWSER_RECORD_KEY) ?? "null");
      const list = parsed && typeof parsed === "object" ? (parsed as { games?: unknown }).games : null;
      return Array.isArray(list) ? list.map(gameFrom).filter((g): g is FinishedGame => !!g) : [];
    } catch {
      return [];
    }
  };
  return {
    where: "browser",
    async save(report) {
      if (!storage) return { saved: false };
      const ended = now();
      const before = read();
      const old = before.find((g) => g.id === report.id);
      const game: FinishedGame = { ...report, startedAt: Math.min(report.startedAt, ended), endedAt: ended };
      // The same game ending again keeps its place in time from when it was dealt, and takes the new ending.
      const games = [game, ...before.filter((g) => g !== old)].sort((a, b) => b.endedAt - a.endedAt).slice(0, KEEP);
      try {
        storage.setItem(BROWSER_RECORD_KEY, JSON.stringify({ v: 1, games }));
      } catch {
        return { saved: false };
      }
      return { saved: true, versus: versusOf(games, report.villain) };
    },
    async games() {
      return read();
    },
  };
}

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// ── The test site ────────────────────────────────────────────────────────────────────────────────────────────────

async function getJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** The record in the test site's database, for the player signed in there. */
export function siteHome(): RecordHome {
  return {
    where: "site",
    async save(report) {
      const saved = await getJson<SaveOutcome>("/api/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
      });
      return saved ?? { saved: false };
    },
    async games() {
      const body = await getJson<{ games?: unknown[] }>("/api/games");
      return body?.games ? body.games.map(gameFrom).filter((g): g is FinishedGame => !!g) : null;
    },
  };
}
