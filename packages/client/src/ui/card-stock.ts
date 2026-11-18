import type Phaser from "phaser";
import { cardRadius } from "../art/card-shape.js";
import { tabletop } from "../tokens.js";
import type { Rect } from "../view/layout.js";
import { skin, type WidgetState } from "./theme.js";

export { cardRadius };

// Phaser tessellates each Graphics.arc into 100 segments every frame, even for a 5 px radius. Record the card
// contour with five chords per corner when the board is drawn, so a hand and its layered decks stay cheap to render.
const quarter = Array.from({ length: 5 }, (_, i) => {
  const angle = ((i + 1) * Math.PI) / 10;
  return { sin: Math.sin(angle), cos: Math.cos(angle) };
});

function cardPath(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  r: number,
): Phaser.GameObjects.Graphics {
  const right = x + width;
  const bottom = y + height;
  g.beginPath()
    .moveTo(x + r, y)
    .lineTo(right - r, y);
  for (const { sin, cos } of quarter) g.lineTo(right - r + r * sin, y + r - r * cos);
  g.lineTo(right, bottom - r);
  for (const { sin, cos } of quarter) g.lineTo(right - r + r * cos, bottom - r + r * sin);
  g.lineTo(x + r, bottom);
  for (const { sin, cos } of quarter) g.lineTo(x + r - r * sin, bottom - r + r * cos);
  g.lineTo(x, y + r);
  for (const { sin, cos } of quarter) g.lineTo(x + r - r * cos, y + r - r * sin);
  return g.closePath();
}

export function fillCard(g: Phaser.GameObjects.Graphics, rect: Rect, color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  cardPath(g, rect.x, rect.y, rect.width, rect.height, cardRadius(rect.width, rect.height)).fillPath();
}

export function strokeCard(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  lineWidth: number,
  color: number,
  alpha = 1,
): void {
  g.lineStyle(lineWidth, color, alpha);
  cardPath(g, rect.x, rect.y, rect.width, rect.height, cardRadius(rect.width, rect.height)).strokePath();
}

/** The front card stays on its layout rect. Additional sheets grow down and right, away from the table light. */
export function paintCardStock(
  g: Phaser.GameObjects.Graphics,
  rect: Rect,
  state: WidgetState = "rest",
  count = 1,
): void {
  const { x, y, width, height } = rect;
  if (width <= 0 || height <= 0) return;
  const s = skin("card", state);
  const sheet = Math.min(1.6, Math.min(width, height) / 58);
  // A thick deck reads as a stack even at a glance. The printed count still gives the exact number.
  const layers = Math.min(4, Math.ceil(Math.log2(Math.max(1, count))));
  const depth = (layers + 1) * sheet;
  fillCard(g, { x: x + 2, y: y + depth + 2, width: width + 1, height: height + 1 }, tabletop.shadow, 0.22);
  fillCard(g, { x: x + 1, y: y + depth, width, height: height + 1 }, tabletop.shadow, 0.66);
  for (let layer = layers; layer >= 1; layer--) {
    const offset = sheet * layer;
    const edge = { ...rect, x: x + offset * 0.35, y: y + offset };
    fillCard(g, { ...edge, y: edge.y + sheet }, 0x475056);
    fillCard(g, edge, 0xb7b3a9);
  }
  fillCard(g, { ...rect, x: x + sheet * 0.3, y: y + sheet }, 0x84837b);
  fillCard(g, rect, s.fill, s.fillAlpha);
  const selected = state === "selected" || state === "hover";
  strokeCard(g, rect, selected ? 2 : 1, selected ? s.stroke : tabletop.lettering, selected ? 1 : 0.72);
}
