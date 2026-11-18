import type Phaser from "phaser";
import type { InstanceId } from "@mc/engine";
import { t } from "../../i18n/translate.js";
import { surface, tabletop, typeRole, type TypeSpec } from "../../tokens.js";
import { McScrollRegion } from "../../ui/scroll-region.js";
import { textStyle } from "../../ui/theme.js";
import { McButton } from "../../ui/widgets.js";
import { readingResources, readingStats } from "../../view/card-reading.js";
import type { InspectModel } from "../../view/inspect-model.js";
import type { Rect } from "../../view/layout.js";
import { VariableListScroll } from "../../view/variable-list-scroll.js";

const INSET = 18;
const HEADER = 48;
const FOOTER = 60;

/** A permanent, text-first reading surface next to the table. It remembers the last card so the player can scroll. */
export class BoardCardDetails {
  #root: Phaser.GameObjects.Container | null = null;
  #body: McScrollRegion | null = null;
  #card: InstanceId | null = null;
  readonly #scroll = new VariableListScroll();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly inspect: (id: InstanceId) => void,
  ) {}

  draw(rect: Rect, model: InspectModel | null): void {
    this.clearFrame();
    const { scene } = this;
    const root = scene.add.container().setName("Card details");
    this.#root = root;
    const card = model?.instanceId ?? null;
    if (this.#card !== card) this.#scroll.reset();
    this.#card = card;

    const frame = scene.add.graphics();
    frame.fillStyle(surface.paper.hex).fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 7);
    frame.fillStyle(tabletop.rail).fillRect(rect.x, rect.y, rect.width, HEADER);
    frame.fillStyle(tabletop.brass).fillRect(rect.x, rect.y + HEADER - 2, rect.width, 2);
    const heading = scene.add
      .text(
        rect.x + INSET,
        rect.y + HEADER / 2,
        t("board.cardDetails"),
        textStyle(typeRole.barTitle, tabletop.lettering),
      )
      .setOrigin(0, 0.5);
    root.add([frame, heading]);

    const viewport: Rect = {
      x: rect.x + INSET,
      y: rect.y + HEADER + 12,
      width: rect.width - INSET * 2,
      height: rect.height - HEADER - FOOTER - 16,
    };
    if (!model || model.hidden) {
      root.add(
        scene.add.text(viewport.x, viewport.y + 7, t("board.cardDetailsHint"), {
          ...textStyle(typeRole.body, surface.ink.hex, 0.82),
          wordWrap: { width: viewport.width, useAdvancedWrap: true },
        }),
      );
      return;
    }

    let y = viewport.y + 5;
    const words: Phaser.GameObjects.Text[] = [];
    const write = (value: string, type: TypeSpec, gap: number, alpha = 1): void => {
      if (!value) return;
      const text = scene.add
        .text(viewport.x, y, value, {
          ...textStyle(type, surface.ink.hex, alpha),
          wordWrap: { width: viewport.width - 10, useAdvancedWrap: true },
        })
        .setLineSpacing(5);
      words.push(text);
      y += text.height + gap;
    };
    write(model.name, typeRole.pageTitle, 4);
    write(model.typeLine, typeRole.emphasis, 16, 0.78);
    const price = model.currentCost ?? model.cost;
    if (price !== null) write(t("board.cardDetailsCost", { cost: price }), typeRole.rowTitle, 4);
    const resources = readingResources(model.resourceIcons);
    if (resources) write(t("board.cardDetailsResources", { resources }), typeRole.rowTitle, 4);
    write(model.priceNote ?? "", typeRole.emphasis, 4, 0.82);
    write(model.resourceNote ?? "", typeRole.emphasis, 8, 0.82);
    write(readingStats(model.stats), typeRole.emphasis, 8);
    y += 10;
    write(t("reader.words"), typeRole.rowTitle, 6);
    write(model.rulesText || t("reader.noRules"), { ...typeRole.body, size: 17 }, 12);
    for (const value of [model.threatNote, model.damageNote, model.counterNote]) {
      if (value) write(value, typeRole.emphasis, 6, 0.84);
    }

    this.#body = new McScrollRegion(scene, { rect: viewport, heights: [y - viewport.y + 12], scroll: this.#scroll });
    this.#body.content.add(words);
    root.add(this.#body.root);
    root.add(
      new McButton(scene, {
        kind: "secondary",
        label: t("reader.face"),
        type: typeRole.rowTitle,
        rect: { ...viewport, y: rect.y + rect.height - FOOTER + 7, height: 44 },
        onClick: () => this.inspect(model.instanceId),
      }).container,
    );
  }

  clearFrame(): void {
    this.#body?.destroy();
    this.#body = null;
    this.#root?.destroy();
    this.#root = null;
  }
}
