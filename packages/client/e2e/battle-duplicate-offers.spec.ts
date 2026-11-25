import { expect, test, type Page } from "./battle-test";

/**
 * Two copies of a reaction card in hand on the 3D battle table (`src/battle-table/offer-queue.ts`): the question is
 * asked once per card. Scene `senses`: two Enhanced Spider-Senses in hand as Hard to Keep Down is revealed.
 */

const SENSE = /Use Enhanced Spider-Sense/;
const SHOTS = process.env.BATTLE_SHOTS;

async function dock(page: Page) {
  return page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)?.textContent?.trim() ?? "";
    const usable = (id: string) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      return !!el && !el.disabled && !el.hidden && el.offsetParent !== null;
    };
    return {
      title: text("dock-title"),
      eyebrow: text("dock-eyebrow"),
      primary: usable("dock-primary") ? text("dock-primary") : null,
      secondary: usable("dock-secondary") ? text("dock-secondary") : null,
      waiting: document.getElementById("dock")?.hasAttribute("data-waiting") ?? false,
      anchors: [...document.querySelectorAll("#anchors [aria-label]")].map((el) => el.getAttribute("aria-label")),
    };
  });
}

/**
 * Press a dock button until the dock moves on: the table ignores a mouse click while the cards are still settling (a
 * mis-tap guard, `paintButton`), as when the question has only just flown in.
 */
async function press(page: Page, id: "dock-primary" | "dock-secondary") {
  const before = JSON.stringify(await dock(page));
  for (let i = 0; i < 30; i++) {
    await page.locator(`#${id}`).click();
    await page.waitForTimeout(400);
    if (JSON.stringify(await dock(page)) !== before) return;
  }
  throw new Error(`#${id} never took: ${before}`);
}

/** End the turn and pass everything until the Spider-Sense question is up. */
async function toTheQuestion(page: Page) {
  await page.goto("/battle/?seed=7&scene=senses");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#end-turn").click();
  const log: string[] = [];
  for (let i = 0; i < 120; i++) {
    const d = await dock(page);
    log.push(JSON.stringify(d));
    if (d.primary && SENSE.test(d.primary)) return log;
    // Seven cards at the end of the turn: discard Genius, never a Spider-Sense.
    // (Its button stays disabled until a card is picked.)
    if (d.title.startsWith("Discard") && d.primary) await page.locator("#dock-primary").click();
    else if (d.title.startsWith("Discard") && d.anchors.includes("Discard Genius"))
      await page.locator('#anchors [aria-label="Discard Genius"]').evaluate((el) => (el as HTMLElement).click());
    else if (!d.waiting && d.secondary && /^(Pass|Don.t defend)$/.test(d.secondary))
      await page.locator("#dock-secondary").click();
    else if (!d.waiting && d.primary && /^(Continue|Start|OK|Next)/i.test(d.primary))
      await page.locator("#dock-primary").click();
    await page.waitForTimeout(500);
  }
  throw new Error(`never asked about Spider-Sense:\n${log.slice(-15).join("\n")}`);
}

test("two Spider-Senses: a yes plays one and goes straight to paying for it", async ({ page }) => {
  test.setTimeout(240_000);
  await toTheQuestion(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-question.png` });
  await press(page, "dock-primary");
  const after = await dock(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-after-yes.png` });
  expect(after.primary ?? "").not.toMatch(SENSE);
  expect(after.title).toBe("Pay 1");
  expect(after.eyebrow).toBe("Enhanced Spider-Sense");
});

test("two Spider-Senses: one pass covers both copies", async ({ page }) => {
  test.setTimeout(240_000);
  await toTheQuestion(page);
  const question = await dock(page);
  await press(page, "dock-secondary");
  // Whatever comes next, it is not this question again for the other copy.
  for (let i = 0; i < 6; i++) {
    const d = await dock(page);
    expect(d.eyebrow === question.eyebrow && SENSE.test(d.primary ?? "")).toBe(false);
    await page.waitForTimeout(500);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-after-pass.png` });
});
