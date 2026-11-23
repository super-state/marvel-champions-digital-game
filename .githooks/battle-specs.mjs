#!/usr/bin/env node
// Which of the 3D table's browser tests a push needs, from the files it changes (Adam, 2026-11-23: run only the tests
// a change can affect).
//
//   node .githooks/battle-specs.mjs <base> <commit>
//
// Prints the spec file names to run, one per line, or nothing when no browser test can be affected. With no base, or
// when anything changes that the whole table runs on, prints every `battle` spec.
//
// Every browser test opens the whole table, so a change to the table's own code (`main.ts`, `table.ts`, `model.ts`,
// the styles, the borrowed 2D code, the rules and cards) runs all of them. Only the parts that are their own corner of
// the table, with a browser test of their own, narrow it down:
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const T = "packages/client/src/battle-table/";
const AREAS = [
  // A unit test or a note changes no page.
  [new RegExp(`^${T}.*\\.test\\.ts$`), []],
  [/\.md$/, []],
  // The controller (pad) and its own test.
  [new RegExp(`^${T}pad/`), ["battle-controller.spec.ts"]],
  // The Sound Studio, the sounds and their pictures of the table.
  [new RegExp(`^${T}studio/`), ["battle-studio.spec.ts"]],
  [/^packages\/client\/battle\/studio\.html$/, ["battle-studio.spec.ts"]],
  [new RegExp(`^${T}(sound[^/]*|sfx/.*)$`), ["battle-sound.spec.ts", "battle-studio.spec.ts"]],
  // Claude's play hook (dev server only).
  [new RegExp(`^${T}play\\.ts$`), ["battle-play-hook.spec.ts"]],
  [new RegExp(`^${T}picture-retry\\.ts$`), ["battle-picture-retry.spec.ts"]],
  // A browser test itself: that test. The old game's specs never run on a push.
  [/^packages\/client\/e2e\/(battle[^/]*\.spec\.ts)$/, (m) => [m[1]]],
  [/^packages\/client\/e2e\/[^/]*\.spec\.ts$/, []],
];

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const every = readdirSync(join(root, "packages/client/e2e"))
  .filter((name) => /battle.*\.spec\.ts$/.test(name))
  .sort();

const [base, sha = "HEAD"] = process.argv.slice(2);
let changed = null;
if (base) {
  try {
    changed = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", base, sha, "--", "packages", "pnpm-lock.yaml"],
      {
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    changed = null;
  }
}

const picked = new Set();
let all = changed === null;
for (const file of changed ?? []) {
  const area = AREAS.find(([pattern]) => pattern.test(file));
  if (!area) {
    all = true;
    break;
  }
  const specs = typeof area[1] === "function" ? area[1](file.match(area[0])) : area[1];
  for (const spec of specs) picked.add(spec);
}

const out = all ? every : every.filter((name) => picked.has(name));
if (out.length) console.log(out.join("\n"));
