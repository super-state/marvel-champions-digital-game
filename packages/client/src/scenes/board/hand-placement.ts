import type Phaser from "phaser";
import { drawArt } from "../../art/card-art.js";
import { surface, typeRole } from "../../tokens.js";
import { paintCardStock } from "../../ui/card-stock.js";
import { fitWrapped } from "../../ui/widgets.js";
import { textStyle } from "../../ui/theme.js";
import type { HandCardView } from "../../view/board-model.js";
import type { Rect } from "../../view/layout.js";
import type { BoardDrawContext } from "./context.js";

export function drawPendingHandCard(
  ctx: BoardDrawContext,
  card: HandCardView,
  slot: Rect,
): Phaser.GameObjects.Container {
  const { scene } = ctx;
  const box = { x: 0, y: 0, width: slot.width, height: slot.height };
  const frame = scene.add.graphics();
  paintCardStock(frame, box, "selected");
  const image = drawArt(scene, ctx.art.request(scene, card.art), {
    x: 2,
    y: 2,
    width: box.width - 4,
    height: box.height - 4,
  });
  if (image) return scene.add.container(0, 0, [frame, image]).setName("Pending hand card");
  const name = scene.add
    .text(box.width / 2, box.height / 2, card.name, textStyle(typeRole.rowTitle, surface.ink.hex))
    .setOrigin(0.5);
  fitWrapped(name, box.width - 12, 3, 14);
  return scene.add.container(0, 0, [frame, name]).setName("Pending hand card");
}

export function movePendingHandCard(print: Phaser.GameObjects.Container, slot: Rect, at: Rect): void {
  print.setPosition(at.x, at.y).setScale(at.width / slot.width, at.height / slot.height);
}
