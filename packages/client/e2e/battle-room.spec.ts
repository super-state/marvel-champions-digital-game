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
  // Held for two frames: the pad reads a direction held over three reads and 400 ms as held, and repeats it, so on a
  // busy PC (slow frames) a three-frame tap could step twice.
  await frames(page, 2);
  await setButton(page, index, false);
  await frames(page, 3);
}

/** Steps the pad's focus one way until it is on a control whose text matches. */
async function padTo(page: Page, direction: number, name: RegExp, max = 6): Promise<void> {
  for (let i = 0; i < max && !name.test(await focused(page)); i++) await nudge(page, direction);
  expect(await focused(page)).toMatch(name);
}

test.describe("battle table: the room", () => {
  test("walked by keyboard: press any button, the menu (every place open), Settings, Campaign and back", async ({
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

    // Every place in the room is filled now: no menu choice is held back as "Coming soon", and each says what is there.
    await expect(menu.locator('[aria-disabled="true"]')).toHaveCount(0);
    await expect(menu.getByText("Coming soon")).toHaveCount(0);

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

  test.describe("the menu's camera", () => {
    // The camera glides here (the other specs fade, with reduced motion).
    test.use({ reducedMotion: "no-preference" });

    test("highlighting each choice takes the camera to its place's own view; choosing it opens there, Back stays", async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await page.goto("/battle/");
      await at(page, "title");
      await expect(room(page)).toHaveAttribute("data-view", "doorway");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      // Down the menu by keyboard: each highlight goes all the way to that place's view.
      for (const [i, place] of ["campaign", "free-play", "decks", "trophies", "settings"].entries()) {
        if (i) await page.keyboard.press("ArrowDown");
        await expect(room(page)).toHaveAttribute("data-view", place);
        await expect(room(page)).toHaveAttribute("data-view-settled", "", { timeout: 15_000 });
      }
      // Quickly up two and down one: no glides queue up, the camera turns for the last one.
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowDown");
      await expect(room(page)).toHaveAttribute("data-view", "trophies");
      await expect(room(page)).toHaveAttribute("data-view-settled", "", { timeout: 15_000 });
      // Choosing it opens the place at once: the camera is already there.
      const chosen = Date.now();
      await page.keyboard.press("Enter");
      await at(page, "trophies");
      expect(Date.now() - chosen).toBeLessThan(1000);
      // Back: the menu, still at the cabinet.
      await page.keyboard.press("Escape");
      await at(page, "title");
      await expect(room(page)).toHaveAttribute("data-view", "trophies");
      await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
    });

    test("the pointer settles before the camera goes; a tap on a phone goes in one", async ({ page }) => {
      test.setTimeout(150_000);
      await page.goto("/battle/");
      await at(page, "title");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      await expect(room(page)).toHaveAttribute("data-view", "campaign");
      // Sweeping the pointer straight down across Free Play, Heroes & Decks and Trophies to Settings: the camera only
      // ever heads for Settings (every view it heads for is written down as it changes).
      await page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { __views: string[] }).__views = seen;
        const shelf = document.getElementById("shelf")!;
        new MutationObserver(() => seen.push(shelf.dataset.view ?? "")).observe(shelf, {
          attributes: true,
          attributeFilter: ["data-view"],
        });
      });
      const choice = (name: RegExp) => room(page).getByRole("button", { name });
      const from = (await choice(/^Free Play/).boundingBox())!;
      const to = (await choice(/^Settings/).boundingBox())!;
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
      await expect(room(page)).toHaveAttribute("data-view", "settings");
      await expect(room(page)).toHaveAttribute("data-view-settled", "", { timeout: 15_000 });
      const views = await page.evaluate(() => (window as unknown as { __views: string[] }).__views);
      expect([...new Set(views)].filter((view) => view !== "campaign")).toEqual(["settings"]);
    });

    test("on a phone, one tap on a choice goes there", async ({ browser }) => {
      test.setTimeout(150_000);
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.goto("/battle/");
      await at(page, "title");
      await page.getByRole("button", { name: "Press any button" }).tap();
      await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
      await page.waitForTimeout(400);
      await room(page)
        .getByRole("button", { name: /^Settings/ })
        .tap();
      await at(page, "settings");
      await context.close();
    });
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
