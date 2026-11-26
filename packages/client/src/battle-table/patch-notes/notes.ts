/**
 * The patch notes players read when the table opens on a version they haven't seen (Adam, 2026-11-25: "user friendly
 * and easy to understand"). Newest first. One entry per version in `test-site/table-version.json`: bumping that file
 * without an entry here fails `patch-notes.test.ts`.
 *
 * Written for players, not for us: what they will notice, in their words. No file names, no test or tooling changes,
 * nothing only Adam's own table has (Sound Studio, the play hook). A line or two per change; three to five changes a
 * version is plenty.
 */

export type ChangeKind = "new" | "better" | "fixed";

export interface Change {
  readonly kind: ChangeKind;
  readonly text: string;
}

export interface PatchNote {
  /** As in `table-version.json`, e.g. "0.2.6". */
  readonly version: string;
  /** A few words that sum the version up. */
  readonly title: string;
  readonly changes: readonly Change[];
}

export const PATCH_NOTES: readonly PatchNote[] = [
  {
    version: "0.2.8",
    title: "Clearer choices",
    changes: [
      {
        // PRs 193, 195 (Adam, 2026-11-25).
        kind: "better",
        text: "When an encounter card makes you choose, like Android Efficiency's boost (pay a resource or take a Drone), it stays in front of you with its name on the question, and each choice is its own button.",
      },
      {
        // PRs 195, 202, 203, 205 (Adam, 2026-11-26).
        kind: "better",
        text: "Choosing to pay lights up everything that can pay, on the table and in your hand, and the card moves up out of the way. Back takes you to the choice again.",
      },
      {
        // PR 202 (Adam, 2026-11-26).
        kind: "fixed",
        text: "Cards you can pick are never left in the dark while the table asks you something.",
      },
      {
        // PR 196 (Adam, 2026-11-26: "lets put this into next release").
        kind: "fixed",
        text: "A side scheme now lands on the table empty and gets its threat one step at a time, as the table counts it. Before, Drone Factory landed with all its threat at once, then lost some and got it back.",
      },
    ],
  },
  {
    version: "0.2.7",
    title: "A smoother shelf",
    changes: [
      {
        kind: "better",
        text: "At the villain boxes, the camera now drifts gently after your mouse instead of jumping to it.",
      },
    ],
  },
  {
    version: "0.2.6",
    title: "Numbers you can trust",
    changes: [
      {
        kind: "fixed",
        text: "Health and threat counters always show the real number. Before, a counter could show the wrong total for a moment until the table caught up.",
      },
    ],
  },
  {
    version: "0.2.5",
    title: "Tell us what went wrong",
    changes: [
      {
        kind: "new",
        text: "Report a bug: open the menu and press Report a bug at the bottom. Say what happened in your own words; what's on the table is sent along with it.",
      },
      {
        kind: "fixed",
        text: "An Ultron Drone arriving in the middle of a move no longer counts the scheme's threat twice.",
      },
    ],
  },
  {
    version: "0.2.4",
    title: "Clearer choices",
    changes: [
      {
        kind: "better",
        text: "When Guard stops you attacking the villain, the table explains why: a minion with Guard has to be dealt with first.",
      },
      {
        kind: "new",
        text: "Cards that search your deck now lay the cards out so you can see them and pick one.",
      },
      {
        kind: "better",
        text: "When a card asks you to pick, the question uses that card's own words.",
      },
    ],
  },
  {
    version: "0.2.3",
    title: "Your hand, your way",
    changes: [
      {
        kind: "new",
        text: "Drag a card along your hand to put your cards in the order you like.",
      },
      {
        kind: "fixed",
        text: "A card you start to play and then cancel or undo goes back to the same place in your hand.",
      },
    ],
  },
  {
    version: "0.2.2",
    title: "Faster pictures",
    changes: [
      {
        kind: "better",
        text: "Card pictures start loading as the game is dealt, so cards no longer turn over blank while they download.",
      },
      {
        kind: "fixed",
        text: "Copy link works even when your browser won't let the page use the clipboard.",
      },
      {
        kind: "better",
        text: 'Shared links now say "Marvel Champions" instead of the last matchup played.',
      },
    ],
  },
  {
    version: "0.2.1",
    title: "Your own record",
    changes: [
      {
        kind: "new",
        text: "Your own player link: open it on any device and your games come with you.",
      },
      {
        kind: "new",
        text: "Every game is saved. Beat a villain to unlock the next one: Rhino, then Klaw, then Ultron.",
      },
      {
        kind: "fixed",
        text: "On MacBooks and in Safari: the card panel fits short windows, the blur behind pop-ups works, and shortcuts show Mac key names.",
      },
      {
        kind: "fixed",
        text: "Discard piles and deck counts no longer cover other cards.",
      },
    ],
  },
  {
    version: "0.2.0",
    title: "Klaw and Ultron arrive",
    changes: [
      {
        kind: "new",
        text: "Two new villains: Klaw, and Ultron with his Drones that fly off your own deck to fight for him.",
      },
      {
        kind: "new",
        text: "The villain boxes: pick a box from the table, and the mat rolls out as each piece lands on it.",
      },
      {
        kind: "better",
        text: "When a card asks you to put enemies in order, each one shows its number as you pick.",
      },
    ],
  },
  {
    version: "0.0.1",
    title: "The first game",
    changes: [
      { kind: "new", text: "Spider-Man against Rhino on a 3D table." },
      { kind: "new", text: "Sound effects for cards, hits and threat, and confetti when you win." },
    ],
  },
];
