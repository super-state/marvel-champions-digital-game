import { expect, test } from "@playwright/test";

/**
 * The villain scheming is called out on its card, like threat placed and an encounter card dealt: in alter-ego form
 * (scene `flipupgrade`) Rhino schemes when the turn ends, and "Schemes" is stamped between "Threat" and "Encounter".
 */

test("Rhino scheming is stamped Schemes", async ({ page }) => {
  await page.goto("/battle/?seed=7&scene=flipupgrade");
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __stamps: string[] }).__stamps = seen;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement && node.classList.contains("card-stamp")) seen.push(node.textContent ?? "");
    }).observe(document.body, { subtree: true, childList: true });
  });
  await page.locator("#end-turn").click();
  // Alter ego at the end of the turn: keep the hand when asked to discard.
  await expect(page.locator("#dock-title")).toHaveText(/Discard/, { timeout: 20_000 });
  // Pressed straight away, the bar's double-press guard would ignore it: wait it out, and press again if need be.
  await expect(async () => {
    await page.waitForTimeout(500);
    if (/Discard/.test((await page.locator("#dock-title").textContent()) ?? ""))
      await page.locator("#dock-primary").click();
    await expect(page.locator("#dock-title")).not.toHaveText(/Discard/, { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __stamps: string[] }).__stamps), { timeout: 30_000 })
    .toEqual(expect.arrayContaining(["Threat", "Schemes", "Encounter"]));
  const stamps = await page.evaluate(() => (window as unknown as { __stamps: string[] }).__stamps);
  expect(stamps.indexOf("Schemes")).toBeGreaterThan(stamps.indexOf("Threat"));
  expect(stamps.indexOf("Schemes")).toBeLessThan(stamps.indexOf("Encounter"));
});
