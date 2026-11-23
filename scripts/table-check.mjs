#!/usr/bin/env node
/**
 * `pnpm table:check`: the 3D table's release check on the current commit, without shipping it: the type check, the
 * unit tests and every browser test (three at a time unless `BATTLE_E2E_WORKERS` says otherwise). A push runs only the
 * first two; this is the rest, run before a version is cut (`pnpm table:ship` runs it too). A pass is remembered by the
 * code's content, so shipping the same code afterwards does not run it again.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const result = spawnSync("sh", [".githooks/battle-gate.sh", "HEAD"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, BATTLE_E2E: "1" },
});
process.exit(result.status ?? 1);
