import { expect, test, type Page } from "@playwright/test";
import { frames, installPad, PAD, setButton } from "./pad-e2e-helpers.js";

/**
 * Trophies & Stats in the room (`src/battle-table/room/places/trophy-cabinet.ts`): the cabinet's achievements read
 * from this browser's record, the record board, and the mats. A record with one win against Rhino (and a loss to Klaw)
 * is laid in this browser's storage first: Beat Rhino is earned and gives the Rhino mat, Beat Klaw is not.
 */

const room = (page: Page) => page.locator("#shelf");

/** One win against Rhino and one loss to Klaw, as this browser's record keeps them (`record/home.ts`). */
async function seedRecord(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("trophies-spec")) return;
    sessionStorage.setItem("trophies-spec", "1");
    const now = Date.now();
    const game = (id: string, villain: string, result: string, reason: string, ago: number) => ({
      id,
      hero: "Spider-Man",
      villain,
      result,
      reason,
      rounds: 6,
      version: "dev",
      deck: ["core-spider-man-justice"],
      startedAt: now - ago - 600_000,
      endedAt: now - ago,
      facts: null,
    });
    localStorage.setItem(
      "mc-table-record",
      JSON.stringify({
        v: 1,
        games: [
          game("g2", "klaw", "loss", "mainSchemeCompleted", 1_000_000),
          game("g1", "rhino", "win", "villainDefeated", 2_000_000),
        ],
      }),
    );
    localStorage.removeItem("battle-mat");
  });
}

async function at(page: Page, place: string): Promise<void> {
  await expect(room(page)).toHaveAttribute("data-place", place, { timeout: 30_000 });
  await expect(room(page)).not.toHaveAttribute("data-moving", "", { timeout: 30_000 });
}

const focused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.getAttribute("aria-label") || active?.textContent?.trim() || active?.tagName || "";
  });

const detail = (page: Page) => page.locator("#trophies-detail");

/** From the doorway's "press any button" to the menu, the focus on its first choice. */
async function openMenu(page: Page): Promise<void> {
  await at(page, "title");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
  await page.waitForTimeout(400);
}

/** A menu choice, by keyboard. */
async function choose(page: Page, name: RegExp): Promise<void> {
  for (let i = 0; i < 6 && !name.test(await focused(page)); i++) await page.keyboard.press("ArrowDown");
  expect(await focused(page)).toMatch(name);
  await page.keyboard.press("Enter");
}

/** Campaign, Rhino's box, Play: the game dealt on the table. */
async function dealRhino(page: Page): Promise<void> {
  await choose(page, /^Campaign/);
  await at(page, "campaign");
  await page.getByRole("button", { name: "Open Rhino" }).focus();
  await page.keyboard.press("Enter");
  await page.locator("#shelf-play").click({ timeout: 30_000 });
  await expect(room(page)).toBeHidden({ timeout: 60_000 });
}

async function nudge(page: Page, index: number): Promise<void> {
  await setButton(page, index, true);
  await frames(page, 3);
  await setButton(page, index, false);
  await frames(page, 3);
}

async function padTo(page: Page, direction: number, name: RegExp, max = 8): Promise<void> {
  for (let i = 0; i < max && !name.test(await focused(page)); i++) await nudge(page, direction);
  expect(await focused(page)).toMatch(name);
}

test.describe("battle table: trophies and mats", () => {
  test("by keyboard: read an earned and an unearned achievement, pick the Rhino mat, deal on it; then back to the default", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await seedRecord(page);
    await page.goto("/battle/");
    await openMenu(page);
    const trophiesChoice = room(page).getByRole("button", { name: /^Trophies & Stats/ });
    await expect(trophiesChoice).not.toHaveAttribute("aria-disabled", "true");
    await choose(page, /^Trophies & Stats/);
    await at(page, "trophies");

    // One win against Rhino earns four: Beat Rhino, Win as Spider-Man, Win with Justice and Win with Bomb Scare.
    await expect(room(page).getByText("4 of 32 earned")).toBeVisible();
    // The cabinet opens on the first achievement: earned, saying how and what it gave.
    await expect.poll(() => focused(page)).toBe("Beat Rhino, earned");
    await expect(detail(page)).toContainText("Win a game against Rhino.");
    await expect(detail(page)).toContainText("Reward: the Rhino mat.");
    // The next one along is not earned yet.
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toBe("Beat Klaw, not earned yet");
    await expect(detail(page)).toContainText("Not earned yet.");

    // The record.
    const record = room(page).locator(".trophies-record");
    await expect(record.getByRole("row", { name: /Rhino 1 0/ })).toBeVisible();
    await expect(record.getByRole("row", { name: /Klaw 0 1/ })).toBeVisible();
    await expect(record).toContainText("1 in a row");

    // The mats: the Klaw mat is rolled up, saying how to earn it; the Rhino mat is earned and chosen.
    const klawMat = room(page).getByRole("button", { name: /^Klaw mat, locked/ });
    await expect(klawMat).toHaveAttribute("aria-disabled", "true");
    // A locked mat still takes the focus and a press, to say how to earn it.
    await klawMat.focus();
    await page.keyboard.press("Enter");
    await expect(room(page).getByRole("status")).toContainText("That earns the Klaw mat.");
    const rhinoMat = room(page).locator('.trophies-mat[data-mat="rhino"]');
    await rhinoMat.click();
    await expect(rhinoMat).toHaveAttribute("aria-pressed", "true");

    // Dealt, the table's mat is Rhino's.
    await page.keyboard.press("Escape");
    await at(page, "title");
    await dealRhino(page);
    await expect(page.locator("#board-viewport")).toHaveAttribute("data-mat", "rhino", { timeout: 30_000 });

    // New game, the default mat chosen at the cabinet, dealt again: the same table draws the new mat.
    await page.locator("#menu-button").click();
    await expect(page.locator("#reset")).toBeEnabled({ timeout: 15_000 });
    await page.locator("#reset").click();
    await at(page, "campaign");
    await page.keyboard.press("Escape");
    await at(page, "title");
    await choose(page, /^Trophies & Stats/);
    await at(page, "trophies");
    await room(page).locator('.trophies-mat[data-mat="night"]').click();
    await page.keyboard.press("Escape");
    await at(page, "title");
    await dealRhino(page);
    await expect(page.locator("#board-viewport")).toHaveAttribute("data-mat", "night", { timeout: 30_000 });
  });

  test.describe("by controller", () => {
    test("A goes to the cabinet, the D-pad reads the achievements, B comes back", async ({ page }) => {
      test.setTimeout(150_000);
      await seedRecord(page);
      await installPad(page);
      await page.goto("/battle/");
      await at(page, "title");
      await nudge(page, PAD.a);
      await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
      await page.waitForTimeout(400);
      await padTo(page, PAD.down, /^Trophies & Stats/);
      await nudge(page, PAD.a);
      await at(page, "trophies");
      await expect.poll(() => focused(page)).toBe("Beat Rhino, earned");
      await expect(detail(page)).toContainText("Earned");
      await padTo(page, PAD.right, /^Beat Klaw, not earned yet$/);
      await expect(detail(page)).toContainText("Not earned yet.");
      await nudge(page, PAD.b);
      await at(page, "title");
    });
  });
});
