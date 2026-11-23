#!/usr/bin/env node
/**
 * `pnpm table:ship`: puts the 3D table's current version on the test site (packages/client/wrangler.table.jsonc), where a
 * friend plays it while Adam builds the next one on his own PC.
 *
 * Version numbers (packages/client/src/battle-table/test-site/table-version.json), Adam's rule of 2026-11-23:
 *   - 0.0.1 is Spider-Man vs Rhino playing without bugs; 0.0.0 is the site's placeholder before that.
 *   - a bug fix bumps the last number (0.0.2, 0.0.3...);
 *   - each new hero or villain bumps the middle one (0.1.0, 0.2.0...);
 *   - 1.0.0 only when every current set and character is in.
 * The repo's own version (package.json, 0.48.0) is the original project's count and has nothing to do with this.
 *
 * What it does: checks the checkout is clean and on GitHub, builds the client with the version baked in, deploys the
 * Worker, then tags the commit `table-v<version>` and pushes the tag to super-state. The `table-` prefix keeps it clear
 * of the `v*` tags that release-on-merge.yml reacts to.
 *
 *   pnpm table:ship              ship the version in table-version.json (refuses one already shipped)
 *   pnpm table:ship --redeploy   ship the same version again (the build only, no new tag)
 *
 * The invite key is a Worker secret, set once (and changed to lock out old links):
 *   pnpm --filter @mc/sync-worker exec wrangler secret put INVITE_KEY --config "$PWD/packages/client/wrangler.table.jsonc"
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = path.join(root, "packages/client/wrangler.table.jsonc");
const versionFile = path.join(root, "packages/client/src/battle-table/test-site/table-version.json");
const remote = "super-state";
const redeploy = process.argv.includes("--redeploy");

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
function run(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
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

console.log(`ship-table: building ${tag} (${head.slice(0, 9)})`);
run("pnpm", ["--filter", "@mc/client", "build"], { VITE_TABLE_VERSION: version, MC_CARD_ART: "pool" });

console.log(`ship-table: deploying ${tag}`);
run("pnpm", ["--filter", "@mc/sync-worker", "exec", "wrangler", "deploy", "--config", config]);

if (!existing) {
  git("tag", "-a", tag, "-m", `3D table ${version} on the test site`);
  git("push", remote, tag);
}
console.log(`\nship-table: ${tag} is live. Invited browsers get it on their next reload.`);
