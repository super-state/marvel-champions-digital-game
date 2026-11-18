/**
 * The bridge from design tokens to Phaser drawing calls.
 *
 * Every widget goes through here, so the state matrix in Components.dc.html
 * section 03 is implemented once: rest / hover / selected / unavailable, solid
 * border = available, dashed = not yet real, 40% ink = illegal right now.
 * Hover swaps ground and ink and never moves or scales an element — that is a
 * stated rule of the system, and it is enforced by the fact that nothing here
 * returns a scale or an offset.
 */

import type Phaser from "phaser";
import { font, ink, surface, tabletop, type TypeSpec } from "../tokens.js";
import type { FaceFont } from "../art/card-face.js";

/**
 * Bangers is a hand-lettered, slanted face — its rightmost glyphs (the tail of a
 * cursive "T", the lean on "Y"/"D"/"N"…) draw past the metrics-reported advance
 * width Phaser measures the text box from, so a right-aligned or tightly-fit
 * container clips them ("READY", "EXHAUSTED", "DISCOUNT" losing their last
 * glyph's right edge — found on the Rules overlay's Card list/Glossary tabs).
 * A few px of right padding gives the slant somewhere to draw without changing
 * the glyphs' own left-origin position (Phaser's text canvas only grows to the
 * right when `padding.left` is 0, so origin-0 callers never shift).
 */
const BANGERS_RIGHT_PADDING = 6;

/** The four states every control can be in. */
export type WidgetState = "rest" | "hover" | "selected" | "unavailable";

/** What a control looks like in one state: two colors and a border. */
export interface Skin {
  readonly fill: number;
  readonly fillAlpha: number;
  readonly text: number;
  readonly textAlpha: number;
  readonly stroke: number;
  readonly strokeWidth: number;
  /** Drawn dashed when the slot isn't filled yet (an empty seat, a locked mode). */
  readonly dashed: boolean;
}

export type WidgetKind =
  | "tableAction"
  | "tableCommit"
  /** The single forward action on the screen. One per screen, by rule. */
  | "primary"
  /** An ordinary control on paper. */
  | "secondary"
  /** A low-commitment alternative ("Skip"). */
  | "quiet"
  /** A control on the ink action bar. */
  | "onInk"
  /** A card, row or tile lifted off the paper. */
  | "card"
  /** A recessed strip: tab rails, seat rows. */
  | "rail";

const solid = (fill: number, text: number, stroke: number, strokeWidth: number): Skin => ({
  fill,
  fillAlpha: 1,
  text,
  textAlpha: ink.body,
  stroke,
  strokeWidth,
  dashed: false,
});

/**
 * The state matrix. `unavailable` never hides anything: it keeps the control in
 * place and drops its ink, because the board must not reflow while the player
 * is deciding ("dim, don't hide").
 */
export function skin(kind: WidgetKind, state: WidgetState): Skin {
  switch (kind) {
    case "tableAction":
    case "tableCommit": {
      if (state === "unavailable") return solid(tabletop.rail, 0x8e9da2, 0x3a505a, 1);
      if (kind === "tableCommit")
        return solid(state === "hover" ? tabletop.gold : tabletop.brass, tabletop.shadow, tabletop.gold, 1);
      const active = state === "hover" || state === "selected";
      return solid(
        active ? tabletop.raised : tabletop.plate,
        tabletop.lettering,
        active ? tabletop.gold : tabletop.edge,
        active ? 2 : 1,
      );
    }
    case "primary":
      if (state === "unavailable")
        return { ...solid(surface.parchment.hex, surface.ink.hex, tabletop.edge, 1), textAlpha: 0.52 };
      return solid(state === "hover" ? tabletop.gold : tabletop.brass, surface.inkOnHue.hex, tabletop.brass, 1);
    case "onInk":
      if (state === "unavailable")
        return { ...solid(tabletop.rail, tabletop.secondary, tabletop.edge, 1), textAlpha: 0.6 };
      return solid(
        state === "rest" ? tabletop.plate : tabletop.raised,
        tabletop.lettering,
        state === "rest" ? tabletop.edge : tabletop.gold,
        1,
      );
    case "secondary":
    case "quiet":
    case "card":
    case "rail": {
      const rail = kind === "rail";
      const fill = rail || kind === "quiet" ? surface.parchment.hex : surface.card.hex;
      if (state === "unavailable")
        return { ...solid(fill, surface.ink.hex, tabletop.edge, 1), textAlpha: 0.55, dashed: rail || kind === "quiet" };
      if (state === "selected") return solid(tabletop.plate, tabletop.lettering, tabletop.brass, 2);
      if (state === "hover" && kind !== "card") return solid(tabletop.raised, tabletop.lettering, tabletop.edge, 1);
      return solid(
        fill,
        surface.ink.hex,
        state === "hover" ? tabletop.brass : tabletop.edge,
        state === "hover" ? 2 : 1,
      );
    }
  }
}

/**
 * Text resolution. Phaser 4 has no game-level text resolution, so it is set per
 * text object — which means it belongs here, where every text object in the app
 * is created, rather than being repeated in each scene.
 */
let textResolution = 1;

export function setTextResolution(value: number): void {
  textResolution = value;
}

/** The resolution every text object is created at right now — for anything that rasterizes text itself (`art/card-face.ts`). */
export const currentTextResolution = (): number => textResolution;

/**
 * A `TypeSpec`'s font stack as a CSS `font-family` value, shared by every
 * text object Phaser draws and by the one DOM element in the app
 * (`McTextInput`'s rexUI `InputText`), so a seed field's digits render in the
 * same mono face as the rest of the app's specs and tokens.
 */
export function fontFamilyOf(spec: TypeSpec): string {
  return `"${spec.family}", ${spec.family === font.mono ? "monospace" : "sans-serif"}`;
}

/** A `TypeSpec` as a Phaser text style. */
export function textStyle(spec: TypeSpec, color: number, alpha = 1): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: fontFamilyOf(spec),
    fontSize: `${spec.size}px`,
    fontStyle: spec.weight === 400 ? "normal" : `${spec.weight}`,
    color: cssOf(color, alpha),
    resolution: textResolution,
    // In the style rather than a `setLetterSpacing` after: every setter on a `Text` re-rasterizes its canvas.
    ...(spec.letterSpacing ? { letterSpacing: spec.letterSpacing } : {}),
    ...(spec.family === font.display ? { padding: { right: BANGERS_RIGHT_PADDING } } : {}),
  };
}

/**
 * A `TypeSpec` as `art/card-face.ts` paints it: the same family, weight, letter spacing and Bangers padding
 * `textStyle` would give a Phaser `Text`, as plain data a worker can take.
 */
export function faceFontOf(spec: TypeSpec): FaceFont {
  return {
    family: fontFamilyOf(spec),
    size: spec.size,
    weight: spec.weight,
    letterSpacing: spec.letterSpacing,
    padRight: spec.family === font.display ? BANGERS_RIGHT_PADDING : 0,
    uppercase: spec.uppercase,
  };
}

/** A Phaser color number as a CSS string, optionally with alpha. */
export function cssOf(color: number, alpha = 1): string {
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  if (alpha >= 1) return hex;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Uppercases per the type spec, so a label is never shouted by accident. */
export const caseOf = (spec: TypeSpec, text: string): string => (spec.uppercase ? text.toUpperCase() : text);
