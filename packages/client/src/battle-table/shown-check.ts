/**
 * "Nothing happens in the game without the table showing it": the watcher every driven game runs under (the fuzz,
 * the deck audits). Tests only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";
import { observeCommits, type CommittedMove } from "./model.js";

const counts = new Map<string, number>();

function watch(move: CommittedMove): void {
  for (const e of move.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
}

/** Watch every committed move of this test file; with SHOWN_OUT set, write what was seen there as a shard. */
export function watchThisFile(name?: string): void {
  beforeAll(() => observeCommits(watch));
  afterAll(() => {
    observeCommits(null);
    const out = process.env.SHOWN_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    const file =
      name ??
      (expect.getState().testPath ?? "unknown")
        .split(/[\\/]/)
        .pop()!
        .replace(/\.test\.ts$/, "");
    writeFileSync(
      join(out, `${file}.json`),
      JSON.stringify({ counts: Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b))) }, null, 1),
    );
  });
}
