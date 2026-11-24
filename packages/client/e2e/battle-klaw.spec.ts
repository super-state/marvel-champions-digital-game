import { expect, test, type Page } from "@playwright/test";

/**
 * Klaw on the 3D table (table 0.1.0): the game menu picks Rhino or Klaw for the next game, Klaw's main scheme turns
 * over to its second stage on a beat of its own, and Sonic Converter's "spend [energy][mental][physical] → discard
 * this card" is a move like any other. Played through the play hook (`src/battle-table/play.ts`), as Claude plays.
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

/** Answer the villain phase's questions the plain way (keep the hand, pass, don't defend) until the hero's turn. */
async function throughVillainPhase(page: Page): Promise<string> {
  let said = "";
  for (let i = 0; i < 40; i++) {
    const now = await moves(page);
    if (now.includes("End Turn")) return said;
    const pick =
      now.find((m) => /^Discard \d/.test(m)) ??
      now.find((m) => m === "Keep hand") ??
      now.find((m) => m.startsWith("Pick ")) ??
      now.find((m) => m.startsWith("Continue")) ??
      now.find((m) => m.startsWith("Confirm")) ??
      now.find((m) => m === "Pass" || m === "Don’t defend") ??
      now[0];
    if (!pick) throw new Error("No move to make");
    said += await play(page, pick);
  }
  throw new Error(`The hero's turn never came back:\n${await look(page)}`);
}

test("the game menu picks Rhino or Klaw for the next game, and remembers it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("klaw-spec")) {
      localStorage.removeItem("battle-villain");
      sessionStorage.setItem("klaw-spec", "1");
    }
  });
  await open(page, "/battle/?seed=7");
  // Rhino by default.
  await expect(page).toHaveTitle(/Spider-Man vs\. Rhino/);
  expect(await look(page)).toMatch(/Rhino \(\d+ HP\)/);

  await page.locator("#menu-button").click();
  await expect(page.locator("#reset")).toHaveText("New game vs. Rhino");
  await page.locator('[data-villain="klaw"]').click();
  await expect(page.locator('[data-villain="klaw"]')).toHaveAttribute("aria-pressed", "true");
  // New game says who it deals, and is the one gold button while that isn't the villain on the table.
  await expect(page.locator("#reset")).toHaveText("New game vs. Klaw");
  await expect(page.locator("#reset")).toHaveClass(/btn-primary/);
  await expect(page.locator("#menu-resume")).toHaveClass(/btn-secondary/);
  await expect(page.locator("#reset")).toBeEnabled({ timeout: 15_000 });
  await page.locator("#reset").click();

  await expect(page).toHaveTitle(/Spider-Man vs\. Klaw/);
  await expect.poll(() => look(page), { timeout: 30_000 }).toMatch(/Klaw \(12 HP\)/);
  const klaw = await look(page);
  expect(klaw).toContain("Underground Distribution (main scheme");
  expect(klaw).toContain("Defense Network (side scheme");
  expect(klaw).not.toContain("Rhino");

  // A reload deals Klaw again: the choice is remembered on this device.
  await page.reload();
  await expect.poll(() => hook(page), { timeout: 60_000 }).toBe(true);
  await expect(page).toHaveTitle(/Spider-Man vs\. Klaw/);

  // And back to Rhino, from the same menu.
  await page.locator("#menu-button").click();
  await page.locator('[data-villain="rhino"]').click();
  await expect(page.locator("#reset")).toHaveText("New game vs. Rhino");
  await expect(page.locator("#reset")).toBeEnabled({ timeout: 15_000 });
  await page.locator("#reset").click();
  await expect(page).toHaveTitle(/Spider-Man vs\. Rhino/);
  await expect.poll(() => look(page), { timeout: 30_000 }).toMatch(/Rhino \(\d+ HP\)/);
});

test("Underground Distribution turns over to Secret Rendezvous and brings in a minion", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "/battle/?seed=7&scene=klawadvance");
  expect(await look(page)).toContain("Underground Distribution (main scheme, threat 5/6)");
  // Every reply's "What happened" lines, in order: the table's own log keeps only the latest few.
  const feed = (await play(page, "End Turn")) + (await throughVillainPhase(page));
  expect(feed).toContain("Underground Distribution gains 1 threat");
  expect(feed).toContain("Underground Distribution is completed: the main scheme advances to Secret Rendezvous");
  expect(feed).toMatch(/enters play/);
  const after = await look(page);
  expect(after).toMatch(/Secret Rendezvous \(main scheme, threat \d+\/8\)/);
  // The round in the corner is the new one only once its hero phase has come.
  await expect(page.locator("#round-label")).toHaveText("Round 2");
});

test("Sonic Converter can be paid off Klaw with energy, mental and physical", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, "/battle/?seed=7&scene=klawgear");
  const action = "Sonic Converter: Discard it: spend energy, mental, physical";
  expect(await moves(page)).toContain(action);
  expect(await look(page)).toMatch(/Klaw \(12 HP, \+1 ATK\)/);
  await play(page, action);
  for (const card of ["Energy", "Genius", "Strength"]) {
    const pay = (await moves(page)).find((m) => m.startsWith(`Pay with ${card} `));
    expect(pay, `pay with ${card}`).toBeDefined();
    await play(page, pay!);
  }
  await play(page, "Use");
  const after = await look(page);
  expect(after).not.toContain("Sonic Converter (attachment");
  expect(after).toContain("Solid-Sound Body (attachment");
  expect(after).toMatch(/Klaw \(12 HP\): SCH 2 ATK 0/);
});
