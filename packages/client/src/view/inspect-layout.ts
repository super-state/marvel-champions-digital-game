import type { Rect } from "./layout.js";

/** A single spread, with a permanent page switcher and enough room for prose even on a short phone. */
export function readingLayout(width: number, height: number, hasActions: boolean) {
  const compact = width < 720;
  const margin = compact || height < 450 ? 0 : 24;
  const w = Math.max(1, Math.min(1040, width - margin * 2));
  const h = Math.max(1, Math.min(730, height - margin * 2));
  const x = Math.round((width - w) / 2);
  const y = Math.round((height - h) / 2);
  const headerHeight = compact ? 56 : 64;
  const tabHeight = 46;
  const actionHeight = hasActions ? 62 : 0;
  const frame: Rect = { x, y, width: w, height: h };
  const header = { ...frame, height: headerHeight };
  const tabs = { ...frame, y: y + headerHeight, height: tabHeight };
  const footer = { ...frame, y: y + h - actionHeight, height: actionHeight };
  const body = { ...frame, y: tabs.y + tabHeight, height: Math.max(1, footer.y - tabs.y - tabHeight) };
  const artWidth = compact ? 0 : Math.floor(w * 0.36);
  const art = artWidth ? { ...body, width: artWidth } : null;
  const text = { ...body, x: x + artWidth, width: w - artWidth };
  return { frame, header, tabs, body, footer, art, text, compact };
}

const SHEET_THUMB = { width: 116, height: 164 } as const;

/** The optional inline thumbnail follows a landscape scan's proportions. */
export function thumbSizeFor(source: { readonly width: number; readonly height: number } | null): {
  readonly width: number;
  readonly height: number;
} {
  if (!source || source.width <= 0 || source.height <= 0 || source.width <= source.height) return SHEET_THUMB;
  return {
    width: SHEET_THUMB.width,
    height: Math.min(SHEET_THUMB.height, Math.round((SHEET_THUMB.width * source.height) / source.width)),
  };
}
