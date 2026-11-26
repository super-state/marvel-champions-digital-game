/**
 * "What's new" (Adam, 2026-11-25: a pop-up on load when the player hasn't seen a version's patch notes; easy to
 * understand, scrollable, and closable at any time). It opens over the room once the boxes are up, lists every
 * version the player hasn't read (newest first, the oldest folded away when there are several), and remembers the
 * version once it is closed by any route: Continue, the cross, Escape, a click outside, or B on a pad. "What's new" at
 * the foot of the table's menu opens it again with every version.
 *
 * Kept in its own folder with one hook in `main.ts` so it can be picked onto a release branch on its own.
 */
import "./patch-notes.css";
import { icon } from "../icons.js";
import { PATCH_NOTES, type ChangeKind, type PatchNote } from "./notes.js";
import { notesUpTo, unseenNotes } from "./versions.js";

/** The last version whose notes this browser has seen. */
export const SEEN_KEY = "battle-notes-seen";

/** The version being played: the one `table:ship` builds, which the main line keeps in step. */
export const CURRENT_VERSION =
  import.meta.glob<string>("../test-site/table-version.json", { import: "version", eager: true })[
    "../test-site/table-version.json"
  ] ?? "0.0.0";

const KIND_LABEL: Record<ChangeKind, string> = { new: "New", better: "Better", fixed: "Fixed" };
/** Versions shown open; older unread ones start folded, so a long list still starts short. */
const OPEN_VERSIONS = 2;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function lastSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, CURRENT_VERSION);
  } catch {
    // Storage switched off: they see the notes again next time, which does no harm.
  }
}

function versionBlock(note: PatchNote, open: boolean, fresh: boolean): HTMLDetailsElement {
  const block = make("details", "notes-version");
  block.open = open;
  const summary = make("summary", "notes-version-head");
  const number = make("span", "notes-version-number", `Version ${note.version}`);
  const title = make("span", "notes-version-title", note.title);
  summary.append(number, title);
  if (fresh) summary.append(make("span", "notes-fresh", "New to you"));
  const list = make("ul", "notes-changes");
  for (const change of note.changes) {
    const item = make("li", "notes-change");
    item.dataset.kind = change.kind;
    item.append(make("span", "notes-kind", KIND_LABEL[change.kind]), make("span", "notes-text", change.text));
    list.append(item);
  }
  block.append(summary, list);
  return block;
}

let dialog: HTMLDialogElement | null = null;

/** Builds the dialog for `notes` (newest first); `unread` marks the versions new to this player. */
function build(notes: readonly PatchNote[], unread: ReadonlySet<string>): HTMLDialogElement {
  dialog?.remove();
  const d = make("dialog", "notes-dialog");
  d.id = "patch-notes";
  d.setAttribute("aria-labelledby", "patch-notes-title");

  const head = make("header", "notes-head");
  const heading = make("div", "notes-heading");
  const newest = notes[0]!;
  heading.append(
    make("p", "eyebrow", "What's new"),
    make("h2", "notes-title", unread.size ? "The game has been updated" : "Patch notes"),
    make(
      "p",
      "notes-sub",
      unread.size > 1
        ? `${unread.size} updates since you last looked. You're on version ${newest.version}.`
        : `You're on version ${newest.version}.`,
    ),
  );
  heading.lastElementChild!.id = "patch-notes-sub";
  heading.children[1]!.id = "patch-notes-title";
  const cross = make("button", "notes-close");
  cross.type = "button";
  cross.setAttribute("aria-label", "Close");
  cross.title = "Close";
  cross.append(icon("close"));
  cross.addEventListener("click", () => d.close());
  head.append(heading, cross);

  // The notes scroll; the heading and Continue stay put, so either is always one press away.
  const body = make("div", "notes-body");
  body.tabIndex = 0;
  body.setAttribute("aria-label", "Patch notes");
  // "New to you" only says something when some of the list was read before (the menu's full list).
  const mixed = unread.size < notes.length;
  notes.forEach((note, i) => body.append(versionBlock(note, i < OPEN_VERSIONS, mixed && unread.has(note.version))));

  const foot = make("footer", "notes-foot");
  const go = make("button", "btn btn-primary notes-continue", "Continue");
  go.type = "button";
  go.autofocus = true;
  // B on a pad presses this (`pad/controller.ts`).
  go.dataset.padBack = "";
  go.addEventListener("click", () => d.close());
  foot.append(go);

  d.append(head, body, foot);
  d.addEventListener("close", () => {
    markSeen();
    d.remove();
    if (dialog === d) dialog = null;
  });
  // A click on the dim backdrop (outside the box) closes it too.
  d.addEventListener("click", (event) => {
    if (event.target !== d) return;
    const box = d.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) d.close();
  });
  document.body.append(d);
  dialog = d;
  return d;
}

function show(notes: readonly PatchNote[], unread: ReadonlySet<string>) {
  if (!notes.length) return;
  const d = build(notes, unread);
  // The room makes the page under it inert; this sits over the room.
  d.inert = false;
  d.showModal();
}

/** Whether the notes are open (the table and the room leave the keys alone meanwhile). */
export const patchNotesOpen = () => !!dialog?.open;

/**
 * Opens the notes the player hasn't seen, if there are any. `?notes` opens them whatever was seen (to look at them).
 * Not inside the Sound Studio's frame, and not for a browser test that hasn't asked (`?notes`): every test starts with
 * nothing read, and the notes would stand over whatever it came to check.
 */
export function offerPatchNotes(): void {
  if (window.top !== window || patchNotesOpen()) return;
  const forced = new URLSearchParams(location.search).has("notes");
  if (navigator.webdriver && !forced && !lastSeen()) return;
  const unread = unseenNotes(PATCH_NOTES, forced ? null : lastSeen(), CURRENT_VERSION);
  if (!unread.length) return;
  show(unread, new Set(unread.map((note) => note.version)));
}

/** Every version's notes, from the menu. */
export function openAllPatchNotes(): void {
  const seen = lastSeen();
  const unread = unseenNotes(PATCH_NOTES, seen, CURRENT_VERSION);
  show(notesUpTo(PATCH_NOTES, CURRENT_VERSION), new Set(unread.map((note) => note.version)));
}

/** "What's new" at the foot of the table's menu (beside Report a bug, which makes the foot). */
export function installPatchNotesButton(menu: HTMLDialogElement): void {
  const button = make("button", "btn btn-ghost menu-notes", "What's new");
  button.type = "button";
  button.id = "menu-notes";
  button.addEventListener("click", () => {
    menu.close();
    openAllPatchNotes();
  });
  let foot = menu.querySelector(".menu-foot");
  if (!foot) {
    foot = make("div", "menu-foot");
    menu.append(foot);
  }
  foot.prepend(button);
}

// Keys belong to the notes while they are open: the room (any key at its doorway, Escape for Back) and the table
// (Enter for End Turn, Escape for its menu, Ctrl+Z) listen on the page too. This listens on the window in the capture
// phase and is added before the room loads, so it runs first; the browser still does what the key means in the
// dialog (Tab, Enter on a button, Escape to close, arrows to scroll).
addEventListener(
  "keydown",
  (event) => {
    if (patchNotesOpen()) event.stopImmediatePropagation();
  },
  { capture: true },
);
