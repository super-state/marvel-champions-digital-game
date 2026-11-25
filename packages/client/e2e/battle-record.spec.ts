import { expect, test, type Page } from "@playwright/test";

/**
 * The record on a table with no test site behind it (Adam's own): a finished game is kept in this browser's storage,
 * with its facts; a game that earns an achievement says so in a toast over everything (only what that game earned,
 * never one earned before), which goes by itself and leaves the game-over panel open; and the menu's Record lists it all.
 *
 * Nine losses are in the record before the game, so losing this one is the tenth ("Lose 10 games"). An unseeded deal:
 * a seeded one is never saved.
 */

interface PlayHook {
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
  wait(): Promise<string>;
}

const KEY = "mc-table-record";

async function loseTheGame(page: Page) {
  // End every turn and defend nothing: the scheme or Rhino finishes it.
  for (let i = 0; i < 150; i++) {
    if (await page.locator("dialog#game-over[open]").count()) return;
    await page.evaluate(async () => {
      const hook = (window as unknown as { __battlePlay: PlayHook }).__battlePlay;
      const labels = hook.moves().map((m) => m.label);
      const pick =
        labels.find((l) => /^End turn/i.test(l)) ??
        labels.find((l) => /Don.t defend|^Pass|^Skip|^No\b|Decline/i.test(l)) ??
        labels.find((l) => /^Continue|^OK|^Next|^Keep/i.test(l)) ??
        labels[0];
      if (pick) await hook.play(pick);
      else await hook.wait();
    });
  }
  throw new Error("The game never ended");
}

test("a finished game goes into this browser's record, and the tenth loss earns its achievement", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript((key) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const now = Date.now();
    const games = Array.from({ length: 9 }, (_, i) => ({
      id: `before-${i}`,
      hero: "Spider-Man",
      villain: "klaw",
      result: "loss",
      reason: "allPlayersDefeated",
      rounds: 6,
      version: "0.2.0",
      deck: ["core-spider-man-justice"],
      startedAt: now - (20 - i) * 3600e3 - 1800e3,
      endedAt: now - (20 - i) * 3600e3,
      facts: null,
    }));
    // A win before: "Beat Klaw" is already earned, so it is never announced.
    games.push({ ...games[0]!, id: "before-win", result: "win", reason: "villainDefeated", endedAt: now - 3600e3 });
    localStorage.setItem(key, JSON.stringify({ v: 1, games }));
  }, KEY);
  await page.goto("/battle/?villain=rhino");
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay), {
      timeout: 60_000,
    })
    .toBe(true);

  await loseTheGame(page);
  // The toast: over everything, one at a time, and only what this game earned.
  const toast = page.locator("#achievement-toast .achievement-toast");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Achievement unlocked");
  await expect(toast).toContainText("Keep at it");
  await expect(toast).not.toContainText("Beat Klaw");
  // In the top layer, above the modal game-over panel, and it takes no clicks: the panel's buttons still work under it.
  expect(await page.locator("#achievement-toast").evaluate((el) => el.matches(":popover-open"))).toBe(true);
  await expect(page.locator("dialog#game-over")).toHaveAttribute("open", "");

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).games, KEY);
  expect(saved).toHaveLength(11);
  expect(saved[0]).toMatchObject({
    hero: "Spider-Man",
    villain: "rhino",
    result: "loss",
    deck: ["core-spider-man-justice"],
    facts: { v: 1, difficulty: "standard", modules: ["bomb_scare"], heroId: "01001a", deckSize: 40, undo: false },
  });

  // It goes by itself, and the game-over panel stays.
  await expect(toast).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("dialog#game-over")).toHaveAttribute("open", "");

  // The menu's Record lists the games and the achievements.
  await page.locator("#try-again").click();
  await expect(page.locator("dialog#game-over")).not.toHaveAttribute("open", "");
  await page.locator("#menu-button").click();
  await page.locator("#menu-record").click();
  const sheet = page.locator("dialog#player-record");
  await expect(sheet).toContainText("Achievements: 5 of 32");
  await expect(sheet).toContainText("Keep at it");
  await expect(sheet.locator(".player-stat").first()).toContainText("11");
});

for (const size of [
  { name: "a small phone", width: 375, height: 667 },
  { name: "a short laptop", width: 1280, height: 600 },
]) {
  test(`a first win's achievements never cover "Victory" or its buttons, on ${size.name}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.addInitScript(() => {
      if (sessionStorage.getItem("cleared")) return;
      sessionStorage.setItem("cleared", "1");
      localStorage.removeItem("mc-table-record");
    });
    await page.addInitScript(() => {
      const checks: { name: string; covers: boolean; afterOpen: number }[] = [];
      let openedAt = 0;
      Object.assign(window, { __toastChecks: checks });
      new MutationObserver(() => {
        const panel = document.getElementById("game-over") as HTMLDialogElement | null;
        if (panel?.open && !openedAt) openedAt = performance.now();
        const name = document.querySelector("#achievement-toast .achievement-toast-name")?.textContent;
        if (!name || checks.at(-1)?.name === name) return;
        const t = document.querySelector("#achievement-toast .achievement-toast")!.getBoundingClientRect();
        const h = document.getElementById("game-over-title")!.getBoundingClientRect();
        const hit = (b: DOMRect) => t.left < b.right && b.left < t.right && t.top < b.bottom && b.top < t.bottom;
        const covers = hit(h) || hit(document.querySelector(".game-over-actions")!.getBoundingClientRect());
        checks.push({ name, covers, afterOpen: openedAt ? performance.now() - openedAt : -1 });
      }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    // The dev-only finish scene: Rhino on his last hit point, one attack wins (and earns several achievements).
    await page.goto("/battle/?hero=spider-man&scene=finish&record=1&friend=0");
    await expect
      .poll(() => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay), {
        timeout: 60_000,
      })
      .toBe(true);
    await page.evaluate(async () => {
      const hook = (window as unknown as { __battlePlay: PlayHook }).__battlePlay;
      await hook.wait();
      await hook.play("Spider-Man: Attack");
    });
    await expect(page.locator("#game-over-title")).toHaveText("Victory", { timeout: 30_000 });
    const checks = () =>
      page.evaluate(
        () =>
          (window as unknown as { __toastChecks: { name: string; covers: boolean; afterOpen: number }[] })
            .__toastChecks,
      );
    await expect.poll(async () => (await checks()).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(4);
    const seen = await checks();
    expect(seen[0]!.afterOpen).toBeGreaterThan(1800);
    expect(seen.filter((c) => c.covers).map((c) => c.name)).toEqual([]);
    await expect(page.locator("#game-over-title")).toBeInViewport();
  });
}
