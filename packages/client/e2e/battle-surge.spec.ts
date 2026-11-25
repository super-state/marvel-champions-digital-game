import { expect, test } from "./battle-test";

/**
 * Surge on the 3D battle table says "Surge!" once, on the card that causes it; the encounter deck then shows only
 * "+1 card" for the extra card it deals (Adam, 2026-11-22: surge written on both read as two surges). Scene `surge`:
 * Hard to Keep Down on an unhurt Rhino gains surge.
 */

const SHOTS = process.env.BATTLE_SHOTS;

test("surge is said once, on the surging card; the deck shows +1 card", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/battle/?seed=11&scene=surge");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#end-turn").click();
  const stamp = page.locator('.card-stamp[data-tone="surge"]');
  const burst = page.locator(".surge-burst");
  // Keep the villain phase moving (reading the revealed card, passing) until the surge plays.
  for (let i = 0; i < 120 && !(await stamp.count()); i++) {
    const primary = page.locator("#dock-primary");
    const secondary = page.locator("#dock-secondary");
    if (await page.locator("#read-reveal").isVisible()) await page.locator("#read-reveal").click();
    else if ((await secondary.isVisible()) && /^(Pass|Don.t defend|Skip)$/.test((await secondary.innerText()).trim()))
      await secondary.click();
    else if ((await primary.isVisible()) && /^(Keep hand|Continue)/.test((await primary.innerText()).trim()))
      await primary.click();
    await page.waitForTimeout(150);
  }
  await expect(stamp).toHaveText("Surge!");
  await expect(burst).toBeVisible({ timeout: 3000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/surge.png` });
  await expect(burst).toHaveText("+1 card");
  await expect(burst).not.toContainText(/surge/i);
});
