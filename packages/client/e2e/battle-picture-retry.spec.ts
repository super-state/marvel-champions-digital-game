import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * A card picture whose first requests fail is asked for again (`picture-retry.ts`), on the table's 3D cards and in the
 * card preview beside it. Before, one failed request (22 Nov 2026: The Power of Justice, just drawn) left the card
 * black in the hand and the preview a broken image for the rest of the game.
 */

/**
 * What a picture that gets through is answered with: a real picture from the repo, so the test doesn't depend on the
 * card scans being on disk (a fresh worktree has only the card backs).
 */
const PICTURE = readFileSync(
  new URL("../../../assets/card-art/bundles/cards/marvel-player-back.webp", import.meta.url),
);

/** Fails the first `failures` requests for each card picture, then answers it with `PICTURE`; logs every URL asked, in order. */
async function flakyCardArt(page: Page, failures: number) {
  const asked: string[] = [];
  const counts = new Map<string, number>();
  await page.route("**/card-art/**", async (route) => {
    const url = new URL(route.request().url());
    asked.push(url.pathname + url.search);
    const seen = (counts.get(url.pathname) ?? 0) + 1;
    counts.set(url.pathname, seen);
    if (seen <= failures) await route.fulfill({ status: 503, body: "busy" });
    else await route.fulfill({ status: 200, contentType: "image/webp", body: PICTURE });
  });
  return asked;
}

test("a table card's picture that fails at first is asked for again until it loads", async ({ page }) => {
  const asked = await flakyCardArt(page, 2);
  // The player deck's back shows from the opening on, so the table always asks for it.
  const back = "/card-art/bundles/cards/marvel-player-back.webp";
  await page.goto("/battle/?seed=11");
  // The plain try and the first retry fail; the second retry (after 1 s, then 3 s) is answered.
  await expect
    .poll(() => asked.filter((url) => url.startsWith(back)).length, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(3);
  expect(asked.filter((url) => url.startsWith(back)).slice(0, 3)).toEqual([back, `${back}?retry=1`, `${back}?retry=2`]);
});

test("the card preview asks again for a picture that fails at first", async ({ page }) => {
  await flakyCardArt(page, 2);
  await page.goto("/battle/?seed=11");
  const preview = page.locator("#preview");
  await expect(preview).toBeVisible();
  await expect
    .poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
});
