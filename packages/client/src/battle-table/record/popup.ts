/**
 * "Achievement unlocked": a small card at the top of the table when a finished game earns one or more, all of them in
 * one card. No sound. It goes on a click, any key or any controller button, and when the game-over panel closes.
 *
 * It sits inside the game-over panel while that is open: a modal dialog leaves everything outside it untouchable. It
 * never takes the focus from Try Again, except while a controller is in use, so that A puts it away rather than
 * dealing the next game.
 */
import "./record.css";
import type { Achievement } from "./achievements.js";

const ID = "achievement-popup";

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

let stopListening: (() => void) | null = null;

/** Puts the pop-up away, if one is up. */
export function dismissAchievements(): void {
  stopListening?.();
  stopListening = null;
  document.getElementById(ID)?.remove();
}

/** The controller buttons held down now, so a button already held when the pop-up appeared doesn't put it away. */
function padButtonsDown(): Set<string> {
  const down = new Set<string>();
  const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
  for (const pad of pads)
    pad?.buttons.forEach((button, i) => {
      if (button.pressed) down.add(`${pad.index}:${i}`);
    });
  return down;
}

/** Shows what a game earned; nothing when it earned nothing. */
export function announceAchievements(earned: readonly Achievement[]): void {
  dismissAchievements();
  if (!earned.length) return;
  const card = make("button", "achievement-popup");
  card.id = ID;
  card.type = "button";
  card.setAttribute("aria-live", "polite");
  card.setAttribute(
    "aria-label",
    `${earned.length === 1 ? "Achievement" : "Achievements"} unlocked: ${earned.map((a) => a.name).join(", ")}. Press to close.`,
  );
  const list = make("ul", "achievement-popup-list");
  for (const a of earned) {
    const row = make("li");
    row.append(make("b", "", a.name), make("span", "", a.how));
    list.append(row);
  }
  card.append(
    make("span", "achievement-popup-badge"),
    make("p", "eyebrow", earned.length === 1 ? "Achievement unlocked" : `${earned.length} achievements unlocked`),
    list,
  );

  const host = document.querySelector<HTMLDialogElement>("dialog#game-over[open]") ?? document.body;
  host.append(card);
  const before = document.activeElement as HTMLElement | null;
  /** `refocus`: hand the focus back to where it was. Not for a controller button: the controller may be pressing the
   * focused button with the same press, which must not then land on Try Again. */
  const putAway = (refocus = true) => {
    const hadFocus = document.activeElement === card;
    dismissAchievements();
    if (hadFocus && refocus) before?.focus({ preventScroll: true });
  };
  card.addEventListener("click", () => putAway());

  // Any key puts it away. Escape, Enter and Space only do that: Escape would close the panel too, and Enter or Space
  // would press Try Again.
  const onKey = (event: KeyboardEvent) => {
    if (["Escape", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    putAway();
  };
  window.addEventListener("keydown", onKey, true);

  // Any controller button newly pressed puts it away; with a pad in use the pop-up holds the focus, so A presses it.
  if (document.documentElement.dataset.input === "pad") card.focus({ preventScroll: true });
  const held = padButtonsDown();
  let frame = 0;
  const watch = () => {
    const down = padButtonsDown();
    for (const button of down)
      if (!held.has(button)) {
        putAway(false);
        return;
      }
    for (const button of held) if (!down.has(button)) held.delete(button);
    frame = requestAnimationFrame(watch);
  };
  frame = requestAnimationFrame(watch);

  const panel = host instanceof HTMLDialogElement ? host : null;
  const onClose = () => dismissAchievements();
  panel?.addEventListener("close", onClose);

  stopListening = () => {
    window.removeEventListener("keydown", onKey, true);
    cancelAnimationFrame(frame);
    panel?.removeEventListener("close", onClose);
  };
}
