import { expect, test, type Page } from "./battle-test";
import { frames, installPad, PAD, setButton } from "./pad-e2e-helpers.js";

/**
 * Heroes & Decks at the room's bench (`src/battle-table/room/places/decks.ts`): walked to by keyboard and by a fake
 * Xbox pad, a hero picked from their box on the shelf (a see-through button over it), a deck built in the deck builder
 * laid over the room and saved, and a game dealt with it.
 */

const room = (page: Page) => page.locator("#shelf");
const builder = (page: Page) => page.locator('.decks[data-mode="room"]');

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
  await setButton(page, index, true);
  // Held for two frames: the pad reads a direction held over three reads and 400 ms as held, and repeats it, so on a
  // busy PC (slow frames) a three-frame tap could step twice.
  await frames(page, 2);
  await setButton(page, index, false);
  await frames(page, 3);
}

async function padTo(page: Page, direction: number, name: RegExp, max = 8): Promise<void> {
  for (let i = 0; i < max && !name.test(await focused(page)); i++) await nudge(page, direction);
  expect(await focused(page)).toMatch(name);
}

/** Enter twice on each card of the builder's open page, stepping on with Tab, from its first card. */
async function twoOfEach(page: Page): Promise<void> {
  const count = await builder(page).locator(".binder-card").count();
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
  }
}

test.describe("battle table: Heroes & Decks at the bench", () => {
  test("by keyboard: pick Captain Marvel, build her a Justice deck, and deal a game with it", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/battle/");
    await at(page, "title");
    await page.keyboard.press("x");
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
    await page.waitForTimeout(400);
    // The bench is open now: no longer "Coming soon".
    await keyTo(page, "ArrowDown", /^Heroes & Decks/);
    expect(await focused(page)).not.toMatch(/Coming soon/);
    await page.keyboard.press("Enter");
    await at(page, "decks");
    const bench = room(page).locator('[data-for="decks"]');

    // A deck box (a button over it) for every hero in the game, in release order, the five the table deals among
    // them; Captain Marvel picked by the arrows. The deck card opens once a hero is picked.
    await expect(bench.locator(".bench-card")).toBeHidden();
    expect(await bench.locator(".bench-hero").count()).toBeGreaterThan(60);
    await expect(bench.locator('.bench-hero[data-bench^="hero:"]')).toHaveCount(5);
    await expect(bench.locator(".bench-hero").nth(0)).toHaveText("Spider-Man");
    await expect(bench.locator(".bench-hero").nth(1)).toHaveText("Captain Marvel");
    await expect.poll(() => focused(page)).toBe("Spider-Man");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toBe("Captain Marvel");
    await page.keyboard.press("Enter");
    await expect(bench.getByRole("button", { name: "Captain Marvel", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await page.evaluate(() => localStorage.getItem("battle-hero"))).toBe("captain-marvel");
    await expect(bench.locator(".bench-card")).toBeVisible();
    await expect(bench.locator(".bench-pick")).toHaveText([/Starter deck.*Leadership, as printed/]);

    // New deck: the builder over the room, with only the aspects the table has been checked with.
    await keyTo(page, "ArrowDown", /^New deck$/);
    await page.keyboard.press("Enter");
    await expect(builder(page)).toBeVisible();
    await expect(builder(page).locator("#tray-total")).toHaveText("15 cards (40 to 50)");
    await page.keyboard.press("PageUp");
    // The aspects checked on the table: all four of the Core Set since Black Panther's Protection cards came in.
    await expect(builder(page).locator(".aspect-chip")).toHaveText([
      "Aggression",
      "Justice",
      "Leadership",
      "Protection",
    ]);
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(":focus")).toHaveClass(/aspect-chip/);
    await keyTo(page, "ArrowRight", /^Justice$/);
    await page.keyboard.press("Enter");
    for (let i = 0; i < 6 && !(await page.locator(":focus").getAttribute("class"))?.includes("binder-card"); i++)
      await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveClass(/binder-card/);
    await twoOfEach(page);
    await page.keyboard.press("PageDown");
    await twoOfEach(page);
    await expect(builder(page).locator("#legality")).toHaveText(/Legal deck: 4\d cards\./);

    // Named and saved; Escape leaves the name, Escape again returns to the bench.
    await builder(page).locator("#deck-name").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Carol's Justice");
    await page.keyboard.press("Enter");
    await expect(builder(page).locator("#builder-notice")).toHaveText("Saved as “Carol's Justice”.");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(builder(page)).toBeHidden();
    await at(page, "decks");
    // The deck just built is the one she plays.
    await expect(bench.locator(".bench-pick", { hasText: "Carol's Justice" })).toHaveAttribute("aria-pressed", "true");
    await expect(bench.locator(".bench-line")).toHaveText(
      "Campaign and Free Play deal Captain Marvel with Carol's Justice.",
    );

    // Escape puts the card away (the focus back on her box); again, back to the doorway. Campaign, Rhino, Play: the
    // game is dealt with her deck.
    await page.keyboard.press("Escape");
    await expect(bench.locator(".bench-card")).toBeHidden();
    await expect.poll(() => focused(page)).toBe("Captain Marvel");
    await page.keyboard.press("Escape");
    await at(page, "title");
    await keyTo(page, "ArrowUp", /^Campaign/);
    await page.keyboard.press("Enter");
    await at(page, "campaign");
    await page.keyboard.press("Enter");
    await expect(page.locator("#shelf-play")).toHaveText("Play vs Rhino", { timeout: 30_000 });
    await page.keyboard.press("Enter");
    await expect(page.locator("#matchup")).toHaveText("Captain Marvel vs. Rhino · Carol's Justice", {
      timeout: 60_000,
    });
    const look = await page.evaluate(() =>
      (window as unknown as { __battlePlay: { wait(): Promise<string> } }).__battlePlay.wait(),
    );
    expect(look).toMatch(/Carol Danvers/);
  });

  test("a saved deck the table can't deal is shown, says why, and can't be picked", async ({ page }) => {
    // Captain Marvel's own 15 cards with Protection chosen and nothing else: saved, but not a legal deck, so the bench
    // shows it held back with the engine's reason. (Every aspect is on the table now, so legality is what holds it.)
    await page.goto("/battle/decks.html?hero=01010a&deck=new");
    await page.keyboard.press("PageUp");
    await page.getByRole("radio", { name: "Protection" }).click();
    await page.getByLabel("Deck name").fill("Carol smashes");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#builder-notice")).toHaveText(/Saved as “Carol smashes”/);
    await page.goto("/battle/?room=decks");
    await at(page, "decks");
    const bench = room(page).locator('[data-for="decks"]');
    // The search finds her by her alter ego; A–Z puts Adam Warlock (not on the table yet) first.
    await bench.getByRole("searchbox", { name: "Find a hero" }).fill("carol");
    await expect(bench.locator(".bench-hero:not([hidden])")).toHaveText(["Captain Marvel"]);
    await bench.getByRole("searchbox", { name: "Find a hero" }).fill("");
    await bench.getByRole("button", { name: "A–Z" }).click();
    await expect(bench.locator(".bench-hero").first()).toHaveAccessibleName("Adam Warlock, not on the table yet");
    await bench.getByRole("button", { name: "Captain Marvel", exact: true }).press("Enter");
    const held = bench.locator(".bench-pick", { hasText: "Carol smashes" });
    await expect(held).toHaveAttribute("aria-disabled", "true");
    await expect(held).toContainText("Not legal yet: The deck has 15 cards; a deck must have between 40 and 50");
    // It only looks held back: a click still says why (forced past Playwright's aria-disabled check).
    await held.click({ force: true });
    await expect(held).toHaveAttribute("aria-pressed", "false");
    await expect(room(page).getByRole("status")).toContainText("can't be dealt");
  });

  test.describe("by controller", () => {
    test("A to the bench, the D-pad one step at a time, A picks, the builder's A / X / Y / LB / RB, B back", async ({
      page,
    }) => {
      test.setTimeout(180_000);
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
      await nudge(page, PAD.a);
      const bench = room(page).locator('[data-for="decks"]');
      await expect(bench.getByRole("button", { name: "Captain Marvel", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await padTo(page, PAD.down, /^New deck$/);
      await nudge(page, PAD.a);
      await expect(builder(page)).toBeVisible();

      // In the builder: one nudge moves one card along.
      const cards = builder(page).locator(".binder-card");
      await expect(page.locator(":focus")).toHaveAttribute(
        "data-deck-card",
        (await cards.nth(0).getAttribute("data-deck-card"))!,
      );
      await nudge(page, PAD.right);
      await expect(page.locator(":focus")).toHaveAttribute(
        "data-deck-card",
        (await cards.nth(1).getAttribute("data-deck-card"))!,
      );
      const total = builder(page).locator("#tray-total");
      await nudge(page, PAD.a);
      await expect(total).toHaveText("16 cards (40 to 50)");
      await nudge(page, PAD.x);
      await expect(total).toHaveText("15 cards (40 to 50)");
      await nudge(page, PAD.y);
      await expect(builder(page).locator("#zoom")).toHaveAttribute("open", "");
      await nudge(page, PAD.b);
      await expect(builder(page).locator("#zoom")).not.toHaveAttribute("open", "");
      await nudge(page, PAD.lb);
      await expect(builder(page).getByRole("tab", { name: "Aspect" })).toHaveAttribute("aria-selected", "true");
      await nudge(page, PAD.rb);
      await expect(builder(page).getByRole("tab", { name: "Basic" })).toHaveAttribute("aria-selected", "true");

      // B: nothing changed, so straight back to the bench, still at the bench.
      await nudge(page, PAD.b);
      await expect(builder(page)).toBeHidden();
      await at(page, "decks");
      await expect.poll(() => focused(page)).toBe("New deck");
    });
  });
});
