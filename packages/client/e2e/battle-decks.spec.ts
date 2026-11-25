import { expect, test, type Page } from "@playwright/test";
import { frames, installPad, PAD, setButton } from "./pad-e2e-helpers.js";

/**
 * The deck builder (`battle/decks.html`, dev server only; room plan step 0.9.0): a legal deck built by mouse and by
 * keyboard, an illegal one explained in the engine's words, a deck saved and opened again, and a short pass on a pad.
 * Saved decks live in this browser's storage, which each test starts without.
 */

const legality = (page: Page) => page.locator("#legality");
const total = (page: Page) => page.locator("#tray-total");

async function pictureCheck(page: Page): Promise<void> {
  // Every card scan on the page loads (no broken picture falls back to the card back).
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLImageElement>(".binder-card-art")].every(
            (img) => img.complete && img.naturalWidth > 0 && !img.src.endsWith("marvel-player-back.webp"),
          ),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/**
 * Clicks every card on the open binder page up to `times` times, while the engine still lets a copy in (a card that
 * can't take one more is `aria-disabled`, which Playwright won't click).
 */
async function clickEveryCard(page: Page, times: number): Promise<void> {
  const cards = page.locator(".binder-card");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < times; t++) {
      if ((await cards.nth(i).getAttribute("aria-disabled")) === "true") break;
      await cards.nth(i).click();
    }
  }
}

/** Presses Enter `times` times on each card of the open binder page, stepping on with Tab, from the first card. */
async function enterEveryCard(page: Page, times: number): Promise<void> {
  const count = await page.locator(".binder-card").count();
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < times; t++) await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
  }
}

test("build a legal deck by mouse, save it, and open it again", async ({ page }) => {
  await page.goto("/battle/decks.html");
  // No card panel until something asks for one; hovering a hero's box shows their card full size.
  await expect(page.locator("#card-panel")).toBeHidden();
  await page.getByRole("button", { name: /She-Hulk/ }).hover();
  await expect(page.locator("#card-panel")).toBeVisible();
  await expect(page.locator("#card-panel-img")).toHaveAttribute("src", /01019a\.png$/);
  await page.getByRole("button", { name: /Spider-Man/ }).click();
  await page.getByRole("button", { name: /New deck/ }).click();
  await expect(total(page)).toHaveText("15 cards (40 to 50)");
  await expect(legality(page)).toContainText("The deck has 15 cards; a deck must have between 40 and 50");

  await page.getByRole("tab", { name: "Aspect" }).click();
  await page.getByRole("radio", { name: "Aggression" }).click();
  await expect(page.getByRole("tab", { name: "Aggression" })).toHaveAttribute("aria-selected", "true");
  await pictureCheck(page);
  await clickEveryCard(page, 2);
  await page.getByRole("tab", { name: "Basic" }).click();
  await clickEveryCard(page, 2);
  await expect(legality(page)).toHaveText(/Legal deck: 4\d cards\./);
  const built = await total(page).textContent();

  // A click on a tray line takes a copy out; a click in the binder puts it back.
  const line = page.locator(".tray-line:not([data-fixed])").first();
  const cardId = await line.getAttribute("data-deck-card");
  const copies = page.locator(`.tray-line[data-deck-card="${cardId}"] .tray-qty`);
  const before = Number((await copies.textContent())!.replace("×", ""));
  await line.click();
  await expect(total(page)).not.toHaveText(built!);
  if (before > 1) await expect(copies).toHaveText(`${before - 1}×`);
  else await expect(copies).toHaveCount(0);

  await page.getByLabel("Deck name").fill("Spidey Smash");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#builder-notice")).toHaveText(/Saved as “Spidey Smash”/);

  await page.reload();
  await page.getByRole("button", { name: /Spider-Man/ }).click();
  await expect(page.getByRole("button", { name: /Spidey Smash/ })).toContainText("Aggression");
  await page.getByRole("button", { name: /Spidey Smash/ }).click();
  await expect(page.getByLabel("Deck name")).toHaveValue("Spidey Smash");
  await expect(page.getByRole("tab", { name: "Aggression" })).toBeVisible();
  const reopened = Number((await total(page).textContent())!.split(" ")[0]);
  expect(reopened).toBe(Number(built!.split(" ")[0]) - 1);
});

test("build a legal deck by keyboard alone", async ({ page }) => {
  await page.goto("/battle/decks.html");
  // The heroes: arrows move along the boxes, Enter opens one, Enter on New deck.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(":focus")).toContainText("She-Hulk");
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toContainText("Starter deck");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(":focus")).toContainText("New deck");
  await page.keyboard.press("Enter");
  await expect(total(page)).toHaveText("15 cards (40 to 50)");

  // [ turns back a page to the aspects; up to the aspect choices, along to Protection, Enter chooses it.
  await page.keyboard.press("BracketLeft");
  await expect(page.getByRole("tab", { name: "Aspect" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(":focus")).toHaveText("Aggression");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator(":focus")).toHaveText("Protection");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "Protection" })).toHaveAttribute("aria-checked", "true");
  // Protection is the last choice, so Tab steps on to the binder's first card.
  await page.keyboard.press("Tab");
  const firstCard = await page.locator(".binder-card").first().getAttribute("data-deck-card");
  await expect(page.locator(":focus")).toHaveAttribute("data-deck-card", firstCard!);
  await enterEveryCard(page, 2);

  // Page Down to Basic, and two of each.
  await page.keyboard.press("PageDown");
  await expect(page.getByRole("tab", { name: "Basic" })).toHaveAttribute("aria-selected", "true");
  const firstBasic = await page.locator(".binder-card").first().getAttribute("data-deck-card");
  await expect(page.locator(":focus")).toHaveAttribute("data-deck-card", firstBasic!);
  await enterEveryCard(page, 2);
  await expect(legality(page)).toHaveText(/Legal deck: 4\d cards\./);

  // Delete takes the focused card's copy out again.
  await page.locator(".binder-card[data-full]").first().focus();
  const before = await total(page).textContent();
  await page.keyboard.press("Delete");
  await expect(total(page)).not.toHaveText(before!);

  // Full size from a card with two of three copies: adding the third greys out Add, and the focus moves on to Take
  // one out rather than being lost.
  const two = page.locator(".binder-card", { has: page.locator(".binder-count", { hasText: /^2\/3$/ }) }).first();
  await two.focus();
  await page.keyboard.press("f");
  await expect(page.locator(":focus")).toHaveId("zoom-add");
  await page.keyboard.press("+");
  await expect(page.locator("#zoom-add")).toBeDisabled();
  await expect(page.locator(":focus")).toHaveId("zoom-remove");
  await page.keyboard.press("Escape");
  await expect(page.locator("#zoom")).not.toHaveAttribute("open", "");

  // F shows the focused card full size; Escape closes it. (The focus is back on a card once the last one closed.)
  await expect(page.locator(":focus")).toHaveClass(/binder-card/);
  await page.keyboard.press("f");
  await expect(page.locator("#zoom")).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(page.locator("#zoom")).not.toHaveAttribute("open", "");
});

test("an illegal deck says, in the engine's words, the one thing to fix first", async ({ page }) => {
  await page.goto("/battle/decks.html?hero=01001a&deck=starter");
  await expect(legality(page)).toHaveText("✓Legal deck: 40 cards.");
  await expect(legality(page)).toHaveAttribute("data-legal", "true");

  // Changing the aspect takes out the old aspect's cards, says so, and leaves the deck short.
  await page.getByRole("tab", { name: "Justice" }).click();
  await page.getByRole("radio", { name: "Aggression" }).click();
  await expect(page.locator("#builder-notice")).toHaveText(/Aggression chosen: took out \d+ cards of the old aspect\./);
  await expect(legality(page)).toHaveAttribute("data-legal", "false");
  await expect(legality(page)).toContainText(/The deck has \d+ cards; a deck must have between 40 and 50/);

  // The hero's own cards are fixed: shown, never taken out.
  await page.getByRole("tab", { name: "Spider-Man's cards" }).click();
  const own = page.locator(".binder-card").first();
  await expect(own).toHaveAttribute("data-fixed", "");
  const count = await total(page).textContent();
  // A player can still click it (it only looks fixed), so the click is forced past Playwright's aria-disabled check.
  await own.click({ force: true });
  await expect(page.locator("#builder-notice")).toHaveText("The hero's own cards are fixed.");
  await expect(total(page)).toHaveText(count!);

  // An illegal deck saves all the same, and the deck choice says it is not legal yet.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#builder-notice")).toHaveText(/\(not legal yet\)/);
  await page.getByRole("button", { name: /Heroes/ }).click();
  await expect(page.locator(".deck-option", { hasText: "not legal yet" })).toBeVisible();
});

test("a controller: D-pad through the binder, A adds, X takes out, Y full size, LB / RB change tab", async ({
  page,
}) => {
  await installPad(page);
  await page.goto("/battle/decks.html?hero=01001a&deck=new");
  await expect(page.getByRole("tab", { name: "Basic" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(":focus")).toHaveClass(/binder-card/);

  const press = async (button: number): Promise<void> => {
    await setButton(page, button, true);
    await page.waitForFunction((i) => navigator.getGamepads()[0]?.buttons[i]?.pressed === true, button);
    await frames(page, 2);
    await setButton(page, button, false);
    await frames(page, 3);
  };

  // A mouse click first: the pad must still show where its focus is afterwards.
  await page.locator("#binder-help").click();
  await page.locator(".binder-card").first().focus();
  const first = await page.locator(":focus").getAttribute("data-deck-card");
  await press(PAD.right);
  await expect(page.locator(":focus")).not.toHaveAttribute("data-deck-card", first!);
  const ring = await page.locator(":focus").evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(ring).not.toBe("none");
  await press(PAD.a);
  await expect(total(page)).toHaveText("16 cards (40 to 50)");
  await press(PAD.x);
  await expect(total(page)).toHaveText("15 cards (40 to 50)");
  await press(PAD.y);
  await expect(page.locator("#zoom")).toHaveAttribute("open", "");
  await press(PAD.b);
  await expect(page.locator("#zoom")).not.toHaveAttribute("open", "");
  await press(PAD.lb);
  await expect(page.getByRole("tab", { name: "Aspect" })).toHaveAttribute("aria-selected", "true");
  await press(PAD.rb);
  await expect(page.getByRole("tab", { name: "Basic" })).toHaveAttribute("aria-selected", "true");
});

test("save, rename, duplicate and delete a deck", async ({ page }) => {
  await page.goto("/battle/decks.html?hero=01001a&deck=starter");
  const name = page.getByLabel("Deck name");
  const notice = page.locator("#builder-notice");
  // Duplicate copies a saved deck, so it waits for the first save.
  await expect(page.getByRole("button", { name: "Duplicate" })).toBeDisabled();
  await name.fill("Webs");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notice).toHaveText("Saved as “Webs”.");
  await expect(page.getByRole("button", { name: "Duplicate" })).toBeEnabled();

  // Rename: a new name and Save keeps the one deck, under the new name.
  await name.fill("Webs Deluxe");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notice).toHaveText("Renamed and saved as “Webs Deluxe”.");

  // Duplicate: a second deck, and the builder now edits the copy.
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(notice).toHaveText(/Saved a copy as “Webs Deluxe copy”/);
  await expect(name).toHaveValue("Webs Deluxe copy");

  const options = page.locator(".deck-option");
  await page.getByRole("button", { name: /Heroes/ }).click();
  await expect(options).toHaveText([/Starter deck/, /Webs Deluxe copy/, /Webs Deluxe/, /New deck/]);

  // Delete asks first; Cancel keeps it, Delete removes it.
  await options.filter({ hasText: "Webs Deluxe copy" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("#confirm")).toHaveAttribute("open", "");
  await expect(page.locator("#confirm-text")).toHaveText("Delete “Webs Deluxe copy”? This can't be undone.");
  await page.locator("#confirm-no").click();
  await expect(name).toHaveValue("Webs Deluxe copy");
  await page.getByRole("button", { name: "Delete" }).click();
  await page.locator("#confirm-yes").click();
  await expect(options).toHaveText([/Starter deck/, /Webs Deluxe/, /New deck/]);

  // Unsaved changes ask before leaving.
  await options.filter({ hasText: "Webs Deluxe" }).click();
  await page.getByRole("tab", { name: "Basic" }).click();
  await page.locator('.binder-card[aria-disabled="false"]').first().click();
  await page.getByRole("button", { name: /Heroes/ }).click();
  await expect(page.locator("#confirm-text")).toHaveText("Leave without saving your changes?");
  await page.locator("#confirm-yes").click();
  await expect(options).toHaveText([/Starter deck/, /Webs Deluxe40 cards/, /New deck/]);
});

test.describe("at phone width", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("a card opens full size from its magnifier, with add and take out", async ({ page }) => {
    await page.goto("/battle/decks.html?hero=01001a&deck=new");
    await page.locator(".zoom-btn").first().tap();
    await expect(page.locator("#zoom")).toHaveAttribute("open", "");
    await page.locator("#zoom-add").tap();
    await expect(page.locator("#zoom-count")).toHaveText("1 in the deck.");
    await expect(total(page)).toHaveText("16 cards (40 to 50)");
    await page.locator("#zoom-remove").tap();
    await expect(total(page)).toHaveText("15 cards (40 to 50)");
    await page.locator("#zoom-close").tap();
    await expect(page.locator("#zoom")).not.toHaveAttribute("open", "");
  });

  test("a swipe through the binder that ends over a card or its magnifier presses nothing", async ({ page }) => {
    await page.goto("/battle/decks.html?hero=01001a&deck=new");
    const scroller = page.locator("#binder-cards");
    await expect(page.locator(".binder-card")).toHaveCount(11);
    const zoom = (await page.locator(".zoom-btn").nth(1).boundingBox())!;
    const card = (await page.locator(".binder-card").nth(7).boundingBox())!;
    // From a card low in the binder, up to where the second card's magnifier sits, and lift there.
    const from = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
    const to = { x: zoom.x + zoom.width / 2, y: zoom.y + zoom.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 1 }] });
    for (let i = 1; i <= 12; i++) {
      const at = { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...at, id: 1 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await frames(page, 6);
    await expect(total(page)).toHaveText("15 cards (40 to 50)");
    await expect(page.locator("#zoom")).not.toHaveAttribute("open", "");
  });
});
