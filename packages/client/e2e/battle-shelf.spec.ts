import { expect, test } from "./battle-test";

/**
 * The campaign shelf is the 3D table's front door: the table page opens on the boxes, Play deals the game on the table
 * underneath and moves every piece onto it, and the shelf fades away onto the mulligan. A reload during the game goes
 * back to the table.
 */
test("the table page opens on the shelf, and Rhino's box plays into the mulligan", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/battle/");
  const shelf = page.locator("#shelf");
  await expect(shelf).toBeVisible({ timeout: 60_000 });
  await expect(shelf.getByRole("heading", { name: "Choose your campaign" })).toBeVisible();
  // The table underneath can't be reached while the shelf is up.
  await expect(page.locator("main.battle")).toHaveJSProperty("inert", true);

  // All three Core Set boxes open. (The boxes are picked from the keyboard here: their buttons are for keyboards and
  // screen readers, and lie under the room the mouse clicks.)
  await page.getByRole("button", { name: "Open Ultron" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#shelf-play")).toHaveText("Play vs Ultron", { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(shelf.locator(".shelf-opened")).toBeHidden();

  // Rhino's box opens; Escape puts it back on the shelf.
  await page.getByRole("button", { name: "Open Rhino" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#shelf-play")).toHaveText("Play vs Rhino", { timeout: 30_000 });
  // Keys are the shelf's while it is up: Escape shuts the box, it does not open the table's menu underneath.
  await page.keyboard.press("Escape");
  await expect(shelf.locator(".shelf-opened")).toBeHidden();
  await expect(page.locator("#menu")).not.toHaveJSProperty("open", true);

  await page.getByRole("button", { name: "Open Rhino" }).focus();
  await page.keyboard.press("Enter");
  await page.locator("#shelf-play").click({ timeout: 30_000 });
  await expect(shelf).toBeHidden({ timeout: 60_000 });
  await expect(page.locator("main.battle")).toHaveJSProperty("inert", false);
  await expect(page).toHaveTitle(/Spider-Man vs\. Rhino/);
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?", { timeout: 30_000 });

  // A reload mid-game deals again straight onto the table.
  await page.reload();
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?", { timeout: 60_000 });
  await expect(page.locator("#shelf")).toHaveCount(0);
});
