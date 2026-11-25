import { expect, test, type Page } from "@playwright/test";
import { frames, installPad, PAD, setButton } from "./pad-e2e-helpers.js";

/**
 * Free Play (`src/battle-table/room/places/free-play.ts`): the setup tray in the room. A game is built on it slot by
 * slot (villain, modules, difficulty, hero, deck) and Play deals it onto the mat. Built here once by keyboard (Klaw,
 * Expert, Legions of Hydra in place of his own module) and once by a fake Xbox pad through the table's own controller
 * code (Klaw, Expert, two modules at once, Captain Marvel).
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

/** A choice on the tray, in its slot's row. */
const option = (page: Page, slot: string, name: string | RegExp) =>
  room(page).getByRole("group", { name: slot }).getByRole("button", { name });

/** The game is dealt and the room has handed the page to the table. */
async function dealt(page: Page, title: string): Promise<void> {
  await expect(room(page)).toBeHidden({ timeout: 30_000 });
  await expect(page).toHaveTitle(`${title} · Marvel Champions`);
  // Expert: Klaw opens on stage II with The "Immortal" Klaw in play (RRG v1.8 Appendix II step 12c).
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { __battlePlay: { look(): Promise<string> } }).__battlePlay.look()),
      {
        timeout: 30_000,
      },
    )
    .toContain('The "Immortal" Klaw');
}

/** One press of a pad button, let go once the page has seen it (a held direction would repeat). */
async function nudge(page: Page, index: number): Promise<void> {
  await setButton(page, index, true);
  // Held for two frames: the pad reads a direction held over three reads and 400 ms as held, and repeats it, so on a
  // busy PC (slow frames) a three-frame tap could step twice.
  await frames(page, 2);
  await setButton(page, index, false);
  await frames(page, 3);
}

/** Steps the pad's focus towards the button `name` (in the row `slot`, or anywhere) until it is on it. */
async function padTo(page: Page, name: RegExp, slot?: string): Promise<void> {
  const target = slot ? option(page, slot, name) : room(page).getByRole("button", { name });
  for (let i = 0; i < 14 && !name.test(await focused(page)); i++) {
    const [to, from] = await Promise.all([
      target.boundingBox(),
      page.evaluate(() => {
        const box = (document.activeElement as HTMLElement).getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    ]);
    const dx = to!.x + to!.width / 2 - (from.x + from.width / 2);
    const dy = to!.y + to!.height / 2 - (from.y + from.height / 2);
    // Down a row first, then along it.
    await nudge(page, Math.abs(dy) > 8 ? (dy > 0 ? PAD.down : PAD.up) : dx > 0 ? PAD.right : PAD.left);
  }
  expect(await focused(page)).toMatch(name);
}

test.describe("battle table: Free Play", () => {
  test("built by keyboard: Klaw, Legions of Hydra, Expert, then Play deals it", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/battle/");
    await at(page, "title");
    await page.keyboard.press("x");
    await expect.poll(() => focused(page)).toMatch(/^Campaign/);
    await page.waitForTimeout(400);
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focused(page)).toMatch(/^Free Play/);
    await page.keyboard.press("Enter");
    await at(page, "free-play");
    await expect(room(page).getByRole("heading", { name: "Free Play" })).toBeVisible();

    // The villain row, Rhino chosen, his recommended module with him, Standard, Spider-Man and his starter deck.
    await expect.poll(() => focused(page)).toBe("Rhino");
    await expect(option(page, "Villain", "Rhino")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Module", /^Bomb Scare/)).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Difficulty", "Standard")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Deck", "Justice starter deck")).toHaveAttribute("aria-pressed", "true");

    // Right along the row, Enter picks: Klaw, and the module follows him to his recommended one.
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toBe("Klaw");
    await page.keyboard.press("Enter");
    await expect(option(page, "Villain", "Klaw")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Module", /^Masters of Evil/)).toHaveAttribute("aria-pressed", "true");

    // Down onto the module row's chosen one, along to Legions of Hydra: a module is a toggle, so it goes in beside
    // Klaw's own; back to Masters of Evil to take that out. The last one in can't be taken out.
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focused(page)).toMatch(/^Masters of Evil/);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toBe("Legions of Hydra");
    await page.keyboard.press("Enter");
    await expect(option(page, "Module", "Legions of Hydra")).toHaveAttribute("aria-pressed", "true");
    await expect(option(page, "Module", /^Masters of Evil/)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => focused(page)).toMatch(/^Masters of Evil/);
    await page.keyboard.press("Enter");
    await expect(option(page, "Module", /^Masters of Evil/)).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toBe("Legions of Hydra");
    await page.keyboard.press("Enter");
    await expect(room(page).getByRole("status")).toHaveText("A game needs at least one module.");
    await expect(option(page, "Module", "Legions of Hydra")).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => focused(page)).toBe("Expert");
    await page.keyboard.press("Enter");
    await expect(option(page, "Difficulty", "Expert")).toHaveAttribute("aria-pressed", "true");
    await expect(room(page).locator(".free-play-summary")).toHaveText(
      "Spider-Man vs. Klaw · Expert · Legions of Hydra",
    );

    // Down past the hero and the deck to Play.
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    await expect.poll(() => focused(page)).toBe("Play vs Klaw");
    await page.keyboard.press("Enter");
    await dealt(page, "Spider-Man vs. Klaw · Expert · Legions of Hydra");

    // A reload deals the same game again.
    await page.reload();
    await expect(page).toHaveTitle("Spider-Man vs. Klaw · Expert · Legions of Hydra · Marvel Champions", {
      timeout: 30_000,
    });
  });

  test.describe("by controller", () => {
    test("the D-pad moves through the tray, A picks, Play deals it, B goes back", async ({ page }) => {
      test.setTimeout(150_000);
      await installPad(page);
      await page.goto("/battle/");
      await at(page, "title");
      await nudge(page, PAD.a);
      await expect.poll(() => focused(page)).toMatch(/^Campaign/);
      await page.waitForTimeout(400);
      await nudge(page, PAD.down);
      await expect.poll(() => focused(page)).toMatch(/^Free Play/);
      await nudge(page, PAD.a);
      await at(page, "free-play");

      // B from the tray goes back to the doorway, and A comes back.
      await expect.poll(() => focused(page)).toBe("Rhino");
      await nudge(page, PAD.b);
      await at(page, "title");
      await expect.poll(() => focused(page)).toMatch(/^Free Play/);
      await nudge(page, PAD.a);
      await at(page, "free-play");

      // Legions of Hydra goes in beside Klaw's own Masters of Evil: two modules at once.
      for (const [slot, name] of [
        ["Villain", /^Klaw$/],
        ["Module", /^Legions of Hydra$/],
        ["Difficulty", /^Expert$/],
        ["Hero", /^Captain Marvel$/],
      ] as const) {
        await padTo(page, name, slot);
        await nudge(page, PAD.a);
        await expect(option(page, slot, name)).toHaveAttribute("aria-pressed", "true");
      }
      // The deck follows the hero: her starter deck.
      await expect(option(page, "Deck", "Leadership starter deck")).toHaveAttribute("aria-pressed", "true");
      await expect(option(page, "Module", /^Masters of Evil/)).toHaveAttribute("aria-pressed", "true");
      await padTo(page, /^Play vs Klaw$/);
      await nudge(page, PAD.a);
      // The title names the modules the game was dealt with (`main.ts` reads them back from the game).
      await dealt(page, "Captain Marvel vs. Klaw · Expert · Masters of Evil · Legions of Hydra");
    });
  });
});
