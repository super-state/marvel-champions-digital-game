import { expect, type Page } from "./battle-test";

/**
 * Campaign's first step, from the keyboard: on the scenario shelf (`room/places/scenario-shelf.ts`), the Core Set's box
 * up close, then one of its scenarios, which takes the camera to the table where its villain box opens. Works from the
 * shelf, or with the Core Set already up close.
 */
export async function pickCoreScenario(page: Page, villain: "Rhino" | "Klaw" | "Ultron"): Promise<void> {
  const room = page.locator("#shelf");
  await room.locator('[data-scn="box:core"]').focus();
  await page.keyboard.press("Enter");
  const scenario = room.locator(`[data-scn="scenario:${villain.toLowerCase()}"]`);
  await expect(scenario).toBeVisible({ timeout: 30_000 });
  await scenario.focus();
  await page.keyboard.press("Enter");
}
