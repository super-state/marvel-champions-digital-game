import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { parseReport, REPORT_LIMIT, type ReportRecord } from "./src/battle-table/report/moment.js";

/**
 * "Report a bug" on Adam's own dev table (dev server only): `POST /api/reports` keeps the report in
 * `packages/client/.battle-reports/` (not in git) and files it on GitHub straight away with this PC's `gh` login, through
 * the same script that files the test site's reports (`scripts/file-table-reports.mjs`). On the test site the site
 * itself takes the report (`src/battle-table/test-site/site-api.ts`).
 *
 * The answer comes once the issue is made (a few seconds). A report that couldn't be filed (GitHub down) is still kept
 * and the table says it was sent: the script files every kept report that has no issue yet each time it runs, so it
 * goes with the next report, or with `pnpm table:reports`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FOLDER = join(here, ".battle-reports");
const SCRIPT = resolve(here, "../../scripts/file-table-reports.mjs");

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((done) => {
    let text = "";
    let tooBig = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (tooBig) return;
      text += chunk;
      if (text.length > REPORT_LIMIT) tooBig = true;
    });
    req.on("end", () => done(tooBig ? null : text));
    req.on("error", () => done(null));
  });
}

function answer(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function battleReportPlugin(): Plugin {
  return {
    name: "mc-battle-report",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/reports", async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "POST") return answer(res, 405, { error: "Send a report with POST." });
        const text = await readBody(req);
        let report = null;
        try {
          report = text ? parseReport(JSON.parse(text)) : null;
        } catch {
          report = null;
        }
        if (!report) return answer(res, 400, { error: "Type what happened first." });
        const at = Date.now();
        const record: ReportRecord = { ...report, id: `dev-${at.toString(36)}`, from: "Dev table (this PC)", at };
        mkdirSync(FOLDER, { recursive: true });
        const file = join(FOLDER, `${record.id}.json`);
        writeFileSync(file, JSON.stringify(record));
        execFile(process.execPath, [SCRIPT, "--local"], { timeout: 120_000 }, (error, stdout, stderr) => {
          if (stdout.trim()) server.config.logger.info(`Report a bug: ${stdout.trim()}`);
          let issue: string | undefined;
          try {
            issue = (JSON.parse(readFileSync(file, "utf8")) as { issue?: string }).issue;
          } catch {
            issue = undefined;
          }
          if (!issue) {
            server.config.logger.warn(
              `Report a bug: kept ${file}, not filed yet: ${(stderr || String(error ?? "")).trim()}`,
            );
            return answer(res, 200, { saved: true, filed: false, id: record.id });
          }
          answer(res, 200, { saved: true, filed: true, id: record.id, issue });
        });
      });
    },
  };
}
