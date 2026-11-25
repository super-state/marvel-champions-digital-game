/**
 * The test site files a player's bug report on GitHub itself, the moment it arrives (Adam, 2026-11-25: "so nobody has
 * to run pnpm table:reports"). Same issue as the dev table and the filing script (`report/issue.ts`), on the same repo
 * with the same label.
 *
 * It uses the Pages secret `REPORTS_GITHUB_TOKEN`: a fine-grained GitHub token limited to Issues (read and write) on
 * super-state/marvel-champions-digital-game, which Adam made and put in himself. Without it, or when GitHub fails, the
 * report simply stays in the site's database unfiled, as before, and `pnpm table:reports` files it later.
 *
 * Never files a report twice: an error answer can still have made the issue, so before trying again it looks through
 * the player reports for the report's id (as the script does).
 *
 * The engine state isn't put in a gist here (the token can't make one, and the issue is public): the issue links to
 * the copy kept with the report, which only Adam's admin login opens (`GET /api/reports/<id>/state`).
 */
import { ISSUE_LABEL, ISSUE_REPO, issueBody, issueTitle } from "../report/issue.js";
import type { ReportRecord } from "../report/moment.js";
import type { D1Like } from "./players.js";

export interface GitHubFiling {
  token: string;
  /** GitHub's API; another address only for a local test (`GITHUB_API`). */
  api?: string | undefined;
  /** Waits between tries; the tests pass one that doesn't. */
  sleep?: (ms: number) => Promise<void>;
}

const TRIES = 3;
const PAUSE_MS = 1500;
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** What GitHub needs on every call; a Worker's fetch sends no User-Agent of its own, and GitHub refuses a call without one. */
export function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "champions-table-test-site",
    "content-type": "application/json",
  };
}

/** The address of the report's engine state on the site (admin only). */
export const statePath = (id: string) => `/api/reports/${encodeURIComponent(id)}/state`;

/** The issue already made for a report, if any: its id is in the body ("report `<id>`"). */
async function alreadyFiled(gh: GitHubFiling, id: string): Promise<string | null> {
  const api = gh.api ?? "https://api.github.com";
  const response = await fetch(
    `${api}/repos/${ISSUE_REPO}/issues?labels=${encodeURIComponent(ISSUE_LABEL)}&state=all&per_page=100`,
    { headers: githubHeaders(gh.token) },
  );
  if (!response.ok) return null;
  const issues = (await response.json()) as { body?: string | null; html_url: string }[];
  return issues.find((issue) => (issue.body ?? "").includes(`report \`${id}\``))?.html_url ?? null;
}

/**
 * Files one report and notes the issue on its row; the issue's address, or null when it couldn't be filed (it stays
 * in the database for `pnpm table:reports`). Never throws.
 */
export async function fileSiteReport(
  db: D1Like,
  report: ReportRecord,
  gh: GitHubFiling,
  origin: string,
): Promise<string | null> {
  const api = gh.api ?? "https://api.github.com";
  const sleep = gh.sleep ?? wait;
  const stateLink = report.moment.state !== undefined ? `${origin}${statePath(report.id)}` : undefined;
  const request = JSON.stringify({
    title: issueTitle(report),
    body: issueBody(report, stateLink, { behindLogin: true }),
    labels: [ISSUE_LABEL],
  });
  let issue: string | null = null;
  for (let attempt = 1; attempt <= TRIES && !issue; attempt++) {
    let status = 0;
    try {
      const response = await fetch(`${api}/repos/${ISSUE_REPO}/issues`, {
        method: "POST",
        headers: githubHeaders(gh.token),
        body: request,
      });
      status = response.status;
      if (response.ok) {
        const made = (await response.json()) as { html_url: string; labels?: { name: string }[] };
        // Without the label a later look for this report wouldn't find the issue (and the script could file it again).
        if (!(made.labels ?? []).some((label) => label.name === ISSUE_LABEL))
          console.warn(`Report ${report.id} was filed without the "${ISSUE_LABEL}" label: ${made.html_url}`);
        issue = made.html_url;
        break;
      }
      console.warn(`GitHub answered ${status} filing report ${report.id}: ${(await response.text()).slice(0, 300)}`);
    } catch (error) {
      console.warn(`Couldn't reach GitHub filing report ${report.id}: ${String(error)}`);
    }
    // An error answer can still have made the issue: look before trying again.
    await sleep(PAUSE_MS);
    issue = await alreadyFiled(gh, report.id).catch(() => null);
    // A refusal (bad or expired token, no access, a body GitHub won't take) won't change on a second try.
    if (status >= 400 && status < 500 && status !== 429) break;
  }
  if (!issue) return null;
  try {
    await db.prepare("UPDATE reports SET issue = ? WHERE id = ?").bind(issue, report.id).run();
  } catch (error) {
    // The issue is made; the script would find it by the report's id rather than file it again.
    console.error(`Report ${report.id} is filed (${issue}) but couldn't be marked so: ${String(error)}`);
  }
  return issue;
}
