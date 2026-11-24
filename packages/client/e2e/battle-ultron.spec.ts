import { expect, test, type Page } from "@playwright/test";

/**
 * Ultron on the 3D table (table 0.2.0): the campaign shelf's Ultron box deals Ultron, a Drone (a player's card put into
 * play facedown, Ultron Drones 01140) shows only as "Drone" until it is defeated and turns up in the discard pile,
 * Countdown to Oblivion's threat wears a lock (01139 "Threat cannot be removed from this scheme"), and Ultron (I)'s
 * Forced Response (01134) offers the top card of the deck as a Drone. Played through the play hook
 * (`src/battle-table/play.ts`), as Claude plays.
 */

interface PlayHook {
  look(): string;
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
  wait(): Promise<string>;
}

const hook = (page: Page) => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay);
const look = (page: Page) => page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.look());
const moves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.moves().map((m) => m.label));
const play = (page: Page, move: number | string) =>
  page.evaluate((m) => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.play(m), move);

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect.poll(() => hook(page), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await moves(page)).length, { timeout: 60_000 }).toBeGreaterThan(0);
}

const count = async (page: Page, id: string) => Number(await page.locator(`#${id}`).textContent());
const droneLines = (text: string) => text.match(/^- Drone \(minion/gm)?.length ?? 0;

test("the shelf's Ultron box deals Ultron, with the Drones environment and setup's Drone", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("ultron-spec")) {
      localStorage.removeItem("battle-villain");
      sessionStorage.setItem("ultron-spec", "1");
    }
  });
  await open(page, "/battle/?seed=7&open=ultron&play");
  await expect(page.locator("#shelf")).toBeHidden({ timeout: 60_000 });
  await expect(page).toHaveTitle(/Spider-Man vs\. Ultron/);
  await expect.poll(() => look(page), { timeout: 30_000 }).toContain("Ultron (17 HP)");
  const table = await look(page);
  expect(table).toContain("Ultron Drones (environment");
  expect(table).toContain("Drone (minion");
  // Setup's own moves are in the log: the Drone came off the top of the deck.
  await expect(page.locator("#dock-feed")).toContainText("facedown as a Drone minion");
});

test("a defeated Drone turns over and its card goes to the discard pile", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "/battle/?scene=ultrondrones&seed=7");
  await expect.poll(() => count(page, "discard-count")).toBe(0);
  const before = await look(page);
  expect(droneLines(before)).toBe(4);
  await play(page, "Spider-Man: Attack");
  const target = (await moves(page)).find((m) => m.startsWith("Choose Drone"));
  expect(target, (await moves(page)).join("\n")).toBeDefined();
  const after = await play(page, target!);
  expect(after).toContain("Drone defeated: it was ");
  await expect.poll(() => count(page, "discard-count")).toBe(1);
  expect(droneLines(await look(page))).toBe(3);
});

test("Countdown to Oblivion's threat pill wears the lock, and only its pill", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "/battle/?scene=ultroncountdown&seed=7");
  const locked = page.locator(".scheme-threat[data-locked]");
  await expect(locked).toHaveCount(1);
  await expect(locked).toHaveAttribute("title", "Threat cannot be removed from this scheme");
  await expect(page.locator(".scheme-threat")).toHaveCount(2);
});

test("after Ultron attacks, the top card of the deck can become a Drone", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "/battle/?scene=ultronattack&seed=7");
  const wanted = "Choose Put the top card of your deck into play as a Drone minion";
  await play(page, "End Turn");
  for (let i = 0; i < 40; i++) {
    const now = await moves(page);
    if (now.includes(wanted)) break;
    expect(now, "the hero's turn came back before Ultron asked").not.toContain("End Turn");
    const pick =
      now.find((m) => /^Discard \d/.test(m)) ??
      now.find((m) => m.startsWith("Pick ")) ??
      now.find((m) => m.startsWith("Continue")) ??
      now.find((m) => m.startsWith("Confirm")) ??
      now.find((m) => m === "Pass" || m === "Don’t defend") ??
      now[0];
    if (!pick) {
      await page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.wait());
      continue;
    }
    await play(page, pick);
  }
  expect(await moves(page)).toContain(wanted);
  const deck = await count(page, "deck-count");
  expect(droneLines(await look(page))).toBe(1);
  const said = await play(page, wanted);
  expect(said).toContain("The top card of your deck goes into play facedown as a Drone minion");
  await expect.poll(() => count(page, "deck-count")).toBe(deck - 1);
  expect(droneLines(await look(page))).toBe(2);
});
