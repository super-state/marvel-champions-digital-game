import type { Rect } from "./layout.js";

/** Opening hand preparation keeps the two actions in reach while a long team can scroll on short screens. */
export function matchReviewLayout(width: number, height: number, heroCount: number) {
  const wide = width >= 800;
  const pad = wide ? 28 : 16;
  const column = Math.min(1024, width - 2 * pad);
  const x = (width - column) / 2;
  const header: Rect = { x: 0, y: 0, width, height: height < 480 ? 54 : 64 };
  const back: Rect = { x: 12, y: (header.height - 44) / 2, width: wide ? 110 : 78, height: 44 };
  const actionsWidth = Math.min(column, 628);
  const actionGap = 10;
  const optionsWidth = Math.round((actionsWidth - actionGap) * 0.43);
  const buttonY = height - pad - 50;
  const options: Rect = { x: x + column - actionsWidth, y: buttonY, width: optionsWidth, height: 50 };
  const start: Rect = {
    x: options.x + options.width + actionGap,
    y: buttonY,
    width: actionsWidth - optionsWidth - actionGap,
    height: 50,
  };
  const viewport: Rect = {
    x,
    y: header.height + pad,
    width: column,
    height: Math.max(1, buttonY - pad - header.height - pad),
  };
  const artWidth = wide ? Math.min(370, Math.floor(column * 0.38)) : Math.min(118, Math.round(column * 0.32));
  const heroHeight = wide ? 54 : 46;
  const contentHeight = Math.max(wide ? 352 : 0, (wide ? 192 : 188) + heroCount * heroHeight + 94);
  const top = viewport.y + Math.max(0, (viewport.height - contentHeight) / 2);
  const art: Rect = wide
    ? { x, y: top, width: artWidth, height: contentHeight }
    : { x: x + column - artWidth, y: top, width: artWidth, height: 108 };
  const readingX = wide ? art.x + art.width + pad : x;
  const readingWidth = x + column - readingX;
  return { wide, back, header, viewport, options, start, contentHeight, top, art, readingX, readingWidth, heroHeight };
}
