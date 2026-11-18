import type { Rect } from "./layout.js";

/** The same geometry places each tab, its pointer target, and its keyboard focus ring. */
export function tabCells(rect: Rect, count: number, columns = rect.height > rect.width ? 1 : count): Rect[] {
  if (count === 0) return [];
  const perRow = Math.max(1, Math.min(count, columns));
  const width = rect.width / perRow;
  const height = rect.height / Math.ceil(count / perRow);
  return Array.from({ length: count }, (_, index) => ({
    x: rect.x + (index % perRow) * width,
    y: rect.y + Math.floor(index / perRow) * height,
    width,
    height,
  }));
}
