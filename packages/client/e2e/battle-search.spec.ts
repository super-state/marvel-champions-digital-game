import { expect, test, type Page } from "@playwright/test";

/**
 * Choosing a card found in a deck (Adam, 2026-11-25: Masters of Mayhem listed the Masters of Evil minions by name and
 * the player couldn't see what they did). The bar lays the found cards out face up; pointing at one shows it full
 * size; pressing one picks it and Confirm takes it. Driven through the play hook (`src/battle-table/play.ts`) up to
 * the question, then by the pointer.
 */

interface PlayHook {
  look(): string;
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
  wait(): Promise<string>;
}

const hook = (page: Page) => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay);
const moves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.moves().map((m) => m.label));

test("Masters of Mayhem's search shows the minions as cards to read, pick and confirm", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/battle/?scene=klawsearch&seed=7");
  await expect.poll(() => hook(page), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await moves(page)).length, { timeout: 60_000 }).toBeGreaterThan(0);
  // End the turn and answer everything until the search: discard down, pass Spider-Sense, don't defend.
  const reached = await page.evaluate(async () => {
    const play = (window as unknown as { __battlePlay: PlayHook }).__battlePlay;
    await play.wait();
    await play.play("End Turn");
    for (let i = 0; i < 12; i++) {
      await play.wait();
      if (
        /Masters of Mayhem/.test(
          play
            .look()
            .split("\n")
            .find((l) => l.startsWith("Turn bar")) ?? "",
        )
      )
        return true;
      const labels = play.moves().map((m) => m.label);
      const next =
        labels.find((l) => /^(Pass|Don’t defend|Discard 1)$/.test(l)) ?? labels.find((l) => l.startsWith("Pick "));
      if (!next) return false;
      await play.play(next);
    }
    return false;
  });
  expect(reached).toBe(true);

  const row = page.locator(".dock-cards");
  await expect(row).toBeVisible();
  const cards = row.locator(".dock-card");
  await expect(cards).toHaveCount(4);
  await expect(cards.locator(".dock-card-name")).toContainText([
    "Tiger Shark",
    "Melter",
    "Whirlwind",
    "Radioactive Man",
  ]);
  await expect(cards.first().locator("img")).toHaveJSProperty("complete", true);
  // The new question puts the keyboard on the first card, and Enter picks it (a controller's A steps the same way).
  await expect(cards.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dock-primary")).toHaveText("Confirm Tiger Shark");

  const melter = cards.filter({ hasText: "Melter" });
  await melter.hover();
  // Read full size where the pointer is (the hover picture), and in the card panel.
  await expect(page.locator("#hover-card")).toBeVisible();
  await expect(page.locator("#hover-card")).toHaveAttribute("alt", "Melter");

  // Picking another card moves the pick to it.
  const confirm = page.locator("#dock-primary");
  await melter.click();
  await expect(melter).toHaveAttribute("aria-pressed", "true");
  await expect(cards.first()).toHaveAttribute("aria-pressed", "false");
  await expect(confirm).toHaveText("Confirm Melter");
  await confirm.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.look()), {
      timeout: 30_000,
    })
    .toContain("- Melter (minion");
  await expect(row).toBeHidden();
});
