import { expect, test, type Page } from "@playwright/test";

/**
 * The play hook (`src/battle-table/play.ts`): `__battlePlay` lets Claude play the 3D table through the page. `look()`
 * tells the table in words with numbered moves, `play(n)` presses the same button or card a click would and waits for
 * the table to settle. This plays a first round with it: keep the hand, play a card and pay for it, end the turn, and
 * answer the villain phase's questions until the next hero phase.
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
const wait = (page: Page) => page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.wait());

test("Claude's play hook reads the table in words and plays a whole round through it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/battle/?seed=7");
  await expect.poll(() => hook(page), { timeout: 60_000 }).toBe(true);
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?", { timeout: 60_000 });

  const opening = await wait(page);
  expect(opening).toContain("Round 1");
  expect(opening).toMatch(/Rhino \(\d+ HP\): SCH \d ATK \d/);
  expect(opening).toContain("Turn bar: Mulligan: Keep your hand?");
  expect(await moves(page)).toContain("Keep hand");

  const kept = await play(page, "Keep hand");
  expect(kept).toContain("Hand kept");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i);
  expect(await moves(page)).toContain("End Turn");

  // Play the first card the table says can be played, and pay for it with whatever it offers first.
  const card = (await moves(page)).find((m) => m.startsWith("Play "));
  if (card) {
    await play(page, card);
    for (let i = 0; i < 8 && (await moves(page)).some((m) => m.startsWith("Pay with ")); i++) {
      const paid = await moves(page);
      if (paid.includes("Play") || paid.includes("Use")) break;
      await play(
        page,
        paid.find((m) => m.startsWith("Pay with "))!,
      );
    }
    const ready = await moves(page);
    if (ready.includes("Play")) await play(page, "Play");
    else if (ready.includes("Cancel")) await play(page, "Cancel");
  }
  // A card that asks for a target: the first one.
  for (let i = 0; i < 4; i++) {
    const now = await moves(page);
    if (now.includes("End Turn")) break;
    await play(page, 1);
  }
  expect(await moves(page)).toContain("End Turn");

  // End the turn, then answer the villain phase passively until the next hero phase comes round.
  await play(page, "End Turn");
  for (let i = 0; i < 30; i++) {
    const text = await look(page);
    if (/Round 2, your turn/.test(text)) break;
    if (/GAME OVER/.test(text)) break;
    const now = await moves(page);
    if (!now.length) {
      await wait(page);
      continue;
    }
    const pick =
      now.find((m) => /^(Pass|Don.t defend|Skip|Keep hand|Continue)/.test(m)) ??
      now.find((m) => /^Discard \d/.test(m)) ??
      now.find((m) => m.startsWith("Pick ")) ??
      now[0]!;
    await play(page, pick);
  }
  const after = await look(page);
  expect(after).toContain("Round 2, your turn");
  await expect(page.locator("#round-label")).toHaveText("Round 2");
});
