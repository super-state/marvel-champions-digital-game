import { expect, test } from "@playwright/test";

/**
 * Keys on the 3D battle table: Enter presses the yellow button on screen (here Keep hand, then End Turn), a quick
 * second Enter never runs on to the button that took the pressed one's place, and Ctrl+Z takes the last move back.
 * Seed 7 deals the same hand every time.
 */

test("Enter presses the yellow button; Ctrl+Z takes the last move back", async ({ page }) => {
  await page.goto("/battle/?seed=7");
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?", { timeout: 60_000 });
  await expect(page.locator("#dock")).not.toHaveAttribute("data-waiting", "", { timeout: 15_000 });
  await expect(page.locator("#undo")).toHaveAttribute("title", /^Undo \((Ctrl\+|⌘)Z\)$/);
  await page.waitForTimeout(600);

  // Enter keeps the hand; a second Enter straight after must not end the turn.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.locator("#dock-title")).not.toHaveText("Keep your hand?", { timeout: 10_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i);

  // Ctrl+Z takes keeping the hand back: the question is asked again.
  await expect(page.locator("#undo")).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?", { timeout: 10_000 });

  // Enter keeps it again, then, with the bar folded away, Enter presses End Turn.
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.keyboard.press("Enter");
  await expect(page.locator("#turn-status")).not.toHaveText(/Hero phase/i, { timeout: 15_000 });
});
