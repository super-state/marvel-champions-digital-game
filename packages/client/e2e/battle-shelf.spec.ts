import { expect, test } from "./battle-test";
import { arrivedAt, pickCoreScenario } from "./campaign-steps.js";

/**
 * The campaign shelf (the room's Campaign place) is the way into a game: from the room's doorway to the boxes, where
 * Play deals the game on the table underneath and moves every piece onto it, and the shelf fades away onto the
 * mulligan. A reload during the game goes back to the table.
 */
test("the table page opens in the room, Campaign goes to the shelf, and Rhino's box plays into the mulligan", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/battle/");
  const shelf = page.locator("#shelf");
  await expect(shelf).toBeVisible({ timeout: 60_000 });
  // The room opens in its doorway: any key brings up the menu, and Campaign goes to the boxes.
  await expect(shelf).toHaveAttribute("data-place", "title", { timeout: 30_000 });
  await page.keyboard.press("Enter");
  const campaign = shelf.getByRole("button", { name: /^Campaign/ });
  await expect(campaign).toBeFocused();
  // The menu waits out the press that brought it up.
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await expect(shelf.getByRole("heading", { name: "Choose a scenario" })).toBeVisible({ timeout: 30_000 });
  // The table underneath can't be reached while the shelf is up.
  await expect(page.locator("main.battle")).toHaveJSProperty("inert", true);

  // The Core Set's box on the scenario shelf, up close, then a scenario in it: its villain box opens on the table. (Picked
  // from the keyboard here: the boxes' buttons are for keyboards and screen readers, and lie under the room the mouse
  // clicks.) Then the hero shelf asks for a hero; Play as goes on to the table. Escape goes back a step at a time:
  // from the table to the heroes, from the heroes to the Core Set up close.
  await pickCoreScenario(page, "Rhino");
  await expect(page.locator("#shelf-play")).toHaveText("Play vs Rhino", { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(shelf.locator(".shelf-opened")).toBeHidden();
  await arrivedAt(page, "decks");
  await page.keyboard.press("Escape");
  await arrivedAt(page, "campaign");
  await expect(shelf.locator(".scn-card")).toBeVisible();

  // Rhino's box opens; Escape puts it back.
  await pickCoreScenario(page, "Rhino");
  await expect(page.locator("#shelf-play")).toHaveText("Play vs Rhino", { timeout: 30_000 });
  // Keys are the shelf's while it is up: Escape shuts the box, it does not open the table's menu underneath.
  await page.keyboard.press("Escape");
  await expect(shelf.locator(".shelf-opened")).toBeHidden();
  await expect(page.locator("#menu")).not.toHaveJSProperty("open", true);
  await arrivedAt(page, "decks");
  await page.keyboard.press("Escape");
  await arrivedAt(page, "campaign");

  await pickCoreScenario(page, "Rhino");
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
