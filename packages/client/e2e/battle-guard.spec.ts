import { expect, test, type Page } from "@playwright/test";

/**
 * Guard explained (Adam, 2026-11-25: an attack "went straight to the guard one" and the player didn't know why). A
 * guard minion is called out as it arrives and wears a shield on its plate; attacking asks whom even with the guard
 * minion the only answer, says why the villain is out of reach, and pointing at the villain says it over him.
 */

interface PlayHook {
  look(): string;
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
  wait(): Promise<string>;
}

const hook = (page: Page) => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay);

test("a guard minion is called out, and the attack it narrows asks and says why", async ({ page }) => {
  test.setTimeout(120_000);
  // Every "Guard" stamp the page shows, caught as it is added (each lasts about a second).
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __guardStamps: string[] }).__guardStamps = seen;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement && node.matches('.card-stamp[data-tone="guard"]'))
            seen.push(node.dataset.card ?? "");
    }).observe(document, { subtree: true, childList: true });
  });
  await page.goto("/battle/?scene=guard&seed=7");
  await expect.poll(() => hook(page), { timeout: 60_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.wait());

  const stamps = () => page.evaluate(() => (window as unknown as { __guardStamps: string[] }).__guardStamps.length);
  await expect.poll(stamps, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.stat-pill[data-kind="guard"]')).toHaveCount(1);

  await page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.play("Spider-Man: Attack"));
  await expect(page.locator("#dock-title")).toHaveText("Choose an enemy to attack");
  await expect(page.locator("#instruction")).toHaveText(
    "Hydra Mercenary has Guard: Rhino can't be attacked until it is defeated.",
  );
  await expect(page.locator('.anchor[data-guarding] .stat-pill[data-kind="guard"]')).toHaveCount(1);

  // Pressing Rhino: the reason over him, and "Guard" stamped on the minion again.
  const before = await stamps();
  await page.locator("#board-labels .anchor.enemy").evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator(".guard-hint")).toContainText("Can't attack Rhino: Hydra Mercenary has Guard");
  await expect.poll(stamps).toBeGreaterThan(before);
  await expect(page.locator("#dock-title")).toHaveText("Choose an enemy to attack");
});
