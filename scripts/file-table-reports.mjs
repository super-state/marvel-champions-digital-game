#!/usr/bin/env node
/**
 * Files the 3D table's bug reports ("Report a bug" in the menu, packages/client/src/battle-table/report/) as GitHub
 * issues on super-state/marvel-champions-digital-game, labelled "player report". Each issue holds the player's words
 * (fenced, as theirs) and the moment on the table; the engine state goes in a secret gist the issue links to.
 *
 *   pnpm table:reports            the test site's new reports: read from its D1 database (wrangler, already signed in
 *                                 on this PC), filed, and marked filed there so they're never filed twice
 *   pnpm table:reports --dry-run  say what would be filed, file nothing
 *   node scripts/file-table-reports.mjs <report.json>
 *                                 one report saved by Adam's dev table (vite-battle-report.ts does this by itself);
 *                                 prints the issue's address
 *
 * Uses the `gh` login on this PC (account super-state). Node strips the types of `issue.ts` and `moment.ts` itself.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { issueTitle, issueBody, ISSUE_REPO, ISSUE_LABEL } =
  await import("../packages/client/src/battle-table/report/issue.ts");
const WRANGLER = join(root, "packages/sync-worker/node_modules/wrangler/bin/wrangler.js");
const DATABASE = "champions-table-players";

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

/** GitHub answered 500s and GraphQL errors now and then on 2026-11-25: each call gets two more tries. */
function gh(args) {
  for (let attempt = 1; ; attempt++) {
    try {
      return run("gh", args);
    } catch (error) {
      if (attempt >= 3) throw error;
      execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 3000)"]);
    }
  }
}

/** Files one report (`ReportRecord`); returns the issue's address. */
function fileReport(report) {
  const work = mkdtempSync(join(tmpdir(), "table-report-"));
  try {
    let stateLink;
    if (report.moment?.state !== undefined) {
      const stateFile = join(work, `${report.id}.json`);
      writeFileSync(stateFile, JSON.stringify(report.moment.state));
      try {
        // A secret gist: not listed anywhere, only reachable from the issue's link.
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
    return gh(["api", `repos/${ISSUE_REPO}/issues`, "--method", "POST", "--input", request, "--jq", ".html_url"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Runs a D1 query on the live database; wrangler runs from a scratch folder (inside the repo it grabs another config). */
function d1(sql) {
  const scratch = mkdtempSync(join(tmpdir(), "table-d1-"));
  try {
    const out = run(process.execPath, [WRANGLER, "d1", "execute", DATABASE, "--remote", "--json", "--command", sql], {
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

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
if (file) console.log(fileReport(JSON.parse(readFileSync(file, "utf8"))));
else await fileSiteReports(args.includes("--dry-run"));
