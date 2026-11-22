import { expect, test, type Page } from "@playwright/test";

/**
 * The answer buttons in the 3D table's turn bar grow wider rather than taller: a long answer takes two lines at most
 * (Adam, 2026-11-22, on Eviction Notice's three-line answers). Scene `eviction`: Peter Parker's obligation comes up in
 * the villain phase and asks its two long answers.
 */

const SHOTS = process.env.BATTLE_SHOTS;

async function dock(page: Page) {
  return page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)?.textContent?.trim() ?? "";
    const usable = (id: string) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      return !!el && !el.disabled && !el.hidden && el.offsetParent !== null;
    };
    return {
      title: text("dock-title"),
      eyebrow: text("dock-eyebrow"),
      primary: usable("dock-primary") ? text("dock-primary") : null,
      secondary: usable("dock-secondary") ? text("dock-secondary") : null,
      waiting: document.getElementById("dock")?.hasAttribute("data-waiting") ?? false,
      options: document.querySelectorAll("#dock-options:not([hidden]) button").length,
    };
  });
}

/** How many lines each answer's label takes. */
async function optionLines(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#dock-options button > span")].map((span) => {
      const range = document.createRange();
      range.selectNodeContents(span);
      const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      return { label: span.textContent ?? "", lines: tops.size };
    }),
  );
}

async function toEvictionNotice(page: Page) {
  await page.goto("/battle/?seed=11&scene=eviction");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#end-turn").click();
  const log: string[] = [];
  for (let i = 0; i < 120; i++) {
    const d = await dock(page);
    log.push(JSON.stringify(d));
    if (!d.waiting && d.options >= 2 && /Eviction Notice/i.test(d.eyebrow)) return;
    if (d.waiting) {
      // The card is being dealt or read out.
    } else if (await page.locator("#read-reveal").isVisible()) await page.locator("#read-reveal").click();
    else if (d.secondary && /^(Pass|Don.t defend|Skip)$/.test(d.secondary))
      await page.locator("#dock-secondary").click();
    else if (d.primary && /^(Continue|Start|OK|Next|Keep hand)/i.test(d.primary))
      await page.locator("#dock-primary").click();
    await page.waitForTimeout(500);
  }
  throw new Error(`Eviction Notice never asked:\n${log.slice(-15).join("\n")}`);
}

for (const size of [
  { name: "laptop", width: 1280, height: 800 },
  { name: "wide", width: 1920, height: 1080 },
]) {
  test(`Eviction Notice's answers take two lines at most (${size.name})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await toEvictionNotice(page);
    await page.waitForTimeout(600);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/eviction-${size.name}.png` });
    const lines = await optionLines(page);
    expect(lines.length).toBe(2);
    for (const option of lines) expect(option.lines, option.label).toBeLessThanOrEqual(2);
  });
}
