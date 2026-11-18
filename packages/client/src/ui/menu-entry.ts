import type Phaser from "phaser";
import { surface, tabletop, typeRole } from "../tokens.js";
import type { Rect } from "../view/layout.js";
import { textStyle } from "./theme.js";
import { addRowTapZone, fitText, fitWrapped } from "./widgets.js";

/** A destination with a readable name, one line of context and the same hit area for both. */
export function drawMenuEntry(
  scene: Phaser.Scene,
  rect: Rect,
  options: {
    readonly name: string;
    readonly detail: string;
    readonly onClick: () => void;
    readonly primary?: boolean;
    readonly enabled?: boolean;
  },
): void {
  const { x, y, width, height } = rect;
  const primary = options.primary === true;
  const pad = width >= 410 ? 22 : 14;
  const available = Math.max(1, width - 2 * pad - 17);
  const nameSize = height < 58 ? 16 : width >= 420 ? 22 : 19;
  const detailSize = height < 58 ? 12 : width >= 420 ? 15 : 13;
  const g = scene.add.graphics();
  const ink = primary ? tabletop.shadow : surface.ink.hex;
  const text = scene.add.text(x + pad, 0, options.name, textStyle(typeRole.menuButton, ink)).setFontSize(nameSize);
  fitText(text, available, nameSize);
  const detail = scene.add
    .text(x + pad, 0, options.detail, textStyle(typeRole.body, ink, 0.83))
    .setFontSize(detailSize);
  const gap = height < 58 ? 1 : 3;
  const lines = height - text.height - gap >= 2 * detail.height + 2 ? 2 : 1;
  if (lines === 2 && detail.width > available) fitWrapped(detail, available, 2, detailSize);
  else fitText(detail, available, detailSize);
  text.y = Math.round(y + (height - text.height - detail.height - gap) / 2);
  detail.y = text.y + text.height + gap;
  const alpha = options.enabled === false ? 0.54 : 1;
  text.setAlpha(alpha);
  detail.setAlpha(alpha);
  const paint = (hover: boolean): void => {
    g.clear();
    const ground = primary
      ? hover
        ? tabletop.gold
        : tabletop.brass
      : hover
        ? surface.parchment.hex
        : surface.paper.hex;
    g.fillStyle(ground, alpha).fillRoundedRect(x, y, width, height, 5);
    g.lineStyle(1, primary ? tabletop.gold : tabletop.edge, 0.5).strokeRoundedRect(
      x + 0.5,
      y + 0.5,
      width - 1,
      height - 1,
      5,
    );
    const mid = y + height / 2;
    const right = x + width - pad;
    g.lineStyle(1.8, ink, alpha * 0.8)
      .beginPath()
      .moveTo(right - 6, mid - 5)
      .lineTo(right, mid)
      .lineTo(right - 6, mid + 5)
      .strokePath();
  };
  paint(false);
  const zone = addRowTapZone(scene, rect, { onClick: options.onClick, enabled: options.enabled !== false });
  zone.on("pointerover", () => paint(options.enabled !== false));
  zone.on("pointerout", () => paint(false));
}
