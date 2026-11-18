import { HOLD_SLOP_PX, INSPECT_HOLD_MS } from "./hold-gesture.js";
import type { Rect } from "./layout.js";

/** A mouse must leave its press upward before the ordinary long-press Inspect wins. */
export class HandLift {
  #phase: "pressed" | "carrying" | "ended" = "pressed";

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  move(_x: number, y: number, elapsed: number): "pressed" | "carrying" | "ended" {
    if (this.#phase !== "pressed") return this.#phase;
    const up = this.y - y;
    if (elapsed >= INSPECT_HOLD_MS || up <= -HOLD_SLOP_PX) this.#phase = "ended";
    else if (up >= HOLD_SLOP_PX) this.#phase = "carrying";
    return this.#phase;
  }

  /** A deliberate release on the visible playfield. Only the original card's tap may be activated, once. */
  release(x: number, y: number, area: Rect, canceled: boolean): boolean {
    const play = this.#phase === "carrying" && !canceled && overTable(x, y, area);
    this.#phase = "ended";
    return play;
  }
}

export function overTable(x: number, y: number, area: Rect): boolean {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}
