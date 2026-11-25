#!/usr/bin/env node
/**
 * Files the 3D table's bug reports ("Report a bug" in the menu, packages/client/src/battle-table/report/) as GitHub
 * issues on super-state/marvel-champions-digital-game, labelled "player report". Each issue holds the player's words
 * (fenced, as theirs) and the moment on the table; the engine state goes in an unlisted gist the issue links to.
 *
 *   pnpm table:reports            every report not filed yet: the test site's (read from its D1 database with
 *                                 wrangler, already signed in on this PC, and marked filed there) and any the dev
 *                                 table kept but couldn't file (packages/client/.battle-reports/)
 *   pnpm table:reports --dry-run  say what would be filed, file nothing
 *   node scripts/file-table-reports.mjs --local
 *                                 only the dev table's (vite-battle-report.ts runs this after each report)
 *
 * Never files a report twice: a report's id is in its issue, and the open and closed player reports are looked
 * through before each one is filed (a call GitHub answered with an error can still have made the issue).
 *
 * TABLE_REPORTS_D1="--local --config <file> --persist-to <dir>" points it at a local D1 instead (testing).
 *
 * Uses the `gh` login on this PC (account super-state). Node strips the types of `issue.ts` and `moment.ts` itself.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { issueTitle, issueBody, ISSUE_REPO, ISSUE_LABEL } =
  await import("../packages/client/src/battle-table/report/issue.ts");
const WRANGLER = join(root, "packages/sync-worker/node_modules/wrangler/bin/wrangler.js");
const DATABASE = "champions-table-players";
const LOCAL = join(root, "packages/client/.battle-reports");
const D1_WHERE = (process.env.TABLE_REPORTS_D1 ?? "--remote").split(" ").filter(Boolean);

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options }).trim();

/** Makes sure the label exists (once per run). */
let labelled = false;
function ensureLabel() {
  if (labelled) return;
  try {
    run("gh", [
      "label",
      "create",
      ISSUE_LABEL,
      "-R",
      ISSUE_REPO,
      "--color",
      "5319e7",
      "--description",
      "Sent from the table's Report a bug",
    ]);
  } catch {
    // Already there.
  }
  labelled = true;
}

const pause = () => execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 3000)"]);

/** GitHub answered 500s and GraphQL errors now and then on 2026-11-25: each call gets two more tries. */
function gh(args) {
  for (let attempt = 1; ; attempt++) {
    try {
      return run("gh", args);
    } catch (error) {
      if (attempt >= 3) throw error;
      pause();
    }
  }
}

/** The issue already made for a report, if any: its id is in the body ("report `<id>`"). */
function alreadyFiled(id) {
  const found = run("gh", [
    "api",
    `repos/${ISSUE_REPO}/issues?labels=${encodeURIComponent(ISSUE_LABEL)}&state=all&per_page=100`,
    "--jq",
    `.[] | select(.body | contains("report \u0060${id}\u0060")) | .html_url`,
  ]);
  return found.split(/\r?\n/)[0] || null;
}

/** Files one report (`ReportRecord`), or finds the issue it already has; returns the issue's address. */
function fileReport(report) {
  const before = alreadyFiled(report.id);
  if (before) return before;
  const work = mkdtempSync(join(tmpdir(), "table-report-"));
  try {
    let stateLink;
    if (report.moment?.state !== undefined) {
      const stateFile = join(work, `${report.id}.json`);
      writeFileSync(stateFile, JSON.stringify(report.moment.state));
      try {
        // A secret gist: unlisted, but anyone with the issue's link can open it (the issue is public).
        stateLink = gh(["gist", "create", stateFile, "--desc", `3D table report ${report.id}: engine state`]);
      } catch (error) {
        const why = String(error.stderr || error.message || error)
          .trim()
          .split(/\r?\n/)
          .pop();
        console.warn(`  (no gist for the engine state: ${why})`);
      }
    }
    // GitHub's REST call rather than `gh issue create` (GraphQL), which failed when REST didn't.
    const request = join(work, "issue.json");
    const issue = { title: issueTitle(report), body: issueBody(report, stateLink), labels: [ISSUE_LABEL] };
    writeFileSync(request, JSON.stringify(issue));
    ensureLabel();
    for (let attempt = 1; ; attempt++) {
      try {
        return run("gh", [
          "api",
          `repos/${ISSUE_REPO}/issues`,
          "--method",
          "POST",
          "--input",
          request,
          "--jq",
          ".html_url",
        ]);
      } catch (error) {
        // An error answer can still have made the issue: look before trying again.
        pause();
        const made = alreadyFiled(report.id);
        if (made) return made;
        if (attempt >= 3) throw error;
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Runs a D1 query on the live database; wrangler runs from a scratch folder (inside the repo it grabs another config). */
function d1(sql) {
  const scratch = mkdtempSync(join(tmpdir(), "table-d1-"));
  try {
    const out = run(process.execPath, [WRANGLER, "d1", "execute", DATABASE, ...D1_WHERE, "--json", "--command", sql], {
      cwd: scratch,
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(out.slice(out.indexOf("[")));
    return parsed[0]?.results ?? [];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const sqlText = (text) => `'${String(text).replace(/'/g, "''")}'`;

async function fileSiteReports(dryRun) {
  let rows;
  try {
    rows = d1("SELECT id, from_name, at, text, moment FROM reports WHERE issue IS NULL ORDER BY at");
  } catch (error) {
    // Wrangler prints its error (as JSON) on stdout.
    const message = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? error}`;
    if (/no such table: reports/.test(message)) {
      console.log("No reports yet: the site hasn't been sent one.");
      return;
    }
    throw error;
  }
  if (!rows.length) {
    console.log("No new reports.");
    return;
  }
  for (const row of rows) {
    const report = { id: row.id, from: row.from_name, at: row.at, text: row.text, moment: JSON.parse(row.moment) };
    if (dryRun) {
      console.log(`Would file ${row.id}: ${issueTitle(report)}`);
      continue;
    }
    const issue = fileReport(report);
    d1(`UPDATE reports SET issue = ${sqlText(issue)} WHERE id = ${sqlText(row.id)}`);
    console.log(`Filed ${row.id}: ${issue}`);
  }
}

/** The dev table's reports that are kept but not filed yet (vite-battle-report.ts writes them). */
function fileLocalReports(dryRun) {
  if (!existsSync(LOCAL)) return;
  for (const name of readdirSync(LOCAL)
    .filter((each) => each.endsWith(".json"))
    .sort()) {
    const path = join(LOCAL, name);
    const report = JSON.parse(readFileSync(path, "utf8"));
    if (report.issue) continue;
    if (dryRun) {
      console.log(`Would file ${report.id}: ${issueTitle(report)}`);
      continue;
    }
    try {
      const issue = fileReport(report);
      writeFileSync(path, JSON.stringify({ ...report, issue }));
      console.log(`Filed ${report.id}: ${issue}`);
    } catch (error) {
      console.warn(`Couldn't file ${report.id} yet: ${String(error.stderr || error.message || error).trim()}`);
    }
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
fileLocalReports(dryRun);
if (!args.includes("--local")) await fileSiteReports(dryRun);
