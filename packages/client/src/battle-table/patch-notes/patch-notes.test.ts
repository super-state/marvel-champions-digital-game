import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PATCH_NOTES, type PatchNote } from "./notes.js";
import { compareVersions, notesUpTo, unseenNotes } from "./versions.js";

const note = (version: string): PatchNote => ({ version, title: version, changes: [{ kind: "new", text: "x" }] });
const versions = (notes: readonly PatchNote[]) => notes.map((each) => each.version);

describe("patch notes", () => {
  it("compares versions as numbers, part by part", () => {
    expect(compareVersions("0.2.10", "0.2.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.6", "0.2.6")).toBe(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  it("shows only the versions newer than the last one seen, newest first", () => {
    const notes = [note("0.2.4"), note("0.2.6"), note("0.2.5"), note("0.2.10")];
    expect(versions(unseenNotes(notes, "0.2.4", "0.2.10"))).toEqual(["0.2.10", "0.2.6", "0.2.5"]);
    expect(unseenNotes(notes, "0.2.10", "0.2.10")).toEqual([]);
  });

  it("shows every version to someone who has seen none", () => {
    const notes = [note("0.0.1"), note("0.2.0")];
    expect(versions(unseenNotes(notes, null, "0.2.0"))).toEqual(["0.2.0", "0.0.1"]);
  });

  it("never shows a note written ahead of the version being played", () => {
    const notes = [note("0.2.6"), note("0.2.7")];
    expect(versions(notesUpTo(notes, "0.2.6"))).toEqual(["0.2.6"]);
    expect(versions(unseenNotes(notes, null, "0.2.6"))).toEqual(["0.2.6"]);
  });

  it("has notes for the version in table-version.json, so a version bump can't ship without them", () => {
    const { version } = JSON.parse(
      readFileSync(new URL("../test-site/table-version.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(versions(PATCH_NOTES)).toContain(version);
  });

  it("lists each version once, newest first, each with something to say", () => {
    const listed = versions(PATCH_NOTES);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual([...listed].sort((a, b) => compareVersions(b, a)));
    for (const each of PATCH_NOTES) {
      expect(each.title.trim()).not.toBe("");
      expect(each.changes.length).toBeGreaterThan(0);
      for (const change of each.changes) expect(change.text.trim()).not.toBe("");
    }
  });
});
