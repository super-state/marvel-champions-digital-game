/** The collection shows one browser at a time. Desktop keeps the selected deck beside it; on a phone its details are a tab. */
import { hit } from "../tokens.js";
import { formFactorFor, type FormFactor, type Rect } from "./layout.js";

export type DecksTab = "decks" | "cards" | "stats";

export interface DecksLayoutInput {
  readonly width: number;
  readonly height: number;
}

export interface DecksLayout {
  readonly formFactor: FormFactor;
  readonly wide: boolean;
  readonly pad: number;
  readonly header: Rect;
  readonly tabs: Rect;
  readonly content: Rect;
  readonly statsPane: Rect | null;
}

export function decksLayoutRects(layout: DecksLayout): readonly Rect[] {
  return [layout.header, layout.tabs, layout.content, ...(layout.statsPane ? [layout.statsPane] : [])];
}

export function decksLayout(input: DecksLayoutInput): DecksLayout {
  const { width, height } = input;
  const formFactor = formFactorFor(width, height);
  const wide = formFactor === "desktop";
  const pad = wide ? 28 : 16;
  const gap = wide ? 24 : 16;
  const column = Math.min(width - pad * 2, wide ? 1560 : 720);
  const left = (width - column) / 2;
  const header: Rect = { x: left, y: pad, width: column, height: hit.target };
  const top = header.y + header.height + gap;
  const statsWidth = wide ? Math.min(410, Math.max(320, column * 0.3)) : 0;
  const statsPane: Rect | null = wide
    ? { x: left + column - statsWidth, y: top, width: statsWidth, height: Math.max(0, height - top - pad) }
    : null;
  const tabs: Rect = { x: left, y: top, width: column - (wide ? statsWidth + gap : 0), height: hit.target };
  const contentTop = tabs.y + tabs.height + 22;
  const content: Rect = { x: left, y: contentTop, width: tabs.width, height: Math.max(0, height - contentTop - pad) };
  return { formFactor, wide, pad, header, tabs, content, statsPane };
}
