/**
 * The hand-over from the campaign boxes page (`boxes.html`) to the table. The boxes page loads the table page early,
 * in a hidden frame with `?handover`, so it is ready by the time Play is pressed; the table then waits, loaded but
 * not started, until the boxes page has played its move onto the table and says go.
 *
 * Only that case waits. A table page on its own (the address bar, the test site, a test) starts at once, as it always
 * has; so does one framed by anything that doesn't answer: the table says it is ready, and if no "hold" comes back
 * within `ACK_MS` it starts anyway.
 */

/** Table → boxes: loaded and waiting. */
export const READY = "mc-boxes:ready";
/** Boxes → table: wait for the word. */
export const HOLD = "mc-boxes:hold";
/** Boxes → table: start the game now. */
export const START = "mc-boxes:start";
export const ACK_MS = 3000;

/** What the hand-over needs of a window: enough to fake in a test. */
export interface HandoverWindow {
  readonly location: { readonly origin: string; readonly search: string };
  readonly parent: {
    postMessage(message: unknown, targetOrigin: string): void;
    readonly location?: { origin: string };
  };
  addEventListener(type: "message", listener: (event: { origin: string; data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { origin: string; data: unknown }) => void): void;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** Framed by a page of this same site that asked for the hand-over (`?handover`). */
export function asksForHandover(win: HandoverWindow): boolean {
  if ((win.parent as unknown) === win) return false;
  if (!new URLSearchParams(win.location.search).has("handover")) return false;
  try {
    return win.parent.location?.origin === win.location.origin;
  } catch {
    // A frame of another site can't be read: not ours.
    return false;
  }
}

/** Calls `start` now, or, when the boxes page hosts this table, when it says go. */
export function startWhenHandedOver(win: HandoverWindow, start: () => void): void {
  if (!asksForHandover(win)) {
    start();
    return;
  }
  let started = false;
  let held = false;
  const go = () => {
    if (started) return;
    started = true;
    win.removeEventListener("message", listen);
    win.clearTimeout(timer);
    start();
  };
  const listen = (event: { origin: string; data: unknown }) => {
    if (event.origin !== win.location.origin) return;
    if (event.data === START) go();
    else if (event.data === HOLD && !held) {
      held = true;
      win.clearTimeout(timer);
    }
  };
  win.addEventListener("message", listen);
  const timer = win.setTimeout(go, ACK_MS);
  win.parent.postMessage(READY, win.location.origin);
}
