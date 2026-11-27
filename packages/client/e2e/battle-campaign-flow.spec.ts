import { expect, test } from "./battle-test";
import { arrivedAt, pickCoreScenario } from "./campaign-steps.js";

/**
 * Campaign's play flow (Adam, 2026-11-27): the scenario shelf, a box up close and a scenario in it; the hero shelf
 * asked for a hero for it; then the table, where the scenario's box opens and Play deals the game with that hero.
 */
test("Campaign: a scenario from the shelf, a hero from the heroes, then the game is dealt with them", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/battle/?room=campaign");
  await arrivedAt(page, "campaign");
  const room = page.locator("#shelf");
  await expect(room.getByRole("heading", { name: "Choose a scenario" })).toBeVisible();

  // A box the table doesn't deal from yet opens too, and says so.
  await room.locator('[data-scn="box:trors"]').focus();
  await page.keyboard.press("Enter");
  const crossbones = room.locator('[data-scn="scenario:crossbones"]');
  await expect(crossbones).toBeVisible({ timeout: 30_000 });
  await expect(crossbones).toHaveAttribute("aria-disabled", "true");
  await expect(crossbones).toContainText("Not on the table yet");
  await page.keyboard.press("Escape");
  await expect(room.locator(".scn-card")).toBeHidden();

  // Klaw, played by She-Hulk: the table deals that matchup.
  await pickCoreScenario(page, "Klaw", "she-hulk");
  expect(await page.evaluate(() => localStorage.getItem("battle-hero"))).toBe("she-hulk");
  await expect(page.locator("#shelf-play")).toHaveText("Play vs Klaw", { timeout: 30_000 });
  await page.locator("#shelf-play").click();
  await expect(room).toBeHidden({ timeout: 60_000 });
  await expect(page).toHaveTitle(/She-Hulk vs\. Klaw/);
});
