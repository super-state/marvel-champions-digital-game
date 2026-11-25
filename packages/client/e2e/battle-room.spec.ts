import { expect, test, type Page } from "@playwright/test";
import { frames, installPad, PAD, setButton } from "./pad-e2e-helpers.js";

/**
 * The room (`src/battle-table/room/`): the table page opens in its doorway on "press any button", then a menu whose
 * choices glide the camera to places in the room, and Back (Escape, or B on a pad) goes one step back towards the
 * doorway. Walked here by keyboard, then by a fake Xbox pad through the table's own controller code.
 */

const room = (page: Page) => page.locator("#shelf");

/** The camera has come to rest at a place. */
async function at(page: Page, place: string): Promise<void> {
  await expect(room(page)).toHaveAttribute("data-place", place, { timeout: 30_000 });
  await expect(room(page)).not.toHaveAttribute("data-moving", "", { timeout: 30_000 });
}

/** What the focus is on: its accessible name, else its text. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.getAttribute("aria-label") || active?.textContent?.trim() || active?.tagName || "";
  });

/** One press of a pad button, let go once the page has seen it (a held direction would repeat). */
async function nudge(page: Page, index: number): Promise<void> {
  await setButton(page, index, true);
  await frames(page, 3);
  await setButton(page, index, false);
  await frames(page, 3);
}

/** Steps the pad's focus one way until it is on a control whose text matches. */
async function padTo(page: Page, direction: number, name: RegExp, max = 6): Promise<void> {
  for (let i = 0; i < max && !name.test(await focused(page)); i++) await nudge(page, direction);
  expect(await focused(page)).toMatch(name);
}

test.describe("battle table: the room", () => {
  test("walked by keyboard: press any button, the menu, Settings, a place still to come, Campaign and back", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto("/battle/");
    await at(page, "title");
    await expect(room(page).getByRole("heading", { name: "Marvel Champions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Press any button" })).toBeVisible();
    // The table underneath can't be reached while the room is up.
    await expect(page.locator("main.battle")).toHaveJSProperty("inert", true);

    // Any key brings up the menu, its first choice focused.
    await page.keyboard.press("x");
    const menu = page.getByRole("navigation", { name: "Main menu" });
    await expect(menu).toBeVisible();
    await expect.poll(() => focused(page)).toMatch(/^Campaign/);
    // The menu waits out the press that brought it up.
    await page.waitForTimeout(400);

    // Up and down move through it; Settings goes to the radio.
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    await expect.poll(() => focused(page)).toMatch(/^Settings/);
    await page.keyboard.press("Enter");
    await at(page, "settings");
    await expect(room(page).getByRole("heading", { name: "Settings" })).toBeVisible();
    // The table's own settings, changed from here.
    const soundOff = room(page).getByRole("group", { name: "Sound" }).getByRole("button", { name: "Off" });
    await soundOff.click();
    await expect(soundOff).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#menu [data-sound="off"]')).toHaveAttribute("aria-pressed", "true");
    await room(page).getByRole("group", { name: "Sound" }).getByRole("button", { name: "On" }).click();

    // Escape goes back to the doorway, with the focus on the choice it came from.
    await page.keyboard.press("Escape");
    await at(page, "title");
    await expect.poll(() => focused(page)).toMatch(/^Settings/);
    // Escape at the doorway goes nowhere, and never opens the table's menu underneath.
    await page.keyboard.press("Escape");
    await expect(page.locator("#menu")).not.toHaveJSProperty("open", true);

    // A place still to come says so, and the camera stays (whichever is still to come: they fill up one by one).
    const stillToCome = menu.locator('[aria-disabled="true"] .room-choice-name');
    const soon = (await stillToCome.count()) ? await stillToCome.first().textContent() : null;
    if (soon) {
      for (let i = 0; i < 5 && !(await focused(page)).startsWith(soon); i++) await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await expect(room(page).getByRole("status")).toHaveText(`${soon} is coming soon.`);
      await expect(room(page)).toHaveAttribute("data-place", "title");
    }

    // Campaign: the boxes. Escape puts an open box back, then goes back to the doorway.
    for (let i = 0; i < 5 && !(await focused(page)).startsWith("Campaign"); i++) await page.keyboard.press("ArrowUp");
    await expect.poll(() => focused(page)).toMatch(/^Campaign/);
    await page.keyboard.press("Enter");
    await at(page, "campaign");
    await expect(room(page).getByRole("heading", { name: "Choose your campaign" })).toBeVisible();
    await expect.poll(() => focused(page)).toBe("Open Rhino");
    await page.keyboard.press("Enter");
    await expect(page.locator("#shelf-play")).toHaveText("Play vs Rhino", { timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(room(page).locator(".shelf-opened")).toBeHidden();
    await page.keyboard.press("Escape");
    await at(page, "title");
    await expect.poll(() => focused(page)).toMatch(/^Campaign/);
  });

  test("?room= starts at a place", async ({ page }) => {
    await page.goto("/battle/?room=trophies");
    await at(page, "trophies");
    await expect(room(page).getByRole("heading", { name: "Trophies & Stats" })).toBeVisible();
    await room(page).getByRole("button", { name: "Back", exact: true }).click();
    await at(page, "title");
  });

  test.describe("by controller, gliding", () => {
    // The camera glides here, as it does for most players (the other specs fade, with reduced motion).
    test.use({ reducedMotion: "no-preference" });

    test("A brings up the menu, the D-pad moves through it, A goes, B comes back", async ({ page }) => {
      test.setTimeout(150_000);
      await installPad(page);
      await page.goto("/battle/");
      await at(page, "title");

      // Any button is "any button": A brings up the menu.
      await nudge(page, PAD.a);
      await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.input ?? null)).toBe("pad");
      await expect.poll(() => focused(page)).toMatch(/^Campaign/);
      await page.waitForTimeout(400);

      await padTo(page, PAD.down, /^Settings/);
      await nudge(page, PAD.a);
      await at(page, "settings");
      await expect.poll(() => focused(page)).toBe("Left");
      await nudge(page, PAD.b);
      await at(page, "title");
      await expect.poll(() => focused(page)).toMatch(/^Settings/);

      await padTo(page, PAD.up, /^Campaign/);
      await nudge(page, PAD.a);
      await at(page, "campaign");
      await expect.poll(() => focused(page)).toBe("Open Rhino");
      await padTo(page, PAD.right, /^Open Klaw$/);
      await nudge(page, PAD.a);
      await expect(page.locator("#shelf-play")).toHaveText("Play vs Klaw", { timeout: 30_000 });
      await nudge(page, PAD.b);
      await expect(room(page).locator(".shelf-opened")).toBeHidden();
      await nudge(page, PAD.b);
      await at(page, "title");
    });
  });
});
