#!/usr/bin/env node
/**
 * `pnpm table:ship`: puts the 3D table's current version on the test site, https://champions-table.pages.dev (Cloudflare
 * Pages project `champions-table`), where a friend plays it while Adam builds the next one on his own PC.
 *
 * Version numbers (packages/client/src/battle-table/test-site/table-version.json), Adam's rule of 2026-11-23:
 *   - 0.0.1 is Spider-Man vs Rhino playing without bugs; 0.0.0 is the site's placeholder before that; 0.1.0 adds Klaw, 0.2.0 Ultron;
 *   - a bug fix bumps the last number (0.0.2, 0.0.3...);
 *   - each new hero or villain bumps the middle one (0.1.0, 0.2.0...);
 *   - 1.0.0 only when every current set and character is in.
 * The repo's own version (package.json, 0.48.0) is the original project's count and has nothing to do with this.
 *
 * What it does: checks the checkout is clean and on GitHub, runs the 3D table's whole check on it (type check, unit
 * tests and every browser test: a push skips the browser tests, so they run here, once per version; Adam, 2026-11-23),
 * builds the client with the version baked in, bundles the invite lock (src/battle-table/test-site/worker.ts, via
 * wrangler.table.jsonc) into the build as Pages' `_worker.js`, deploys it, then tags the commit `table-v<version>` and
 * pushes the tag to super-state. The `table-` prefix keeps it clear
 * of the `v*` tags that release-on-merge.yml reacts to.
 *
 *   pnpm table:ship              ship the version in table-version.json (refuses one already shipped)
 *   pnpm table:ship --redeploy   ship the same version again (the build only, no new tag)
 *   pnpm table:check             the release check alone, without shipping (every browser test, 3 at a time)
 *
 * The invite key is a Pages secret, set once (and changed to lock out old links; the next deploy picks it up):
 *   node packages/sync-worker/node_modules/wrangler/bin/wrangler.js pages secret put INVITE_KEY
 *     --project-name champions-table   (run from a folder outside the repo)
 * A Pages address, unlike a Worker's workers.dev one, carries no account name.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = path.join(root, "packages/client/wrangler.table.jsonc");
const versionFile = path.join(root, "packages/client/src/battle-table/test-site/table-version.json");
const remote = "super-state";
const project = "champions-table";
const dist = path.join(root, "packages/client/dist");
const redeploy = process.argv.includes("--redeploy");

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
function run(cmd, args, env = {}, cwd = root) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")} failed`);
}
function fail(message) {
  console.error(`\nship-table: ${message}`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(versionFile, "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`table-version.json has "${version}", not x.y.z`);
const tag = `table-v${version}`;

if (git("status", "--porcelain"))
  fail("the checkout has uncommitted changes: ship only what is committed and on GitHub");
const head = git("rev-parse", "HEAD");
git("fetch", remote, "--tags", "--quiet");
const onGitHub = git("branch", "-r", "--contains", head)
  .split("\n")
  .some((b) => b.trim().startsWith(`${remote}/`));
if (!onGitHub) fail(`this commit isn't on ${remote} yet: push it first, so the shipped version can always be found`);

const existing = git("tag", "--list", tag);
if (existing && !redeploy) fail(`${tag} is already shipped: bump table-version.json (or pass --redeploy)`);
if (existing && git("rev-list", "-n", "1", tag) !== head)
  fail(`${tag} points at another commit: bump the version instead`);

if (!redeploy) {
  // Every browser test, on exactly this commit; a pass is remembered, so shipping again after `table:check` is quick.
  console.log(`ship-table: the release check on ${head.slice(0, 9)} (type check, unit tests, every browser test)`);
  run("sh", [".githooks/battle-gate.sh", head], { BATTLE_E2E: "1" });
}

console.log(`ship-table: building ${tag} (${head.slice(0, 9)})`);
run("pnpm", ["--filter", "@mc/client", "build"], { VITE_TABLE_VERSION: version, MC_CARD_ART: "pool" });

// A checkout without the card scans (a fresh worktree: they come from `pnpm assets:fetch`, not git) still builds,
// with every face drawn as a generated frame. Never ship that.
const scans = readdirSync(path.join(dist, "card-art/bundles/cards")).filter((f) => /^\d/.test(f)).length;
if (scans < 1000) fail(`the build carries only ${scans} card scans: run \`pnpm assets:fetch\` first`);

console.log(`ship-table: deploying ${tag}`);
// The lock goes in as `_worker.js` (Pages' "advanced mode"): every page, script and card scan passes through it.
// Wrangler runs from a folder with no wrangler config of its own (packages/sync-worker has one, which newer
// wranglers pick up and try to deploy instead), using the sync Worker's pinned copy.
const wrangler = path.join(root, "packages/sync-worker/node_modules/wrangler/bin/wrangler.js");
const scratch = mkdtempSync(path.join(tmpdir(), "ship-table-"));
const wranglerRun = (...args) => run("node", [wrangler, ...args], {}, scratch);
wranglerRun("deploy", "--dry-run", "--outdir", path.join(scratch, "bundle"), "--config", config);
copyFileSync(path.join(scratch, "bundle", "worker.js"), path.join(dist, "_worker.js"));
wranglerRun(
  "pages",
  "deploy",
  dist,
  "--project-name",
  project,
  "--branch",
  "main",
  "--commit-hash",
  head,
  "--commit-message",
  tag,
);
rmSync(scratch, { recursive: true, force: true });

if (!existing) {
  git("tag", "-a", tag, "-m", `3D table ${version} on the test site`);
  git("push", remote, tag);
}
console.log(
  `\nship-table: ${tag} is live at https://${project}.pages.dev. Invited browsers get it on their next reload.`,
);
