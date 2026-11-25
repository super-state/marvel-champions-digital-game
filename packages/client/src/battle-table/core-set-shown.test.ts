import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CORE_CARDS, CORE_ENCOUNTER_SETS } from "@mc/content";
import { BEAT_FIELDS, EVENT_RULES, STANDING } from "./shown-check.js";

/**
 * Writes `docs/project/core-set-shown.md`: every Core Set card, one row per printed ability or effect, each marked
 * shown on the table, words only, silent (with what was missed) or never fired, from the shards the watched games
 * wrote (`shown-check.ts`). Run by `scripts/core-set-shown.sh`, which plays the fuzz and the deck audits first; a
 * normal test run skips it, so the page only changes when it is regenerated on purpose.
 */
const input = process.env.SHOWN_IN;
const OUT = new URL("../../../../docs/project/core-set-shown.md", import.meta.url);

interface ShardRow {
  table: number;
  log: number;
  silent: number;
  fired: number;
  unnamed: number;
  missed: string[];
}

type Verdict = "shown" | "log only" | "silent" | "never fired";

const PLAYER_TYPES = new Set(["hero_identity", "ally", "event", "support", "upgrade", "resource"]);

function abilityIdsOf(card: unknown): string[] {
  const ids: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (key === "abilities" && Array.isArray(v))
          for (const a of v) if (a && typeof a === "object" && "id" in a) ids.push(String(a.id));
        walk(v);
      }
    }
  };
  walk(card);
  return [...new Set(ids)];
}

/** The rows every card has besides its abilities: played, revealed, activating. */
function defaultRows(type: string): string[] {
  if (["ally", "event", "support", "upgrade", "resource"].includes(type)) return ["played"];
  if (["minion"].includes(type)) return ["revealed", "activation"];
  if (["villain"].includes(type)) return ["activation"];
  if (["treachery", "attachment", "side_scheme", "environment", "obligation"].includes(type)) return ["revealed"];
  return [];
}

const verdictOf = (row: ShardRow | undefined): Verdict =>
  !row || (row.fired === 0 && row.table + row.log + row.silent === 0)
    ? "never fired"
    : row.silent
      ? "silent"
      : row.log
        ? "log only"
        : "shown";

test.skipIf(!input)("the Core Set ledger: every card's abilities, shown, words only, silent or never fired", () => {
  type Shard = { name: string; rows: Record<string, ShardRow>; unclassified: Record<string, number> };
  const shards: Shard[] = readdirSync(input!)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map(
      (f) =>
        ({ name: f.replace(/\.json$/, ""), ...(JSON.parse(readFileSync(join(input!, f), "utf8")) as object) }) as Shard,
    );
  expect(shards.length).toBeGreaterThan(0);
  const merged = new Map<string, ShardRow>();
  for (const shard of shards)
    for (const [key, row] of Object.entries(shard.rows)) {
      const into = merged.get(key) ?? { table: 0, log: 0, silent: 0, fired: 0, unnamed: 0, missed: [] };
      into.table += row.table;
      into.log += row.log;
      into.silent += row.silent;
      into.fired += row.fired;
      into.unnamed += row.unnamed ?? 0;
      into.missed = [...new Set([...into.missed, ...row.missed])].sort();
      merged.set(key, into);
    }

  const setName = new Map(CORE_ENCOUNTER_SETS.map((set) => [String(set.id), set.name]));
  interface Line {
    code: string;
    name: string;
    type: string;
    group: string;
    player: boolean;
    what: string;
    row: ShardRow | undefined;
    verdict: Verdict;
  }
  const lines: Line[] = [];
  const listed = new Set<string>();
  for (const card of CORE_CARDS) {
    const c = card as unknown as {
      id: string;
      name: string;
      type: string;
      aspect?: string;
      encounterSetIds?: string[];
    };
    const group = c.aspect
      ? c.aspect.charAt(0).toUpperCase() + c.aspect.slice(1)
      : c.encounterSetIds?.length
        ? c.encounterSetIds.map((id) => setName.get(id) ?? id).join(", ")
        : c.type === "hero_identity"
          ? "Hero"
          : "Hero's own cards";
    const whats = [...abilityIdsOf(card), ...defaultRows(c.type)];
    // Keywords the engine reports firing, and anything else this card's rows met in the games.
    for (const key of merged.keys()) if (key.startsWith(`${c.id} | `)) whats.push(key.slice(c.id.length + 3));
    for (const what of [...new Set(whats)]) {
      const key = `${c.id} | ${what}`;
      listed.add(key);
      const row = merged.get(key);
      lines.push({
        code: c.id,
        name: c.name,
        type: c.type,
        group,
        player: PLAYER_TYPES.has(c.type),
        what,
        row,
        verdict: verdictOf(row),
      });
    }
  }
  const rules = [...merged.entries()].filter(([key]) => !listed.has(key));

  const count = (filter: (line: Line) => boolean) => {
    const out: Record<Verdict, number> = { shown: 0, "log only": 0, silent: 0, "never fired": 0 };
    for (const line of lines) if (filter(line)) out[line.verdict]++;
    return out;
  };
  const tableRow = (label: string, counts: Record<Verdict, number>) =>
    `| ${label} | ${counts.shown} | ${counts["log only"]} | ${counts.silent} | ${counts["never fired"]} | ${
      counts.shown + counts["log only"] + counts.silent + counts["never fired"]
    } |`;
  const types = [...new Set(lines.map((line) => line.type))].sort();
  const missedOf = (line: { row: ShardRow | undefined }, cls: string) =>
    (line.row?.missed ?? [])
      .filter((m) => m.startsWith(`${cls}: `))
      .map((m) => m.slice(cls.length + 2))
      .join("; ");
  const listOf = (verdict: Verdict, player: boolean, cls: string) =>
    lines
      .filter((line) => line.verdict === verdict && line.player === player)
      .map(
        (line) =>
          `| ${line.code} | ${line.name} | ${line.group} | ${line.what} | ${missedOf(line, cls)} | ${line.row?.[cls === "silent" ? "silent" : "log"] ?? 0} of ${(line.row?.table ?? 0) + (line.row?.log ?? 0) + (line.row?.silent ?? 0)} |`,
      );
  const header = "| Card | Name | Set | What | What was missed | Times |\n| --- | --- | --- | --- | --- | --- |";

  const doc = [
    "# Core Set: does the table show everything that happens?",
    "",
    "Generated: do not edit by hand. `bash scripts/core-set-shown.sh` plays the fuzz and the deck audits under the",
    "watcher (`packages/client/src/battle-table/shown-check.ts`) and writes this page again.",
    "",
    "Every Core Set card, one row per printed ability (and per card: played, revealed, activating, and each keyword the",
    "engine reports firing). Each time a row's card acted in a watched game, everything it did was judged:",
    "",
    "- **shown**: on the table: a card moves, a token or marker changes, a stamp, strike or banner (a beat field the",
    "  table plays out, or the table's standing picture changing for that card).",
    "- **log only**: only the dock's words say it. Not a pass until Adam has seen this list.",
    "- **silent**: something happened and nothing on screen says so (what was missed is listed).",
    "- **never fired**: no watched game reached it. It needs a driven scene before it can be called checked.",
    "",
    'A row\'s class is the worst seen over all its firings. "Card not named" counts firings whose effect showed while',
    "nothing pointed at the card that did it.",
    "",
    `Sources: ${shards.map((s) => s.name).join(", ")}.`,
    "",
    "## Summary",
    "",
    "| Rows | Shown | Log only | Silent | Never fired | All |",
    "| --- | --- | --- | --- | --- | --- |",
    tableRow(
      "All Core Set rows",
      count(() => true),
    ),
    tableRow(
      "Player cards",
      count((l) => l.player),
    ),
    tableRow(
      "Encounter cards",
      count((l) => !l.player),
    ),
    "",
    "| Card type | Shown | Log only | Silent | Never fired | All |",
    "| --- | --- | --- | --- | --- | --- |",
    ...types.map((type) =>
      tableRow(
        type,
        count((l) => l.type === type),
      ),
    ),
    "",
    "## Silent: player cards",
    "",
    header,
    ...listOf("silent", true, "silent"),
    "",
    "## Silent: encounter cards",
    "",
    header,
    ...listOf("silent", false, "silent"),
    "",
    "## Silent: the game's own rules (no card resolving)",
    "",
    "| Row | What was missed | Times |",
    "| --- | --- | --- |",
    ...rules
      .filter(([, row]) => row.silent)
      .map(([key, row]) => `| ${key} | ${missedOf({ row }, "silent")} | ${row.silent} |`),
    "",
    "## Log only (words in the dock, nothing on the table)",
    "",
    header,
    ...listOf("log only", true, "log"),
    ...listOf("log only", false, "log"),
    "",
    "## Shown, with the card that did it not named",
    "",
    "| Card | Name | What | Firings with the card not named |",
    "| --- | --- | --- | --- |",
    ...lines
      .filter((line) => (line.row?.unnamed ?? 0) > 0)
      .map((line) => `| ${line.code} | ${line.name} | ${line.what} | ${line.row!.unnamed} of ${line.row!.fired} |`),
    "",
    "## Never fired",
    "",
    "| Card | Name | Set | What |",
    "| --- | --- | --- | --- |",
    ...lines
      .filter((line) => line.verdict === "never fired")
      .map((line) => `| ${line.code} | ${line.name} | ${line.group} | ${line.what} |`),
    "",
    "## Shown",
    "",
    "| Card | Name | What | Times |",
    "| --- | --- | --- | --- |",
    ...lines
      .filter((line) => line.verdict === "shown")
      .map((line) => `| ${line.code} | ${line.name} | ${line.what} | ${line.row!.table} |`),
    "",
    "## How the table shows things (what the check accepts)",
    "",
    'Beat fields (`BEAT_FIELDS`): a beat with a "table" field is played out on the table by `present()` in main.ts.',
    "",
    "| Field | Class | Where |",
    "| --- | --- | --- |",
    ...Object.entries(BEAT_FIELDS).map(([field, value]) => `| ${field} | ${value.cls} | ${value.where} |`),
    "",
    "The table's standing picture (`STANDING`): a change with no beat still counts as shown when the picture changes:",
    "",
    "| Change | Where it is seen |",
    "| --- | --- |",
    ...Object.entries(STANDING).map(([change, where]) => `| ${change} | ${where} |`),
    "",
    'Engine events (`EVENT_RULES`): "bookkeeping" has no game fact of its own; "state" is checked as the change it',
    'makes; "beat" leaves nothing in the state to see, so a beat must name its card.',
    "",
    "| Event | Rule | Why / what |",
    "| --- | --- | --- |",
    ...Object.entries(EVENT_RULES)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([event, rule]) => `| ${event} | ${rule.kind} | ${rule.kind === "beat" ? rule.what : rule.why} |`),
    "",
    `Event types met with no rule yet: ${
      Object.keys(Object.assign({}, ...shards.map((s) => s.unclassified))).join(", ") || "none"
    }.`,
    "",
  ].join("\n");
  writeFileSync(OUT, doc);
});
