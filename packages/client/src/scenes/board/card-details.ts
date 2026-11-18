import type Phaser from "phaser";
import type { InstanceId } from "@mc/engine";
import { cardArt, drawArt } from "../../art/card-art.js";
import type { InspectModel } from "../../view/inspect-model.js";
import type { Rect } from "../../view/layout.js";
import { tabletop } from "../../tokens.js";
import { onTap } from "../../ui/tap.js";

const INSET = 12;

/** Holds the last hovered card steady while the pointer moves away from the table. */
export class BoardCardDetails {
  #root: Phaser.GameObjects.Container | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly inspect: (id: InstanceId) => void,
  ) {}

  draw(rect: Rect, model: InspectModel | null): void {
    this.clearFrame();
    const { scene } = this;
    const root = scene.add.container().setName("Card details");
    this.#root = root;

    const frame = scene.add.graphics();
    frame.fillStyle(tabletop.rail).fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 7);
    frame.lineStyle(1, tabletop.edge, 0.55).strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 7);
    root.add(frame);

    if (!model || model.hidden) return;
    const image = drawArt(scene, cardArt(scene).request(scene, model.art), {
      x: rect.x + INSET,
      y: rect.y + INSET,
      width: rect.width - INSET * 2,
      height: rect.height - INSET * 2,
    });
    if (!image) return;
    const zone = scene.add
      .zone(image.x, image.y, image.displayWidth, image.displayHeight)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    onTap(zone, () => this.inspect(model.instanceId));
    root.add([image, zone]);
  }

  clearFrame(): void {
    this.#root?.destroy();
    this.#root = null;
  }
}
