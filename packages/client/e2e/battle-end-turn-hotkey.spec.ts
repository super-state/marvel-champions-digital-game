import { expect, test } from "./battle-test";

/**
 * Ctrl+Space on the 3D battle table does what End Turn does: nothing while the menu is open, and ends the hero phase
 * once End Turn can be pressed. Scene `advanceloss` opens straight into the hero phase with End Turn ready.
 */

test("Ctrl+Space ends the turn, but not while the menu is open", async ({ page }) => {
  await page.goto("/battle/?seed=11&scene=advanceloss");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("#end-turn")).toHaveAttribute("title", /^End Turn \((Ctrl\+|⌃)Space\)$/);
  await page.waitForTimeout(1500);

  await page.locator("#menu-button").click();
  await expect(page.locator("#menu")).toBeVisible();
  await page.keyboard.press("Control+Space");
  await page.waitForTimeout(500);
  await page.locator("#menu-resume").click();
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i);

  await page.keyboard.press("Control+Space");
  await expect(page.locator("#turn-status")).not.toHaveText(/Hero phase/i, { timeout: 15_000 });
});
