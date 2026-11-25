/**
 * "Report a bug" (Adam, 2026-11-25): what a player's report keeps of the moment they pressed it, so whoever reads it
 * can see what was on the table and deal the same game again. The words are the player's; everything else is read off
 * the table at that moment.
 *
 * Pure data and no imports but types, so the filing script (`scripts/file-table-reports.mjs`, plain Node) can load the
 * issue text from `issue.ts` beside it.
 */

/** What the table looked like when the player pressed Report a bug. */
export interface ReportMoment {
  /** The shipped version (`VITE_TABLE_VERSION`), or null on Adam's own dev table. */
  version: string | null;
  /** The page's address, without its query (which can carry a `?scene=`): `/battle/`. */
  page: string;
  /** Whether a game was on the table, or the player was somewhere else (the room, the shelf). */
  inGame: boolean;
  hero: string;
  villain: string;
  difficulty: string;
  modules: string[];
  /** The shuffle: with the hero, villain, difficulty and modules it deals the same game again. */
  seed: number;
  round: number;
  /** Whose turn: player, enemy, ending, finished. */
  turn: string;
  /** Still being set up (the mulligan). */
  setup: boolean;
  outcome: string | null;
  heroHp: number;
  villainHp: number;
  /** The hero card's name as it stands (hero or alter-ego side). */
  heroCard: string;
  villainCard: string;
  hand: string[];
  inPlay: string[];
  /** The villain's side of the table: the main scheme, side schemes, minions, attachments. */
  enemies: string[];
  /** What the game was asking, in its own words (the bar's title and help line). */
  asking: string;
  /** The log, newest last: at most `LOG_LINES` lines. */
  log: string[];
  screen: { width: number; height: number; pixelRatio: number };
  /** Mouse, touch or controller, as the table last saw. */
  input: string;
  browser: string;
  /** The engine's own state at that moment (plain JSON), to load the moment again. Can be large. */
  state?: unknown;
}

/** A report as sent by the table: the player's words and the moment. */
export interface ReportSent {
  text: string;
  moment: ReportMoment;
}

/** A report as stored and filed: who sent it and when, besides what they sent. */
export interface ReportRecord extends ReportSent {
  id: string;
  /** The player's name on the test site; on Adam's own table, "Adam (dev table)". */
  from: string;
  at: number;
}

export const LOG_LINES = 40;
/** The longest a player's words can be. */
export const TEXT_LIMIT = 4000;
/** The most a whole report can weigh as JSON, state and all (an engine state is ~50 to 300 KB). */
export const REPORT_LIMIT = 900_000;

const str = (value: unknown, max = 200): string => (typeof value === "string" ? value.slice(0, max) : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const strs = (value: unknown, count = 60, max = 200): string[] =>
  Array.isArray(value) ? value.slice(-count).map((each) => str(each, max)) : [];

/** A player's words as typed: no control characters but line breaks and tabs, at most `TEXT_LIMIT` characters. */
export function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\r\n?/g, "\n")
      .trim()
      .slice(0, TEXT_LIMIT)
  );
}

/**
 * A report as it arrives from a browser, read field by field so nothing but what's listed here is kept and nothing is
 * longer than it should be. Null when it has no words (a blank report says nothing).
 */
export function parseReport(raw: unknown): ReportSent | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as { text?: unknown; moment?: unknown };
  const text = cleanText(body.text);
  if (!text) return null;
  const m = (body.moment && typeof body.moment === "object" ? body.moment : {}) as Record<string, unknown>;
  const screen = (m.screen && typeof m.screen === "object" ? m.screen : {}) as Record<string, unknown>;
  const moment: ReportMoment = {
    version: typeof m.version === "string" ? m.version.slice(0, 20) : null,
    page: str(m.page),
    inGame: m.inGame === true,
    hero: str(m.hero, 60),
    villain: str(m.villain, 60),
    difficulty: str(m.difficulty, 20),
    modules: strs(m.modules, 10, 60),
    seed: num(m.seed),
    round: num(m.round),
    turn: str(m.turn, 20),
    setup: m.setup === true,
    outcome: typeof m.outcome === "string" ? m.outcome.slice(0, 60) : null,
    heroHp: num(m.heroHp),
    villainHp: num(m.villainHp),
    heroCard: str(m.heroCard, 80),
    villainCard: str(m.villainCard, 80),
    hand: strs(m.hand, 30, 80),
    inPlay: strs(m.inPlay, 40, 80),
    enemies: strs(m.enemies, 40, 120),
    asking: str(m.asking, 600),
    log: strs(m.log, LOG_LINES, 400),
    screen: { width: num(screen.width), height: num(screen.height), pixelRatio: num(screen.pixelRatio) },
    input: str(m.input, 20),
    browser: str(m.browser, 300),
    ...(m.state !== undefined ? { state: m.state } : {}),
  };
  return { text, moment };
}
