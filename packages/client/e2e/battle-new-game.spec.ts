import { expect, test, type Page } from "@playwright/test";

/**
 * A new game on the 3D battle table clears the whole table (`BattleTable.newGame`). Scene `advanceloss`: the main
 * scheme is two threat short and Advance (the villain schemes) is the next encounter card, so ending the turn loses
 * the game while Advance stands aside beside Rhino. Try again, or New game from the menu, must deal a table exactly
 * like a freshly opened one: no card from the lost game left behind.
 */

const SCENE = "/battle/?seed=11&scene=advanceloss";
const SHOTS = process.env.BATTLE_SHOTS;

interface DebugTable {
  anchors(): { id: string }[];
  parkedEncounters(): string[];
}

async function tableCards(page: Page) {
  return page.evaluate(() => {
    const table = (window as unknown as { battleTable?: DebugTable }).battleTable;
    return {
      cards: [...new Set(table?.anchors().map((a) => a.id) ?? [])].sort(),
      parked: table?.parkedEncounters() ?? [],
    };
  });
}

async function dock(page: Page) {
  return page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)?.textContent?.trim() ?? "";
    const usable = (id: string) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      return !!el && !el.disabled && !el.hidden && el.offsetParent !== null;
    };
    return {
      title: text("dock-title"),
      primary: usable("dock-primary") ? text("dock-primary") : null,
      secondary: usable("dock-secondary") ? text("dock-secondary") : null,
      waiting: document.getElementById("dock")?.hasAttribute("data-waiting") ?? false,
      over: (document.getElementById("game-over") as HTMLDialogElement | null)?.open ?? false,
    };
  });
}

/** One step along the villain phase: pass every question, keep the hand, discard down to size, read on. */
async function stepAlong(page: Page, d: Awaited<ReturnType<typeof dock>>) {
  if (d.waiting) return;
  // The revealed card's own Continue lies over the dock while it is being read.
  if (await page.locator("#read-reveal").isVisible()) await page.locator("#read-reveal").click();
  else if (/^Discard \d/.test(d.title) && !d.primary) {
    await page
      .locator('#anchors [aria-label^="Discard "]')
      .first()
      .evaluate((el) => (el as HTMLElement).click());
  } else if (/^Discard \d/.test(d.title) && d.primary) await page.locator("#dock-primary").click();
  else if (d.secondary && /^(Pass|Don.t defend|Skip)$/.test(d.secondary)) await page.locator("#dock-secondary").click();
  else if (d.primary && /^(Continue|Start|OK|Next|Keep hand)/i.test(d.primary))
    await page.locator("#dock-primary").click();
}

/** The cards on a freshly opened table, once they have all been dealt. */
async function freshTable(page: Page) {
  await page.goto(SCENE);
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  return (await tableCards(page)).cards;
}

/** End the turn and pass everything until the game is lost; returns the cards standing aside as it ends. */
async function loseTheGame(page: Page) {
  await page.locator("#end-turn").click();
  const log: string[] = [];
  for (let i = 0; i < 120; i++) {
    const d = await dock(page);
    log.push(JSON.stringify(d));
    if (d.over || d.title === "Defeat") return (await tableCards(page)).parked;
    await stepAlong(page, d);
    await page.waitForTimeout(500);
  }
  throw new Error(`never lost:\n${log.slice(-15).join("\n")}`);
}

async function expectFreshTable(page: Page, fresh: string[]) {
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect.poll(async () => (await tableCards(page)).parked, { timeout: 15_000 }).toEqual([]);
  await expect.poll(async () => (await tableCards(page)).cards, { timeout: 15_000 }).toEqual(fresh);
}

test("Try again after losing with Advance standing aside deals a clean table", async ({ page }) => {
  test.setTimeout(240_000);
  const fresh = await freshTable(page);
  const parked = await loseTheGame(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-lost.png` });
  // The scene's point: the game ends while Advance is still standing aside.
  expect(parked.length).toBeGreaterThan(0);
  await page.locator("#try-again").click();
  await expectFreshTable(page, fresh);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-try-again.png` });
});

/**
 * Scene `assault`: Assault comes up and Rhino attacks, so Assault stands aside while the player is asked whether to
 * defend. New game from the menu right then must take Assault away too.
 */
test("New game from the menu while a revealed card stands aside deals a clean table", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/battle/?seed=11&scene=assault");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const fresh = (await tableCards(page)).cards;
  await page.locator("#end-turn").click();
  const log: string[] = [];
  let asked = false;
  for (let i = 0; i < 120 && !asked; i++) {
    const d = await dock(page);
    log.push(JSON.stringify(d));
    if (!d.waiting && (await tableCards(page)).parked.length && d.secondary) asked = true;
    else {
      await stepAlong(page, d);
      await page.waitForTimeout(500);
    }
  }
  if (!asked) throw new Error(`Assault never stood aside for a question:\n${log.slice(-15).join("\n")}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-assault-aside.png` });
  await page.locator("#menu-button").click();
  await expect(page.locator("#reset")).toBeEnabled({ timeout: 15_000 });
  await page.locator("#reset").click();
  await expectFreshTable(page, fresh);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-new-game.png` });
});
