import { expect, test, type Page } from "@playwright/test";

/**
 * The record on a table with no test site behind it (Adam's own): a finished game is kept in this browser's storage,
 * with its facts; a game that earns an achievement says so in a pop-up (only what that game earned, never one earned
 * before); a key puts the pop-up away without closing the game-over panel; and the menu's Record lists it all.
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
  const popup = page.locator("#achievement-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Achievement unlocked");
  await expect(popup).toContainText("Keep at it");
  await expect(popup).not.toContainText("Beat Klaw");

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).games, KEY);
  expect(saved).toHaveLength(11);
  expect(saved[0]).toMatchObject({
    hero: "Spider-Man",
    villain: "rhino",
    result: "loss",
    deck: ["core-spider-man-justice"],
    facts: { v: 1, difficulty: "standard", modules: ["bomb_scare"], heroId: "01001a", deckSize: 40, undo: false },
  });

  // A key puts it away, and only it: the game-over panel stays.
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
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
