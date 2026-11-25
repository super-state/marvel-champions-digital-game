import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BEAT_FIELDS, EVENT_RULES, STANDING } from "./shown-check.js";

/**
 * A beat is not the same as shown: the model makes beats, `main.ts` (`present`) plays them out on the table. Every
 * `BattleBeat` field has a class in `BEAT_FIELDS` (shown-check.ts), and every field called "table" is really played out
 * there. A new beat field fails here until it is classed.
 */
const model = readFileSync(new URL("./model.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The field names of `BattleBeat`, from its interface in model.ts (its top-level members only). */
function beatFields(): string[] {
  const body = /export interface BattleBeat \{([\s\S]*?)\n\}/.exec(model)![1]!;
  const fields: string[] = [];
  let depth = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (depth === 0 && !trimmed.startsWith("*") && !trimmed.startsWith("/")) {
      const m = /^([a-zA-Z]+)\??:/.exec(trimmed);
      if (m) fields.push(m[1]!);
    }
    for (const ch of line.replace(/\/\*.*?\*\/|\/\/.*$/g, "")) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
  }
  return fields;
}

/** The body of `present()` in main.ts, where beats are played out. */
const present = (() => {
  const start = main.indexOf("async function present(");
  const end = main.indexOf("\n}\n", start);
  return main.slice(start, end);
})();

describe("every beat field is classed, and the table really plays out the ones called shown", () => {
  const fields = beatFields();

  test("the fields are read from model.ts", () => {
    expect(fields).toEqual(expect.arrayContaining(["text", "hit", "threat", "reveal", "statusChange"]));
  });

  test("every BattleBeat field has a class", () => {
    expect(fields.filter((field) => !BEAT_FIELDS[field])).toEqual([]);
  });

  test("no class is left for a field that is gone", () => {
    expect(Object.keys(BEAT_FIELDS).filter((field) => !fields.includes(field))).toEqual([]);
  });

  test("every field called shown on the table is played out by present() in main.ts", () => {
    const unplayed = Object.entries(BEAT_FIELDS)
      .filter(([, value]) => value.cls === "table")
      .map(([field]) => field)
      .filter((field) => !new RegExp(`\\b(?:beat|next|later)\\.${field}\\b`).test(present));
    expect(unplayed).toEqual([]);
  });

  test("every class and exemption says where on the table it is seen", () => {
    for (const value of Object.values(BEAT_FIELDS)) expect(value.where.length).toBeGreaterThan(10);
    for (const where of Object.values(STANDING)) expect(where.length).toBeGreaterThan(10);
    for (const rule of Object.values(EVENT_RULES)) {
      if (rule.kind === "beat") expect(rule.what.length).toBeGreaterThan(3);
      else expect(rule.why.length).toBeGreaterThan(5);
    }
  });
});
