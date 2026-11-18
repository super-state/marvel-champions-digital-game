import type Phaser from "phaser";
import { cardArt, drawArt } from "../art/card-art.js";
import { t } from "../i18n/translate.js";
import { surface, tabletop, typeRole } from "../tokens.js";
import { readingResources, readingStats } from "../view/card-reading.js";
import { thumbSizeFor, type readingLayout } from "../view/inspect-layout.js";
import type { InspectModel } from "../view/inspect-model.js";
import type { Rect } from "../view/layout.js";
import type { VariableListScroll } from "../view/variable-list-scroll.js";
import type { CardPlaySection } from "../progression/card-play.js";
import { pointInRect } from "../view/drag-gesture.js";
import { McScrollRegion } from "./scroll-region.js";
import { onTap, tapId } from "./tap.js";
import { textStyle } from "./theme.js";

type ReadingLayout = ReturnType<typeof readingLayout>;

function inset(rect: Rect, amount: number): Rect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(1, rect.width - amount * 2),
    height: Math.max(1, rect.height - amount * 2),
  };
}

/** The scan always uses the original proportions, including landscape schemes and standard encounter backs. */
export function drawReadingScan(scene: Phaser.Scene, model: InspectModel, bounds: Rect, open?: () => void): void {
  const g = scene.add.graphics();
  g.fillStyle(tabletop.plate).fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  const box = inset(bounds, Math.min(28, bounds.height / 12, bounds.width / 10));
  const key = cardArt(scene).request(scene, model.art);
  const image = drawArt(scene, key, box);
  if (!image) {
    scene.add
      .text(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, t("reader.noScan"), {
        ...textStyle(typeRole.body, tabletop.secondary),
        align: "center",
        wordWrap: { width: box.width },
      })
      .setOrigin(0.5);
    return;
  }
  if (open) {
    const zone = scene.add
      .zone(image.x, image.y, image.displayWidth, image.displayHeight)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    onTap(zone, open, tapId("reader-scan", box, model.name));
  }
}

/** Places authoritative wording before notes. Scroll range is measured from real wrapped Phaser text. */
export function drawReadingText(
  scene: Phaser.Scene,
  layout: ReadingLayout,
  model: InspectModel,
  scroll: VariableListScroll,
  options: {
    largeText: boolean;
    smallScan: boolean;
    now: string;
    note: string | undefined;
    openScan(): void;
    onScroll(): void;
  },
): McScrollRegion {
  const { art, text: rect, compact } = layout;
  const g = scene.add.graphics();
  g.fillStyle(surface.paper.hex).fillRect(rect.x, rect.y, rect.width, rect.height);
  if (art) drawReadingScan(scene, model, art, options.openScan);

  const first = scene.children.list.length;
  const pad = compact ? 20 : 34;
  const x = rect.x + pad;
  const width = Math.max(1, rect.width - 2 * pad);
  let y = rect.y + (compact ? 18 : 28);
  const body = options.largeText ? 22 : compact ? 17 : 19;
  function paragraph(value: string, size: number, bold = false, alpha = 1): void {
    if (!value) return;
    const line = scene.add
      .text(x, y, value, {
        ...textStyle(typeRole.body, surface.ink.hex, alpha),
        fontSize: `${size}px`,
        fontStyle: bold ? "700" : "400",
        wordWrap: { width, useAdvancedWrap: true },
      })
      .setLineSpacing(Math.round(size * 0.28));
    y += line.height + 7;
  }
  const inline = compact && options.smallScan && rect.width > 290 && model.art;
  const key = inline ? cardArt(scene).request(scene, model.art) : null;
  const thumb = thumbSizeFor(key ? scene.textures.get(key).getSourceImage() : null);
  const thumbnail = inline ? { x, y, width: 60, height: Math.round((60 * thumb.height) / thumb.width) } : null;
  const nameX = thumbnail ? x + thumbnail.width + 12 : x;
  const titleWidth = Math.max(1, width - (nameX - x));
  if (thumbnail) drawReadingScan(scene, model, thumbnail, options.openScan);
  const name = scene.add
    .text(nameX, y, model.name, {
      ...textStyle(typeRole.barTitle, surface.ink.hex),
      fontSize: compact ? "33px" : "42px",
      wordWrap: { width: titleWidth },
    })
    .setLetterSpacing(0.5);
  y += name.height + 3;
  if (model.typeLine) {
    const type = scene.add.text(nameX, y, model.typeLine, {
      ...textStyle(typeRole.body, surface.ink.hex, 0.8),
      fontSize: compact ? "14px" : "16px",
      fontStyle: "700",
      wordWrap: { width: titleWidth },
    });
    y += type.height + 7;
  }
  if (thumbnail) y = Math.max(y, thumbnail.y + thumbnail.height + 5);
  if (model.stats.length) paragraph(readingStats(model.stats), compact ? 15 : 16, true);
  const line = scene.add.graphics();
  y += compact ? 6 : 10;
  line.fillStyle(tabletop.brass).fillRect(x, y, Math.min(60, width), 2);
  y += compact ? 16 : 22;
  paragraph(t(model.printedText ? "reader.ruleErrata" : "reader.words"), 14, true, 0.8);
  paragraph(model.rulesText || t("reader.noRules"), body);
  if (model.teamUpNotice) {
    y += 10;
    paragraph(model.teamUpNotice.heading, 14, true);
    paragraph(model.teamUpNotice.text, compact ? 15 : 16);
  }
  if (model.campaignNotice) {
    y += 10;
    paragraph(model.campaignNotice.heading, 14, true);
    paragraph(model.campaignNotice.text, compact ? 15 : 16);
  }

  const current = options.note || options.now;
  if (current) {
    y += 12;
    paragraph(t("reader.now"), 14, true, 0.8);
    paragraph(current, compact ? 15 : 16);
  }
  if (model.cost !== null || model.resourceIcons.length) {
    y += 16;
    line.fillStyle(surface.inkMark.hex, 0.25).fillRect(x, y, width, 1);
    y += 13;
    if (model.cost !== null) {
      const changed = model.currentCost !== null && model.currentCost !== model.cost;
      const price = changed ? t("reader.nowCost", { cost: model.currentCost! }) : String(model.cost);
      const rate = model.perPlayerCost;
      const detail = [
        price,
        changed ? t("reader.inPrint", { cost: model.cost }) : "",
        rate?.rateLabel,
        rate?.countLabel,
      ]
        .filter(Boolean)
        .join(" · ");
      paragraph(t("reader.pay"), 14, true, 0.8);
      paragraph(detail, body, true);
      paragraph(t("reader.priceHint"), compact ? 14 : 15, false, 0.82);
    }
    if (model.resourceIcons.length) {
      y += 6;
      paragraph(t("reader.spend"), 14, true, 0.8);
      paragraph(readingResources(model.resourceIcons), body, true);
      paragraph(t("reader.spendHint"), compact ? 14 : 15, false, 0.82);
    }
  }
  if (model.printedText) paragraph(t("reader.updated"), 14, false, 0.82);
  if (model.flavor) {
    y += 10;
    paragraph(model.flavor, compact ? 14 : 15, false, 0.75);
  }
  const objects = scene.children.list.slice(first);
  const region = new McScrollRegion(scene, {
    rect,
    scroll,
    heights: [y - rect.y + pad],
    clipInteractive: true,
    onScroll: options.onScroll,
  });
  region.content.add(objects);
  region.syncInteractivity();
  return region;
}

export interface ReaderLink {
  label: string;
  run(): void;
}

/** The reference page is one measured scroll. A long glossary entry never displaces actions or hides history. */
export function drawReadingDetails(
  scene: Phaser.Scene,
  layout: ReadingLayout,
  model: InspectModel,
  scroll: VariableListScroll,
  options: {
    now: string;
    how: string | null;
    yourPlay: CardPlaySection | null;
    largeText: boolean;
    links: readonly { heading: string; links: readonly ReaderLink[] }[];
    openRules(id: string): void;
    openScan(): void;
    onScroll(): void;
    registerLink(rect: Rect, run: () => void): void;
  },
): McScrollRegion {
  const { art, text: rect, compact } = layout;
  scene.add.graphics().fillStyle(surface.paper.hex).fillRect(rect.x, rect.y, rect.width, rect.height);
  if (art) drawReadingScan(scene, model, art, options.openScan);
  const first = scene.children.list.length;
  const pad = compact ? 20 : 32;
  const x = rect.x + pad,
    width = rect.width - pad * 2;
  const size = options.largeText ? 19 : 16;
  let y = rect.y + pad;
  function words(value: string, px = size, strong = false): void {
    const word = scene.add
      .text(x, y, value, {
        ...textStyle(typeRole.body, surface.ink.hex),
        fontSize: `${px}px`,
        fontStyle: strong ? "700" : "400",
        wordWrap: { width, useAdvancedWrap: true },
      })
      .setLineSpacing(4);
    y += word.height + 6;
  }
  function section(title: string, values: readonly string[]): void {
    if (values.every((v) => !v)) return;
    y += 12;
    words(title, 15, true);
    values.filter(Boolean).forEach((value) => words(value));
  }
  function link(item: ReaderLink): void {
    const top = y;
    const text = scene.add.text(x + 12, y + 8, `${item.label}  ›`, {
      ...textStyle(typeRole.body, surface.ink.hex),
      fontSize: `${size}px`,
      fontStyle: "700",
      wordWrap: { width: width - 24, useAdvancedWrap: true },
    });
    const height = Math.max(44, text.height + 16);
    const bg = scene.add.graphics().fillStyle(surface.parchment.hex).fillRoundedRect(x, y, width, height, 6);
    scene.children.moveBelow(bg, text);
    const box = { x, y: top, width, height };
    const zone = scene.add.zone(x, top, width, height).setOrigin(0).setInteractive({ useHandCursor: true });
    onTap(
      zone,
      (p) => {
        if (pointInRect(p.x, p.y, rect)) item.run();
      },
      tapId("reader-link", box, item.label),
    );
    options.registerLink(box, item.run);
    y += height + 5;
  }
  words(model.name, compact ? 24 : 28, true);
  if (model.typeLine) words(model.typeLine, 15);
  const now = [
    options.now,
    model.damageNote,
    model.threatNote,
    model.counterNote,
    model.hitPointFloorNote,
    model.resourceIconNote,
    model.attackBarNote,
    model.reverseNote,
    model.forcedNote,
    ...model.areaNotes,
  ].filter((line): line is string => Boolean(line));
  section(t("reader.now"), now);
  if (model.teamUpNotice) section(model.teamUpNotice.heading, [model.teamUpNotice.text, ...model.teamUpNotice.lines]);
  if (model.campaignNotice) {
    const notice = model.campaignNotice;
    section(notice.heading, [notice.text]);
    link({ label: notice.linkLabel, run: () => options.openRules(notice.rulesQuery) });
  }
  if (options.how) section(t("reader.how"), [options.how]);
  if (model.stats.length)
    section(
      t("reader.facts"),
      model.stats.map((stat) => t(`reader.statHelp.${stat.label}`)),
    );
  if (model.timing.length) {
    y += 12;
    words(t("reader.timing"), 15, true);
    for (const term of model.timing) {
      words(term.label, size, true);
      words(`${term.definition} (${term.citeLabel})`);
    }
  }
  if (model.keywordChips.length) {
    y += 12;
    words(t("reader.keywords"), 15, true);
    for (const chip of model.keywordChips) {
      const id = chip.glossaryId;
      if (id) link({ label: chip.text, run: () => options.openRules(id) });
      else words(chip.text);
    }
    for (const term of model.keywordDefinitions) words(`${term.label} — ${term.definition} (${term.citeLabel})`);
  }
  if (model.traits.length) section(t("reader.traits"), [model.traits.join(" · ")]);
  for (const group of options.links) {
    y += 12;
    words(group.heading, 15, true);
    for (const item of group.links) link(item);
  }
  if (model.printedText) section(t("reader.errata"), [model.printedText]);
  if (model.history.length)
    section(
      t("reader.history"),
      model.history.map((line) => `${line.roundTag}   ${line.text}`),
    );
  if (options.yourPlay)
    section(
      options.yourPlay.title,
      options.yourPlay.lines.map((line) => `${line.label}   ${line.value}`),
    );
  section(t("reader.printing"), [model.footerLeft, model.footerRight].filter(Boolean));
  const items = scene.children.list.slice(first);
  const region = new McScrollRegion(scene, {
    rect,
    scroll,
    heights: [y - rect.y + pad],
    clipInteractive: true,
    onScroll: options.onScroll,
  });
  region.content.add(items);
  region.syncInteractivity();
  return region;
}
