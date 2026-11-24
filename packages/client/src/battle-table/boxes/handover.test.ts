import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACK_MS, HOLD, READY, START, startWhenHandedOver, type HandoverWindow } from "./handover.js";

const ORIGIN = "http://localhost:5173";

type Listener = (event: { origin: string; data: unknown }) => void;

function fakeWindow(options: { framed: boolean; search: string; parentOrigin?: string | "unreadable" }) {
  const listeners = new Set<Listener>();
  const posted: unknown[] = [];
  const parentLocation =
    options.parentOrigin === "unreadable"
      ? {
          get origin(): string {
            throw new Error("cross-origin");
          },
        }
      : { origin: options.parentOrigin ?? ORIGIN };
  const win: HandoverWindow & { send(data: unknown, origin?: string): void; posted: unknown[] } = {
    location: { origin: ORIGIN, search: options.search },
    parent: { postMessage: (message) => posted.push(message), location: parentLocation },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    send(data, origin = ORIGIN) {
      for (const listener of [...listeners]) listener({ origin, data });
    },
    posted,
  };
  if (!options.framed) (win as { parent: unknown }).parent = win;
  return win;
}

describe("startWhenHandedOver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts at once on a page of its own, whatever the address says", () => {
    const start = vi.fn();
    startWhenHandedOver(fakeWindow({ framed: false, search: "?handover" }), start);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts at once in a frame that didn't ask for the hand-over", () => {
    const start = vi.fn();
    startWhenHandedOver(fakeWindow({ framed: true, search: "?seed=4" }), start);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts at once in another site's frame", () => {
    const start = vi.fn();
    startWhenHandedOver(fakeWindow({ framed: true, search: "?handover", parentOrigin: "unreadable" }), start);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("waits, held by the boxes page, until it says start", () => {
    const start = vi.fn();
    const win = fakeWindow({ framed: true, search: "?handover" });
    startWhenHandedOver(win, start);
    expect(win.posted).toEqual([READY]);
    win.send(HOLD);
    vi.advanceTimersByTime(ACK_MS * 20);
    expect(start).not.toHaveBeenCalled();
    win.send(START, "http://elsewhere.test");
    expect(start).not.toHaveBeenCalled();
    win.send(START);
    win.send(START);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts anyway when nothing answers its ready", () => {
    const start = vi.fn();
    startWhenHandedOver(fakeWindow({ framed: true, search: "?handover" }), start);
    vi.advanceTimersByTime(ACK_MS - 1);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
