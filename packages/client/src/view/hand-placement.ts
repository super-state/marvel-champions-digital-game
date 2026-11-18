import { CARD_ASPECT, type Rect } from "./layout.js";

export const HAND_PLACEMENT_MS = 230;

/** Reserve a place at the end of the visible player row for the action still being decided. */
export function handPlacementSlot(area: Rect, window: Rect, landscape: boolean): Rect | null {
  const top = Math.max(area.y + 24, window.y) + 6;
  const bottom = Math.min(area.y + area.height, window.y + window.height) - 10;
  const aspect = landscape ? 1 / CARD_ASPECT : CARD_ASPECT;
  const width = Math.min(148, Math.floor(area.width * 0.42), (bottom - top) * aspect);
  if (width < 40) return null;
  const height = width / aspect;
  return { x: area.x + area.width - width - 12, y: (top + bottom - height) / 2, width, height };
}

/** The same flight starts from the raised hand card on click or from the released card on drop. */
export function handPlacementAt(from: Rect, to: Rect, elapsed: number): Rect {
  const t = Math.min(1, Math.max(0, elapsed / HAND_PLACEMENT_MS));
  const along = t * t * (3 - 2 * t);
  const mix = (a: number, b: number): number => a + (b - a) * along;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y) - Math.sin(Math.PI * t) * 14,
    width: mix(from.width, to.width),
    height: mix(from.height, to.height),
  };
}
