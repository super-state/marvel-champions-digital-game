import type Phaser from "phaser";
import { accent, surface, tabletop } from "../tokens.js";
import type { Rect } from "../view/layout.js";
import type { WidgetState } from "./theme.js";

type Graphics = Phaser.GameObjects.Graphics;

/** Fine registration marks leave the illustrated mat visible between cards. */
export function paintPlayZone(g: Graphics, r: Rect): void {
  const { x, y, width: w, height: h } = r;
  const inset = 1;
  const arm = Math.min(15, w / 6, h / 6);
  g.fillStyle(tabletop.shadow, 0.16).fillRoundedRect(x, y, w, h, 7);
  g.lineStyle(1, tabletop.edge, 0.26).strokeRoundedRect(x, y, w, h, 7);
  g.lineStyle(1, tabletop.brass, 0.58);
  for (const [cx, dx] of [
    [x + inset, 1],
    [x + w - inset, -1],
  ] as const) {
    for (const [cy, dy] of [
      [y + inset, 1],
      [y + h - inset, -1],
    ] as const) {
      g.beginPath()
        .moveTo(cx + dx * arm, cy)
        .lineTo(cx + dx * 4, cy);
      g.lineTo(cx, cy + dy * 4)
        .lineTo(cx, cy + dy * arm)
        .strokePath();
    }
  }
}

/** A small card silhouette in an empty lane, above its existing placement hint. */
export function paintEmptyPosition(g: Graphics, rect: Rect): void {
  if (rect.height < 104 || rect.width < 110) return;
  const x = rect.x + rect.width / 2 - 10;
  const y = rect.y + rect.height / 2 - 42;
  g.lineStyle(1, tabletop.secondary, 0.38).strokeRoundedRect(x - 3, y + 2, 20, 28, 3);
  g.fillStyle(tabletop.plate, 0.9).fillRoundedRect(x + 2, y - 2, 20, 28, 3);
  g.lineStyle(1, tabletop.brass, 0.72).strokeRoundedRect(x + 2, y - 2, 20, 28, 3);
}

/** A low, beveled plinth for a card's live readout. The rim also marks legal targets. */
export function paintTablePlate(g: Graphics, rect: Rect, state: WidgetState = "rest"): void {
  const { x, y, width: w, height: h } = rect;
  const active = state === "selected" || state === "hover";
  const alpha = state === "unavailable" ? 0.66 : 1;
  g.fillStyle(tabletop.shadow, 0.5 * alpha).fillRoundedRect(x + 1, y + 4, w, h, 7);
  g.fillStyle(tabletop.plate, 0.94 * alpha).fillRoundedRect(x, y, w, h, 7);
  g.lineStyle(active ? 3 : 1, active ? accent.heroRed.hex : tabletop.edge, alpha);
  g.strokeRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, 7);
  g.lineStyle(1, tabletop.brass, 0.55 * alpha).lineBetween(x + 9, y + 1, x + Math.min(w / 3, 100), y + 1);
}

/** The solid lip behind controls must stay readable even over a busy playmat. */
export function paintTableRail(g: Graphics, rect: Rect, edge: "top" | "bottom"): void {
  const { x, y, width: w, height: h } = rect;
  const seam = edge === "top" ? y + 1 : y + h - 2;
  g.fillStyle(tabletop.rail, 1).fillRect(x, y, w, h);
  g.fillStyle(tabletop.brass, 0.71).fillRect(x, seam, w, 1);
}

/** An opaque reading surface for rules text, using the player's light/dark paper setting. */
export function paintReadingPlate(g: Graphics, rect: Rect): void {
  const { x, y, width: w, height: h } = rect;
  g.fillStyle(tabletop.shadow, 0.55).fillRoundedRect(x + 2, y + 6, w, h, 8);
  g.fillStyle(surface.paper.hex).fillRoundedRect(x, y, w, h, 8);
  g.lineStyle(2, tabletop.brass, 0.85).strokeRoundedRect(x, y, w, h, 8);
}
