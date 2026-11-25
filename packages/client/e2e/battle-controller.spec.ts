import { expect, test, type Page } from "./battle-test";
import { frames, installPad, PAD, padHold, padRelease, padTap, setButton } from "./pad-e2e-helpers.js";

/**
 * Controller mode on the 3D battle table (`src/battle-table/controller.ts`): the fight played on a pad alone, with
 * the fake Xbox pad the classic board's specs use. Seed 7 deals the same hand every time.
 */

const L3 = 10;

/**
 * One step on the D-pad: let go two frames after the page has seen it. `padTap` holds a button for eight frames, and
 * the table draws slowly enough headless that a held direction would start repeating (after 400 ms) and step twice.
 */
async function nudge(page: Page, index: number): Promise<void> {
  await setButton(page, index, true);
  await page.waitForFunction((i) => navigator.getGamepads()[0]?.buttons[i]?.pressed === true, index);
  await frames(page, 2);
  await setButton(page, index, false);
  await page.waitForFunction((i) => navigator.getGamepads()[0]?.buttons[i]?.pressed === false, index);
  await frames(page, 3);
}

async function openTable(page: Page): Promise<void> {
  await installPad(page);
  await page.goto("/battle/?seed=7");
  // Generous: the table's first draw loads every scan on the mat, slowly on a busy machine.
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?", { timeout: 60_000 });
  // The mulligan question waits for the dealt cards to land in the hand.
  await expect(page.locator("#dock")).not.toHaveAttribute("data-waiting", "", { timeout: 15_000 });
}

/** What the focus is on: an element's id, else its accessible name. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.id || active?.getAttribute("aria-label") || active?.textContent?.trim() || active?.tagName || "";
  });
}

const padMode = (page: Page) => page.evaluate(() => document.documentElement.dataset.input ?? null);

/**
 * Keep the opening hand with the pad: the first press shows the focus on Keep hand, A keeps it, and once the table has
 * settled into the hero phase the focus comes back to a card in the hand (never to End Turn).
 */
async function keepHand(page: Page): Promise<void> {
  await nudge(page, PAD.down);
  await expect.poll(() => padMode(page)).toBe("pad");
  await expect.poll(() => focused(page)).toBe("dock-primary");
  // A again only while the question is still up: on a slow headless page the first press can land inside the bar's
  // double-press guard and be ignored, as a person's too-quick press would be.
  for (let i = 0; i < 6; i++) {
    if ((await page.locator("#dock-title").textContent())?.trim() !== "Keep your hand?") break;
    await padTap(page, PAD.a);
    await page
      .locator("#dock-title")
      .filter({ hasNotText: "Keep your hand?" })
      .waitFor({ timeout: 3000 })
      .catch(() => {});
  }
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 15_000 });
  await expect(page.locator("#dock")).toHaveAttribute("data-idle", "");
  await expect.poll(() => focused(page), { timeout: 15_000 }).toMatch(/^(Play|Inspect) /);
}

/** Step the focus one way until it is on a control whose name matches, or fail after `max` steps. */
async function stepTo(page: Page, direction: number, name: RegExp, max = 8): Promise<void> {
  for (let i = 0; i < max && !name.test(await focused(page)); i++) await nudge(page, direction);
  expect(await focused(page)).toMatch(name);
}

test.describe("battle table: controller mode", () => {
  test("on a phone, Keep hand turning into End Turn under the focus doesn't let A straight after it end the turn", async ({
    page,
  }) => {
    // The phone's turn bar never folds away: once the hand is kept its gold button says End Turn, under the focus.
    await page.setViewportSize({ width: 390, height: 844 });
    await openTable(page);
    await nudge(page, PAD.down);
    await expect.poll(() => focused(page)).toBe("dock-primary");
    await padTap(page, PAD.a);
    await expect(page.locator("#dock-primary")).toHaveAttribute("data-end-turn", "");
    await padTap(page, PAD.a);
    await padTap(page, PAD.a);
    await frames(page, 20);
    await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i);
    await expect(page.locator("#round-label")).toHaveText("Round 1");
    // The short strip under the table names only what answers.
    await expect(page.locator(".pad-legend")).toBeVisible();
    await expect(page.locator(".pad-legend [data-extra]").first()).toBeHidden();
  });

  test("nothing changes until a pad is used; the first press shows the focus and the button hints", async ({
    page,
  }) => {
    await openTable(page);
    expect(await padMode(page)).toBeNull();
    await expect(page.locator(".pad-legend")).toBeHidden();
    await nudge(page, PAD.down);
    await expect.poll(() => padMode(page)).toBe("pad");
    await expect(page.locator(".pad-legend")).toBeVisible();
    await expect(page.locator(".pad-legend")).toContainText("Select");
    await expect(page.locator(".pad-legend")).toContainText("Keep hand");
    await expect(page.locator(".pad-toast")).toHaveText("Xbox controller connected");
    // The bar's gold button wears Start's picture while it is the button that moves the game on.
    await expect(page.locator(".pad-badge").first()).toBeVisible();
  });

  test("after Keep hand the focus goes to the hand, so a second A never ends the turn", async ({ page }) => {
    await openTable(page);
    await keepHand(page);
    await expect(page.locator("#pad-ring")).toBeVisible();
    await expect(page.locator("#pad-chip")).toContainText(/Play|Why not\?/);
    // Mashing A again plays (or explains) the focused card: the turn is still the hero's.
    await padTap(page, PAD.a);
    await frames(page, 30);
    await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i);
  });

  test("a card is played and paid for with the pad alone", async ({ page }) => {
    await openTable(page);
    await keepHand(page);
    const handBefore = await page.locator("#anchors > .anchor.in-hand").count();
    await expect.poll(() => focused(page)).toMatch(/^Play /);
    const played = (await focused(page)).replace(/^Play /, "").replace(/, cost \d+$/, "");
    await padTap(page, PAD.a);
    // Paying: the focus starts on something to spend; the player spends it, steps on to the next and spends that,
    // and Start presses Play once enough is spent.
    await expect(page.locator("#dock-title")).toHaveText(/^Pay |Play it\?/);
    await expect.poll(() => focused(page)).toMatch(/^Spend /);
    for (let i = 0; i < 6 && !(await page.locator("#dock-primary:enabled").count()); i++) {
      await stepTo(page, PAD.right, /^Spend /);
      await padTap(page, PAD.a);
      await expect.poll(() => focused(page)).toMatch(/^Remove /);
    }
    await padTap(page, PAD.start);
    await expect(page.locator("#dock-feed")).toContainText(played, { timeout: 15_000 });
    await expect.poll(() => page.locator("#anchors > .anchor.in-hand").count()).toBeLessThan(handBefore);
    // The spent cards are in the discard pile now: L3 opens it (once they have landed there: like a click on the pile,
    // a press while cards are still flying does nothing), B puts it away.
    const pile = page.locator("#discard-label");
    await expect(pile).toBeEnabled();
    await expect
      .poll(
        async () => {
          await padTap(page, L3);
          return pile.getAttribute("aria-expanded");
        },
        { timeout: 20_000, intervals: [500] },
      )
      .toBe("true");
    await expect(page.locator("#dock-title")).toHaveText(/^Discard pile · \d+/);
    await padTap(page, PAD.b);
    await expect(pile).toHaveAttribute("aria-expanded", "false");
  });

  test("A twice on the hero opens and closes its actions, using none of them", async ({ page }) => {
    await openTable(page);
    await keepHand(page);
    await padTap(page, PAD.rb);
    await expect.poll(() => focused(page)).toMatch(/Peter Parker/);
    // As fast as the page reads it: down, up, down, up.
    for (let i = 0; i < 2; i++) {
      await setButton(page, PAD.a, true);
      await page.waitForFunction(() => navigator.getGamepads()[0]?.buttons[0]?.pressed === true);
      await frames(page, 2);
      await setButton(page, PAD.a, false);
      await page.waitForFunction(() => navigator.getGamepads()[0]?.buttons[0]?.pressed === false);
      await frames(page, 2);
    }
    await frames(page, 20);
    await expect(page.locator("#decision")).toBeHidden();
    // Peter Parker's first action is the change to Spider-Man: still Peter Parker, nothing used.
    expect(await focused(page)).toMatch(/Peter Parker/);
    await expect(page.locator("#dock-feed")).not.toContainText(/Spider-Man|Recover/);
  });

  test("the trigger combos do nothing behind the game menu", async ({ page }) => {
    await openTable(page);
    await keepHand(page);
    await padTap(page, PAD.start);
    await expect(page.locator("dialog#menu")).toHaveAttribute("open", "");
    // LT + B would turn Peter Parker into Spider-Man on the table.
    await padHold(page, PAD.lt);
    await padTap(page, PAD.b);
    await padRelease(page, PAD.lt);
    await padTap(page, PAD.b);
    await expect(page.locator("dialog#menu")).not.toHaveAttribute("open", "");
    await expect(page.locator(".anchor.identity")).toHaveAttribute("aria-label", /Peter Parker/);
  });

  test("A opens the hero's actions with the focus on the hero, a press steps in, and B puts them away; LT + RB ends the turn and Start answers the villain phase", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openTable(page);
    await keepHand(page);
    // RB from the hand jumps up to your side of the table, where the hero starts.
    await padTap(page, PAD.rb);
    await expect.poll(() => focused(page)).toMatch(/Peter Parker|Spider-Man/);
    await padTap(page, PAD.a);
    await expect(page.locator("#decision")).toBeVisible();
    // The A / Y hint would stand where the actions do, above the card: it steps aside while they are open.
    await expect(page.locator("#pad-chip")).toBeHidden();
    expect(await focused(page)).toMatch(/Peter Parker|Spider-Man/);
    await nudge(page, PAD.up);
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("menu-action"))).toBe(true);
    await padTap(page, PAD.b);
    await expect(page.locator("#decision")).toBeHidden();
    await expect.poll(() => focused(page)).toMatch(/Peter Parker|Spider-Man/);

    // Holding LT shows the hero's actions; RB under it ends the turn.
    await padHold(page, PAD.lt);
    await expect(page.locator(".pad-sheet")).toBeVisible();
    await expect(page.locator(".pad-sheet")).toContainText("End Turn");
    await padTap(page, PAD.rb);
    await padRelease(page, PAD.lt);
    await expect(page.locator(".pad-sheet")).toBeHidden();

    // Through the villain phase on Start (Continue, Defend or not) and A (any other question), back to the hero.
    await expect
      .poll(
        async () => {
          if (/Hero phase/i.test((await page.locator("#turn-status").textContent()) ?? "")) {
            const round = (await page.locator("#round-label").textContent()) ?? "";
            if (/Round 2/.test(round)) return "next round";
          }
          if (await page.locator("dialog#game-over[open]").count()) return "game over";
          const asking = await page.evaluate(() => document.getElementById("dock")?.hasAttribute("data-asking"));
          const reveal = await page.locator("#read-reveal:not([hidden])").count();
          if (reveal || asking) {
            const forward = await page.locator("#dock-primary:enabled:not([data-end-turn])").count();
            await padTap(page, reveal || forward ? PAD.start : PAD.a);
          }
          return "playing";
        },
        { timeout: 90_000, intervals: [400] },
      )
      .toMatch(/next round|game over/);
  });

  test("Start opens the menu when nothing waits on it, B closes it, and moving the mouse hands the table back", async ({
    page,
  }) => {
    await openTable(page);
    await keepHand(page);
    await padTap(page, PAD.start);
    await expect(page.locator("dialog#menu")).toHaveAttribute("open", "");
    await expect.poll(() => focused(page)).toBe("menu-resume");
    await padTap(page, PAD.b);
    await expect(page.locator("dialog#menu")).not.toHaveAttribute("open", "");
    await page.mouse.move(200, 200);
    await page.mouse.move(260, 240);
    await expect.poll(() => padMode(page)).toBeNull();
    await expect(page.locator(".pad-legend")).toBeHidden();
    await expect(page.locator("#pad-ring")).toBeHidden();
  });

  test("a button held through the guide button does nothing when the guide button is let go", async ({ page }) => {
    await openTable(page);
    await nudge(page, PAD.down);
    await expect.poll(() => focused(page)).toBe("dock-primary");
    const HOME_BUTTON = 16;
    await setButton(page, HOME_BUTTON, true);
    await frames(page, 6);
    await setButton(page, PAD.a, true);
    await frames(page, 6);
    await setButton(page, HOME_BUTTON, false);
    await frames(page, 6);
    await setButton(page, PAD.a, false);
    await frames(page, 6);
    await expect(page.locator("#dock-title")).toHaveText("Keep your hand?");
  });
});
