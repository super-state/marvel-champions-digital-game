import { expect, test } from "./battle-test";

/**
 * "What's new" (src/battle-table/patch-notes/): the patch notes a player hasn't read open over the room once the boxes
 * are up, close by any route without the room or the table taking the key, stay closed once read, and open again from
 * the table's menu. (The fixture marks every note read; this test starts as a player who has read none.)
 */
test("unread patch notes open over the room, close at once, and reopen from the menu", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    // Only on the first load: the reload below must find the notes read.
    if (!sessionStorage.getItem("notes-test")) {
      sessionStorage.setItem("notes-test", "1");
      localStorage.removeItem("battle-notes-seen");
    }
  });
  await page.goto("/battle/");
  const shelf = page.locator("#shelf");
  await expect(shelf).toHaveAttribute("data-place", "title", { timeout: 60_000 });

  const notes = page.locator("#patch-notes");
  await expect(notes).toBeVisible({ timeout: 30_000 });
  await expect(notes.getByRole("heading", { name: "The game has been updated" })).toBeVisible();
  await expect(notes.getByRole("button", { name: "Continue" })).toBeFocused();
  // The notes scroll inside the box; the heading and Continue stay where they are.
  await expect(notes.locator(".notes-body")).toHaveCSS("overflow-y", "auto");
  await expect(notes.locator(".notes-version").first()).toHaveAttribute("open", "");

  // Escape closes it, and only it: the room's doorway is still waiting for its button press.
  await page.keyboard.press("Escape");
  await expect(notes).toHaveCount(0);
  await expect(shelf).toHaveAttribute("data-place", "title");
  await expect(shelf.getByRole("button", { name: /^Campaign/ })).not.toBeFocused();
  const seen = await page.evaluate(() => localStorage.getItem("battle-notes-seen"));
  expect(seen).toMatch(/^\d+\.\d+\.\d+$/);

  // Read once, they stay away.
  await page.reload();
  await expect(shelf).toHaveAttribute("data-place", "title", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await expect(notes).toHaveCount(0);

  // At the table, What's new in the menu opens every version; the cross closes it.
  await page.goto("/battle/?seed=7");
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?", { timeout: 60_000 });
  await page.locator("#menu-button").click();
  await page.locator("#menu-notes").click();
  await expect(page.locator("#menu")).not.toHaveJSProperty("open", true);
  await expect(notes).toBeVisible();
  await expect(notes.getByRole("heading", { name: "Patch notes" })).toBeVisible();
  await expect(notes.locator(".notes-version")).not.toHaveCount(0);
  await notes.getByRole("button", { name: "Close" }).click();
  await expect(notes).toHaveCount(0);
  // Enter pressed in the notes never reached the table: the mulligan is still asking.
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?");
});
