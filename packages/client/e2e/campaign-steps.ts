import { expect, type Page } from "./battle-test";

const room = (page: Page) => page.locator("#shelf");

/** Waits for the camera to have arrived at a place in the room. */
export async function arrivedAt(page: Page, place: string): Promise<void> {
  await expect(room(page)).toHaveAttribute("data-place", place, { timeout: 30_000 });
  await expect(room(page)).not.toHaveAttribute("data-moving", "", { timeout: 30_000 });
}

/**
 * Campaign's first two steps, from the keyboard: on the scenario shelf (`room/places/scenario-shelf.ts`), the Core Set's
 * box up close and one of its scenarios; then at the hero shelf, asked for a hero, a hero's box up close and Play as
 * (`hero` by its id, else the hero already chosen), which takes the camera to the table where the scenario's villain
 * box opens. Starts from the scenario shelf, or with the Core Set already up close.
 */
export async function pickCoreScenario(page: Page, villain: "Rhino" | "Klaw" | "Ultron", hero?: string): Promise<void> {
  // The room may still be building the shelf (New game opens it afresh): its buttons answer once the camera is there.
  await arrivedAt(page, "campaign");
  // The Core Set's box up close already (Back from the heroes leaves it so): its card is open, the shelf behind out of
  // reach. Otherwise, its box from the shelf.
  if (!(await room(page).locator(".scn-card").isVisible())) {
    await room(page).locator('[data-scn="box:core"]').focus();
    await page.keyboard.press("Enter");
  }
  const scenario = room(page).locator(`[data-scn="scenario:${villain.toLowerCase()}"]`);
  await expect(scenario).toBeVisible({ timeout: 30_000 });
  await scenario.focus();
  await page.keyboard.press("Enter");
  await pickHeroForCampaign(page, villain, hero);
}

/** At the hero shelf, asked for a hero for `villain`: a hero's box up close, then Play as. */
export async function pickHeroForCampaign(page: Page, villain: string, hero?: string): Promise<void> {
  await arrivedAt(page, "decks");
  const bench = room(page).locator('[data-for="decks"]');
  await expect(bench.locator(".room-place-head h2")).toHaveText("Pick your hero");
  await expect(bench.locator(".room-place-head .eyebrow")).toHaveText(`Campaign · ${villain}`);
  const box = hero
    ? bench.locator(`[data-bench="hero:${hero}"]`)
    : bench.locator('.bench-hero[data-bench^="hero:"][aria-pressed="true"]');
  await box.focus();
  await page.keyboard.press("Enter");
  const play = bench.locator('[data-bench="choose"]');
  await expect(play).toBeVisible({ timeout: 30_000 });
  await play.focus();
  await page.keyboard.press("Enter");
  await arrivedAt(page, "campaign");
}
