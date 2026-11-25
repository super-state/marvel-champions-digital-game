#!/usr/bin/env node
/**
 * Pulls a finished game off the test site, kept whole (its deal, every move and the table's log), so a session can
 * play it again when a player describes a bug they didn't report (packages/client/src/battle-table/record/).
 *
 *   pnpm table:game                    the latest 25 games: id, when, who, matchup, result, version, kept whole or not
 *   pnpm table:game <game id>          that game, saved to packages/client/.table-games/<game id>.json
 *   pnpm table:game "<player name>"    that player's latest game kept whole (a name as on /admin, any case)
 *
 * It prints the game's line and the end of its log, then how to replay it: on the code of the version it was played
 * on (`git checkout table-v<version>` in a worktree), run
 *   TABLE_GAME=<file> pnpm --filter @mc/client exec vitest run src/battle-table/record/replay.test.ts -t "saved file" --silent=false
 * which deals it, makes every move and prints what the table said after each one (record/replay.ts).
 *
 * Reads the live D1 database with wrangler (signed in on this PC), from a scratch folder.
 * TABLE_GAMES_D1="--local --config <file> --persist-to <dir>" points it at a local D1 instead (testing).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { unpackGame } = await import("../packages/client/src/battle-table/record/replay-pack.ts");
const WRANGLER = join(root, "packages/sync-worker/node_modules/wrangler/bin/wrangler.js");
const DATABASE = "champions-table-players";
const OUT = join(root, "packages/client/.table-games");
const D1_WHERE = (process.env.TABLE_GAMES_D1 ?? "--remote").split(" ").filter(Boolean);

function d1(sql) {
  const scratch = mkdtempSync(join(tmpdir(), "table-d1-"));
  try {
    const out = execFileSync(
      process.execPath,
      [WRANGLER, "d1", "execute", DATABASE, ...D1_WHERE, "--json", "--command", sql],
      { cwd: scratch, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(out.slice(out.indexOf("[")))[0]?.results ?? [];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const sqlText = (text) => `'${String(text).replace(/'/g, "''")}'`;
const when = (ms) => new Date(ms).toLocaleString("en-GB", { timeZone: "Europe/London" });

const wanted = process.argv.slice(2).join(" ").trim();
if (!wanted) {
  const rows = d1(
    `SELECT g.game_id, g.ended_at, p.name, g.hero, g.villain, g.result, g.rounds, g.version,
       (SELECT length(packed) FROM game_replays r WHERE r.game_id = g.game_id AND r.player_id = g.player_id) AS kept
     FROM games g LEFT JOIN players p ON p.id = g.player_id ORDER BY g.ended_at DESC LIMIT 25`,
  );
  for (const g of rows)
    console.log(
      `${g.game_id}  ${when(g.ended_at)}  ${g.name}: ${g.hero} vs ${g.villain}, ${g.result} in ${g.rounds} rounds, ` +
        `v${g.version}  ${g.kept ? `kept whole (${(g.kept / 1024).toFixed(1)} KB)` : "summary only"}`,
    );
  if (!rows.length) console.log("No games yet.");
  process.exit(0);
}

const [row] = d1(
  `SELECT r.game_id, r.packed, p.name, g.hero, g.villain, g.result, g.reason, g.rounds, g.version, g.ended_at
   FROM game_replays r JOIN games g ON g.player_id = r.player_id AND g.game_id = r.game_id
   LEFT JOIN players p ON p.id = r.player_id
   WHERE r.game_id = ${sqlText(wanted)} OR lower(p.name) = lower(${sqlText(wanted)})
   ORDER BY g.ended_at DESC LIMIT 1`,
);
if (!row) {
  console.error(`table-game: no game kept whole for "${wanted}" (run with no argument to list the latest games)`);
  process.exit(1);
}
const saved = await unpackGame(row.packed);
if (!saved) {
  console.error(`table-game: game ${row.game_id} is kept but doesn't unpack`);
  process.exit(1);
}
const game = {
  id: row.game_id,
  player: row.name,
  hero: row.hero,
  villain: row.villain,
  result: row.result,
  reason: row.reason,
  rounds: row.rounds,
  version: row.version,
  endedAt: row.ended_at,
};
mkdirSync(OUT, { recursive: true });
const file = join(OUT, `${row.game_id}.json`);
writeFileSync(file, JSON.stringify({ game, ...saved }, null, 2));
console.log(
  `${row.name}: ${row.hero} vs ${row.villain}, ${row.result} (${row.reason}) in ${row.rounds} rounds, ` +
    `v${row.version}, ended ${when(row.ended_at)}`,
);
console.log(`deal: ${JSON.stringify({ ...saved.replay.deal, deck: saved.replay.deal.deck?.name ?? "starter" })}`);
console.log(`${saved.replay.moves.length} moves, ${saved.log.length} log lines; the log's end:`);
for (const line of saved.log.slice(-15)) console.log(`  ${line}`);
const rel = relative(root, file).replace(/\\/g, "/");
console.log(`\nsaved: ${rel}`);
console.log(`replay it on the code it was played on (git checkout table-v${row.version} in a worktree), then:`);
console.log(
  `  TABLE_GAME=${file.replace(/\\/g, "/")} pnpm --filter @mc/client exec vitest run src/battle-table/record/replay.test.ts -t "saved file" --silent=false`,
);
