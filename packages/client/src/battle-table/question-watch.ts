/**
 * The question tripwire in the tests (`question-check.ts`): every driven game (the fuzz, the deck audits, through
 * `watchThisFile` in shown-check.ts) is watched for a question the table shows only plainly. A plain question not in
 * `KNOWN_PLAIN` fails the file; an unhandled kind always does. Tests only.
 *
 * `QUESTIONS_OUT=<folder>` also writes what each file met: every kind of question reached (so a kind today's cards
 * can raise but no driven game reached shows up as unchecked), the plain ones, and the ones headed only by the
 * engine's catch-all wording ("Choose cards").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect } from "vitest";
import { BattleModel } from "./model.js";
import { ENGINE_HEADINGS, KNOWN_PLAIN, plainQuestion } from "./question-check.js";

export function watchQuestions(name?: string): void {
  const reached = new Map<string, number>();
  const plain = new Map<string, Set<string>>();
  const headings = new Map<string, Set<string>>();
  const original = BattleModel.prototype.snapshot;
  beforeAll(() => {
    BattleModel.prototype.snapshot = function (this: BattleModel) {
      const snapshot = original.call(this);
      const pending = this.game.pendingChoice;
      if (snapshot.choice && pending) {
        const kind = pending.prompt.kind;
        reached.set(kind, (reached.get(kind) ?? 0) + 1);
        const found = plainQuestion(snapshot, this.game);
        if (found) plain.set(found.key, (plain.get(found.key) ?? new Set()).add(found.asker));
        if (ENGINE_HEADINGS.has(snapshot.choice.prompt)) {
          const key = `${kind}: “${snapshot.choice.prompt}”`;
          headings.set(key, (headings.get(key) ?? new Set()).add(snapshot.choice.sourceTitle ?? "?"));
        }
      }
      return snapshot;
    };
  });
  afterAll(() => {
    BattleModel.prototype.snapshot = original;
    const file =
      name ??
      (expect.getState().testPath ?? "unknown")
        .split(/[\\/]/)
        .pop()!
        .replace(/\.test\.ts$/, "");
    const out = process.env.QUESTIONS_OUT;
    const list = (map: Map<string, Set<string>>) =>
      Object.fromEntries(
        [...map].sort(([a], [b]) => a.localeCompare(b)).map(([key, askers]) => [key, [...askers].sort()]),
      );
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(
        join(out, `${file}.json`),
        JSON.stringify(
          { reached: Object.fromEntries([...reached].sort()), plain: list(plain), headings: list(headings) },
          null,
          1,
        ) + "\n",
      );
    }
    const fresh = [...plain]
      .filter(([key]) => !(key in KNOWN_PLAIN))
      .map(([key, askers]) => `${key} (asked by ${[...askers].slice(0, 4).join(", ")})`)
      .sort();
    expect(
      fresh,
      "A question came up that the table shows only as a plain bar of buttons, or cannot show at all " +
        "(question-check.ts). Design a screen for it, or ask Adam whether the plain version will do; only then list it " +
        "in KNOWN_PLAIN. The map of every question: https://claude.ai/artifact/KuRruTjfX6Jc5HwzpJNEFg",
    ).toEqual([]);
  });
}
