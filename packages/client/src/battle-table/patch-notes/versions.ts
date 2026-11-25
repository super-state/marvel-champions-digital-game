/** Which patch notes a player hasn't read yet. Pure, so `patch-notes.test.ts` can check it without a page. */
import type { PatchNote } from "./notes.js";

/** Version numbers compared part by part, as numbers: 0.2.10 is newer than 0.2.9. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Every note up to the version being played (a note written ahead of its ship stays hidden), newest first. */
export function notesUpTo(notes: readonly PatchNote[], current: string): PatchNote[] {
  return notes
    .filter((note) => compareVersions(note.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * The notes newer than the last version the player saw, newest first. Nothing seen yet (a new player, or a friend who
 * played before there were notes) is every note: they haven't read any of them.
 */
export function unseenNotes(notes: readonly PatchNote[], lastSeen: string | null, current: string): PatchNote[] {
  return notesUpTo(notes, current).filter((note) => !lastSeen || compareVersions(note.version, lastSeen) > 0);
}
