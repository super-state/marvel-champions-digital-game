import { expect, test, type Page } from "@playwright/test";

/**
 * Tidying the hand (a friend's ask, 2026-11-25, "like Magic Arena"): drag a hand card along the hand and let go low,
 * and it stays in the slot the hand opened for it. Let go low where it started, nothing changes and nothing is played.
 */

interface PlayHook {
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
}

const SHOTS = process.env.BATTLE_SHOTS;

const moves = (page: Page) =>
  page.evaluate(() => {
    const hook = (window as unknown as { __battlePlay?: PlayHook }).__battlePlay;
    return hook ? hook.moves().map((m) => m.label) : [];
  });

/** The hand cards left to right, as the table shows them: each one's middle on screen, and a height on it to press. */
const handOnScreen = (page: Page) =>
  page.evaluate(() => {
    const inHand = new Set(
      [...document.querySelectorAll<HTMLElement>("#anchors .anchor.in-hand")].map((label) => label.dataset.card!),
    );
    const table = (window as unknown as { battleTable: { anchors(): { id: string; x: number; top: number }[] } })
      .battleTable;
    const canvas = document.querySelector("#space canvas")!.getBoundingClientRect();
    return table
      .anchors()
      .filter((card) => inHand.has(card.id))
      .map((card) => ({ id: card.id, x: canvas.left + card.x, y: canvas.top + card.top }))
      .sort((a, b) => a.x - b.x);
  });

/** The hand once it has stopped moving: two reads a moment apart that agree. */
async function settledHand(page: Page) {
  let last = "";
  for (let i = 0; i < 40; i++) {
    const now = await handOnScreen(page);
    const key = now.map((card) => `${card.id}@${Math.round(card.x)}`).join(",");
    if (now.length && key === last) return now;
    last = key;
    await page.waitForTimeout(150);
  }
  throw new Error("The hand never settled");
}

/** Press on a hand card, slide it along the hand to x and let go there, low, over the hand. */
async function dragAlongHand(page: Page, fromX: number, toX: number, y: number, shot?: string) {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) await page.mouse.move(fromX + ((toX - fromX) * step) / 12, y);
  // Held over the new slot, the hand has opened a gap there.
  if (shot) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot });
  }
  await page.mouse.up();
}

for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`a hand card dragged along the hand stays in its new slot (${size})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.goto("/battle/?seed=7");
    await expect.poll(async () => (await moves(page)).includes("Keep hand"), { timeout: 60_000 }).toBe(true);
    await page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.play("Keep hand"));
    await expect.poll(async () => (await moves(page)).includes("End Turn"), { timeout: 60_000 }).toBe(true);
    const before = await settledHand(page);
    expect(before.length).toBeGreaterThanOrEqual(4);
    const movesBefore = await moves(page);
    // Low over the hand, a little way down from the top of its cards: below the line where a card let go is played.
    const y = Math.min(Math.max(...before.map((card) => card.y)) + 30, viewport.height - 6);

    // The first card, let go over the third card's slot.
    await dragAlongHand(page, before[0]!.x, before[2]!.x, y, SHOTS && `${SHOTS}/hand-reorder-${size}-held.png`);
    const ids = before.map((card) => card.id);
    const expected = [ids[1], ids[2], ids[0], ...ids.slice(3)];
    await expect.poll(async () => (await settledHand(page)).map((card) => card.id)).toEqual(expected);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hand-reorder-${size}.png` });

    // Nothing was played or spent: the same moves are on offer.
    expect((await moves(page)).sort()).toEqual([...movesBefore].sort());

    // Dragged out a slot and back, then let go where it started: the hand stays as it is.
    const after = await settledHand(page);
    await page.mouse.move(after[1]!.x, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++)
      await page.mouse.move(after[1]!.x + ((after[2]!.x - after[1]!.x) * step) / 8, y);
    for (let step = 7; step >= 0; step--)
      await page.mouse.move(after[1]!.x + ((after[2]!.x - after[1]!.x) * step) / 8, y);
    await page.mouse.up();
    await expect.poll(async () => (await settledHand(page)).map((card) => card.id)).toEqual(expected);
    expect((await moves(page)).sort()).toEqual([...movesBefore].sort());

    // Dragged up onto the table instead, a playable card is still played: the table asks how to pay for it.
    const playable = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>("#anchors .anchor.in-hand")].find((label) =>
          (label.getAttribute("aria-label") ?? "").startsWith("Play "),
        )?.dataset.card,
    );
    expect(playable).toBeTruthy();
    const card = (await settledHand(page)).find((item) => item.id === playable)!;
    await page.mouse.move(card.x, y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++)
      await page.mouse.move(
        card.x + ((viewport.width / 2 - card.x) * step) / 12,
        y + ((viewport.height * 0.3 - y) * step) / 12,
      );
    await page.mouse.up();
    await expect
      .poll(async () => (await moves(page)).some((move) => move.startsWith("Pay with")), { timeout: 15_000 })
      .toBe(true);
  });
}
