import { expect, test, type Page } from "./battle-test";
import { pickCoreScenario } from "./campaign-steps.js";
import { installPad, PAD, tap } from "./pad-e2e-helpers.js";

/**
 * Heroes & Decks at the room's bench (`src/battle-table/room/places/decks.ts`): walked to by keyboard and by a fake
 * Xbox pad, a hero's box (a see-through button over it) brought up close, chosen, and a game dealt with them; the
 * shelf's search, sorts and favourites, and a hero not on the table yet.
 */

const room = (page: Page) => page.locator("#shelf");

async function at(page: Page, place: string): Promise<void> {
  await expect(room(page)).toHaveAttribute("data-place", place, { timeout: 30_000 });
  await expect(room(page)).not.toHaveAttribute("data-moving", "", { timeout: 30_000 });
}

const focused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.getAttribute("aria-label") || active?.textContent?.trim() || active?.tagName || "";
  });

/** Presses an arrow until the focus is on a control whose name matches. */
async function keyTo(page: Page, key: string, name: RegExp, max = 8): Promise<void> {
  for (let i = 0; i < max && !name.test(await focused(page)); i++) await page.keyboard.press(key);
  expect(await focused(page)).toMatch(name);
}

async function nudge(page: Page, index: number): Promise<void> {
  // A tap, let go as soon as the game acts on it (`tap`): a fixed hold could read as held on a busy PC and sweep.
  await tap(page, index);
}

async function padTo(page: Page, direction: number, name: RegExp, max = 8): Promise<void> {
  for (let i = 0; i < max && !name.test(await focused(page)); i++) await nudge(page, direction);
  expect(await focused(page)).toMatch(name);
}

test.describe("battle table: Heroes & Decks at the bench", () => {
  test("by keyboard: bring Captain Marvel up close, choose her, and deal a game with her", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/battle/");
    await at(page, "title");
    await page.keyboard.press("x");
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
    await page.waitForTimeout(400);
    await keyTo(page, "ArrowDown", /^Heroes & Decks/);
    expect(await focused(page)).not.toMatch(/Coming soon/);
    await page.keyboard.press("Enter");
    await at(page, "decks");
    const bench = room(page).locator('[data-for="decks"]');

    // A deck box (a button over it) for every hero in the game, in release order, the five the table deals among
    // them. Nothing up close until one is picked.
    await expect(bench.locator(".bench-card")).toBeHidden();
    expect(await bench.locator(".bench-hero").count()).toBeGreaterThan(60);
    await expect(bench.locator('.bench-hero[data-bench^="hero:"]')).toHaveCount(5);
    await expect(bench.locator(".bench-hero").nth(0)).toHaveText("Spider-Man");
    await expect(bench.locator(".bench-hero").nth(1)).toHaveText("Captain Marvel");
    await expect.poll(() => focused(page)).toBe("Spider-Man");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toBe("Captain Marvel");

    // Picked: up close, her starter deck, Play as her, and Add to favourites under it (nothing chosen until Play).
    await page.keyboard.press("Enter");
    await expect(bench.locator(".bench-card")).toBeVisible();
    await expect(bench.locator(".bench-deck-line")).toHaveText("Starter deck · Leadership");
    await expect.poll(() => focused(page)).toBe("Play as Captain Marvel");
    await bench.getByRole("button", { name: "Favourite", exact: true }).click();
    await expect(bench.getByRole("button", { name: "Favourite", exact: true })).toHaveAttribute("aria-pressed", "true");
    await bench.getByRole("button", { name: "Play as Captain Marvel" }).press("Enter");
    await expect(bench.locator(".bench-card")).toBeHidden();
    await expect(bench.getByRole("button", { name: "Captain Marvel", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await page.evaluate(() => localStorage.getItem("battle-hero"))).toBe("captain-marvel");
    await expect.poll(() => focused(page)).toBe("Captain Marvel");

    // Escape: back to the doorway. Campaign, Rhino, Play: the game is dealt with her.
    await page.keyboard.press("Escape");
    await at(page, "title");
    await keyTo(page, "ArrowUp", /^Campaign/);
    await page.keyboard.press("Enter");
    await at(page, "campaign");
    await pickCoreScenario(page, "Rhino");
    await expect(page.locator("#shelf-play")).toHaveText("Play vs Rhino", { timeout: 30_000 });
    await page.keyboard.press("Enter");
    await expect(page.locator("#matchup")).toHaveText(/^Captain Marvel vs\. Rhino/, { timeout: 60_000 });
    const look = await page.evaluate(() =>
      (window as unknown as { __battlePlay: { wait(): Promise<string> } }).__battlePlay.wait(),
    );
    expect(look).toMatch(/Carol Danvers/);
  });

  test("the search, the sorts, favourites, and a hero not on the table yet", async ({ page }) => {
    await page.goto("/battle/?room=decks");
    await at(page, "decks");
    const bench = room(page).locator('[data-for="decks"]');
    const shown = bench.locator(".bench-hero:not([hidden])");

    // The search finds her by her alter ego; Playable only leaves the five.
    await bench.getByRole("searchbox", { name: "Find a hero" }).fill("carol");
    await expect(shown).toHaveText(["Captain Marvel"]);
    await bench.getByRole("searchbox", { name: "Find a hero" }).fill("");
    await bench.getByRole("button", { name: "Playable only" }).click();
    await expect(shown).toHaveCount(5);
    await bench.getByRole("button", { name: "Playable only" }).click();

    // A–Z puts Adam Warlock first: up close he is not on the table yet, with no Play, but can be a favourite.
    await bench.getByRole("button", { name: "A–Z" }).click();
    const warlock = bench.getByRole("button", { name: "Adam Warlock, not on the table yet" });
    await expect(shown.first()).toHaveAccessibleName("Adam Warlock, not on the table yet");
    await warlock.press("Enter");
    await expect(bench.locator(".bench-card")).toBeVisible();
    await expect(bench.locator(".bench-card .bench-line")).toHaveText(
      "Not on the table yet: from The Mad Titan's Shadow.",
    );
    await expect(bench.getByRole("button", { name: /^Play as/ })).toHaveCount(0);
    await bench.getByRole("button", { name: "Favourite", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(bench.locator(".bench-card")).toBeHidden();

    // Favourites first, in release order after them; the choice of sort is kept.
    await bench.getByRole("button", { name: "Release" }).click();
    await expect(shown.first()).toHaveText("Spider-Man");
    await bench.getByRole("button", { name: "Favourites" }).click();
    await expect(shown.first()).toHaveAccessibleName("Adam Warlock, not on the table yet");
    await page.reload();
    await at(page, "decks");
    await expect(bench.getByRole("button", { name: "Favourites" })).toHaveAttribute("aria-pressed", "true");
  });

  test("by controller: A to the bench, the D-pad one step at a time, A up close, A chooses, B back", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await installPad(page);
    await page.goto("/battle/");
    await at(page, "title");
    await nudge(page, PAD.a);
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
    await page.waitForTimeout(400);
    await padTo(page, PAD.down, /^Heroes & Decks/);
    await nudge(page, PAD.a);
    await at(page, "decks");
    await expect.poll(() => focused(page)).toBe("Spider-Man");
    // One nudge, one step: the table's controller moves the focus, and nothing else does.
    await nudge(page, PAD.right);
    await expect.poll(() => focused(page)).toBe("Captain Marvel");
    await page.waitForTimeout(300);
    const bench = room(page).locator('[data-for="decks"]');
    await nudge(page, PAD.a);
    await expect(bench.locator(".bench-card")).toBeVisible();
    await expect.poll(() => focused(page)).toBe("Play as Captain Marvel");
    await nudge(page, PAD.a);
    await expect(bench.getByRole("button", { name: "Captain Marvel", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // A again: up close; B puts it back, the focus on her box; B again, back to the doorway.
    await expect.poll(() => focused(page)).toBe("Captain Marvel");
    await nudge(page, PAD.a);
    await expect(bench.locator(".bench-card")).toBeVisible();
    await nudge(page, PAD.b);
    await expect(bench.locator(".bench-card")).toBeHidden();
    await expect.poll(() => focused(page)).toBe("Captain Marvel");
    await nudge(page, PAD.b);
    await at(page, "title");
  });
});
