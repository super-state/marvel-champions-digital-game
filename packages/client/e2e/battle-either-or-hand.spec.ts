import { expect, test, type Page } from "./battle-test";

/**
 * An either-or encounter card's "Choose one" (Sonic Boom: "spend [energy][mental][physical] resources or exhaust each
 * character you control") keeps the hand readable: it rises whole, clear of the blur and the shade, so the player can
 * see what they could pay with before choosing (issue 217, a playtester: "I can't view the cards in my hand to check
 * if I have one available to spend"). Nothing in it can be played or picked there, and the hand doesn't move when
 * "Spend ..." opens the second step.
 */

interface PlayHook {
  look(): string;
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
}

const hook = (page: Page) => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay);
const look = (page: Page) => page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.look());
const moves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.moves().map((m) => m.label));
const play = (page: Page, move: number | string) =>
  page.evaluate((m) => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.play(m), move);

/** Each hand card's box on screen, by the label riding on it. */
const handBoxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".anchor.in-hand")].map((node) => {
      const r = node.getBoundingClientRect();
      return { card: node.dataset.card ?? "", top: Math.round(r.top) };
    }),
  );

/** The hand's boxes once they have stopped moving. */
async function settledHand(page: Page) {
  let last = "";
  let boxes = await handBoxes(page);
  await expect
    .poll(
      async () => {
        boxes = await handBoxes(page);
        const now = JSON.stringify(boxes);
        const same = now === last;
        last = now;
        return same && boxes.length > 0;
      },
      { timeout: 20_000, intervals: [400] },
    )
    .toBe(true);
  return boxes;
}

test("Sonic Boom's Choose one shows the whole hand, risen and sharp, before the player chooses", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.goto("/battle/?scene=klawsonic");
  await expect.poll(() => hook(page), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await moves(page)).length, { timeout: 60_000 }).toBeGreaterThan(0);

  await play(page, "End Turn");
  const spend = "Choose Spend 1 energy, 1 mental, 1 physical";
  for (let i = 0; i < 10 && !(await moves(page)).includes(spend); i++) {
    const now = await moves(page);
    const pick = now.find((m) => m === "Keep hand") ?? now.find((m) => m === "Pass" || m === "Don’t defend");
    if (!pick) throw new Error(`Sonic Boom never asked:\n${now.join("\n")}\n${await look(page)}`);
    await play(page, pick);
  }
  expect(await moves(page)).toContain(spend);

  const viewport = page.viewportSize()!;
  const choosing = await settledHand(page);
  expect(choosing.length).toBeGreaterThanOrEqual(3);
  // Risen whole: the label on each hand card, low on the card, is on screen, not sunk below its edge.
  for (const box of choosing) expect(box.top, box.card).toBeLessThan(viewport.height - 20);
  // Not under the shade, and cut out of the blur along with the card asking.
  await expect(page.locator("#choice-shade")).toBeHidden();
  const holes = await page.evaluate(
    () => (getComputedStyle(document.getElementById("focus-blur")!).maskImage.match(/polygon/g) ?? []).length,
  );
  expect(holes).toBeGreaterThanOrEqual(choosing.length + 1);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/after-choose-one.png` });

  // A click on a hand card neither plays nor picks it: the question is still the two halves.
  const card = page.locator(".anchor.in-hand").first();
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  expect(await moves(page)).toContain(spend);
  expect(await handBoxes(page)).toHaveLength(choosing.length);

  // "Spend ..." opens the second step with the hand where it already was.
  await page.mouse.move(viewport.width / 2, 40);
  await settledHand(page);
  await play(page, spend);
  const spending = await settledHand(page);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/after-spend-step.png` });
  for (const [i, b] of spending.entries()) expect(Math.abs(b.top - choosing[i]!.top), b.card).toBeLessThanOrEqual(3);
});
