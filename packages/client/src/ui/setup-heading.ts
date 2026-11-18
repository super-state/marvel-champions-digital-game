import type Phaser from "phaser";
import { t } from "../i18n/translate.js";
import { tabletop, typeRole } from "../tokens.js";
import type { Rect } from "../view/layout.js";
import { textStyle } from "./theme.js";
import { fitText } from "./widgets.js";

/** The same three decisions appear above the scenario roster, hero roster and final game review. */
export function drawSetupHeading(scene: Phaser.Scene, back: Rect, bar: Rect, title: string, active: 0 | 1 | 2): void {
  const mid = bar.y + bar.height / 2;
  const titleX = back.x + back.width + (bar.width < 600 ? 8 : 18);
  const right = bar.x + bar.width - 18;
  let progressLeft = right;
  if (bar.width >= 740) {
    const steps = [t("setup.stageFoe"), t("setup.stageHeroes"), t("setup.stageReview")];
    steps.forEach((name, index) => {
      const x = right - (3 - index) * 88;
      const current = index === active;
      const step = scene.add
        .text(x + 44, mid, name, textStyle(typeRole.emphasis, current ? tabletop.gold : tabletop.secondary))
        .setOrigin(0.5);
      fitText(step, 81, typeRole.emphasis.size);
      if (current) scene.add.rectangle(x + 44, mid + 17, 52, 2, tabletop.brass);
    });
    progressLeft = right - 264;
  } else {
    const step = scene.add
      .text(right, mid, `${active + 1} / 3`, textStyle(typeRole.emphasis, tabletop.gold))
      .setOrigin(1, 0.5);
    progressLeft = step.x - step.width;
  }
  const heading = scene.add
    .text(titleX, mid, title, textStyle(typeRole.pageTitle, tabletop.lettering))
    .setOrigin(0, 0.5);
  fitText(heading, Math.max(24, progressLeft - titleX - 12), typeRole.pageTitle.size);
}
