import { expect, test } from "@playwright/test";

/**
 * Asked "Defend?", the player weighs how much health the hero and each ally has left, so their health badges stay out
 * of the shade that darkens the rest of the table (Adam, 2026-11-22: "we are hiding the health under the light box").
 * Scene `defend`: a hurt Spider-Man with Jessica Jones and an exhausted Black Cat as Rhino attacks.
 */

const SHOTS = process.env.BATTLE_SHOTS;

test("the Defend? question keeps every friendly health badge bright", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/battle/?seed=11&scene=defend");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#end-turn").click();
  const defend = page.locator("#dock-primary", { hasText: /^\s*Defend\s*$/ });
  for (let i = 0; i < 120 && !(await defend.isVisible()); i++) {
    const primary = page.locator("#dock-primary");
    const secondary = page.locator("#dock-secondary");
    const title = (await page.locator("#dock-title").innerText()).trim();
    const label = (await primary.isVisible()) ? (await primary.innerText()).trim() : "";
    if (await page.locator("#read-reveal").isVisible()) await page.locator("#read-reveal").click();
    // Down to hand size at the end of the turn.
    else if (/^Discard \d/.test(title) && label.startsWith("Pick"))
      await page
        .locator('#anchors [aria-label^="Discard "]')
        .first()
        .evaluate((el) => (el as HTMLElement).click());
    else if (/^Discard \d/.test(title) && label.startsWith("Discard")) await primary.click();
    else if ((await secondary.isVisible()) && /^(Pass|Skip)$/.test((await secondary.innerText()).trim()))
      await secondary.click();
    else if ((await primary.isVisible()) && /^(Keep hand|Continue)/.test((await primary.innerText()).trim()))
      await primary.click();
    await page.waitForTimeout(150);
  }
  await expect(defend).toBeVisible();
  await expect(page.locator("#defense-shade")).toBeVisible();
  await page.waitForTimeout(900);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/defend-health.png` });

  // Each friendly health badge sits inside one of the shade's nameplate holes.
  const uncovered = await page.evaluate(() => {
    const shade = document.querySelector("#defense-shade")!.getBoundingClientRect();
    const holes = [...document.querySelectorAll("#plate-cutouts rect")].map((rect) => ({
      x: Number(rect.getAttribute("x")) + shade.left,
      y: Number(rect.getAttribute("y")) + shade.top,
      w: Number(rect.getAttribute("width")),
      h: Number(rect.getAttribute("height")),
    }));
    const pills = [...document.querySelectorAll('#board-labels .anchor:not(.enemy) .stat-pill[data-kind="hp"]')];
    return {
      pills: pills.length,
      // A plate the question can't use fades (opacity .4) unless it is lit.
      faded: pills.filter((pill) => getComputedStyle(pill.closest(".anchor")!).opacity !== "1").length,
      covered: pills.filter((pill) => {
        const box = pill.getBoundingClientRect();
        return !holes.some(
          (hole) =>
            box.left >= hole.x && box.top >= hole.y && box.right <= hole.x + hole.w && box.bottom <= hole.y + hole.h,
        );
      }).length,
    };
  });
  // Spider-Man, Jessica Jones and Black Cat.
  expect(uncovered.pills).toBe(3);
  expect(uncovered.covered).toBe(0);
  expect(uncovered.faded).toBe(0);
});
