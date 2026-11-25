import { expect, test, type Page } from "./battle-test";

/**
 * Klaw's Masters of Mayhem asks "Order the enemies" (scene `klawmasters`): each minion picked wears its place on its
 * plate, 1 going first, as it is picked. Unpicking one moves the picks after it up, and the minions attack in the
 * order the numbers showed. Played through the play hook (`src/battle-table/play.ts`), as Claude plays.
 */

interface PlayHook {
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
}

const SHOTS = process.env.BATTLE_SHOTS;

const hook = (page: Page) => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay);
const moves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.moves().map((m) => m.label));
const play = (page: Page, move: string) =>
  page.evaluate((m) => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.play(m), move);

/** The number on a minion: said with its name on its plate, and worn on that same card. Null when it has none. */
const badge = async (page: Page, name: string) => {
  const { said, shown } = await page.evaluate((card) => {
    const plate = [...document.querySelectorAll<HTMLElement>(".anchor")].find((label) =>
      (label.getAttribute("aria-label") ?? "").startsWith(`Choose ${card}`),
    );
    if (!plate) throw new Error(`No plate for ${card}`);
    const place = /, (\d+)(st|nd|rd|th)$/.exec(plate.getAttribute("aria-label") ?? "")?.[1] ?? null;
    const worn = document.querySelector(`#order-badges .pick-order[data-card="${plate.dataset.card}"]`);
    return { said: place, shown: worn?.textContent ?? null };
  }, name);
  // The card's own number is placed on the table's next frame: until then the two differ, and the poll waits.
  return said === shown ? said : `plate says ${said}, card shows ${shown}`;
};

/** End the turn and answer plainly (pass, don't defend, discard the first card) until the enemies are to be ordered. */
async function toMastersOfMayhem(page: Page) {
  await page.goto("/battle/?seed=7&scene=klawmasters");
  await expect.poll(() => hook(page), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await moves(page)).includes("End Turn"), { timeout: 60_000 }).toBe(true);
  let said = await play(page, "End Turn");
  for (let i = 0; i < 40; i++) {
    const now = await moves(page);
    if (now.includes("Pick Melter") && now.includes("Pick Tiger Shark")) return said;
    const pick =
      now.find((m) => /^Discard \d/.test(m)) ??
      now.find((m) => m.startsWith("Pick ")) ??
      now.find((m) => m.startsWith("Continue")) ??
      now.find((m) => m === "Pass" || m === "Don’t defend") ??
      now[0];
    if (!pick) throw new Error("No move to make");
    said += await play(page, pick);
  }
  throw new Error(`Masters of Mayhem never asked:\n${said}`);
}

for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`Order the enemies numbers each pick on its plate, and they attack in that order (${size})`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await toMastersOfMayhem(page);
    await expect(page.locator("#dock-title")).toHaveText("Order the enemies");
    await expect.poll(() => badge(page, "Melter")).toBeNull();
    await expect.poll(() => badge(page, "Tiger Shark")).toBeNull();

    await play(page, "Pick Melter");
    await expect.poll(() => badge(page, "Melter")).toBe("1");
    await expect.poll(() => badge(page, "Tiger Shark")).toBeNull();
    await play(page, "Pick Tiger Shark");
    await expect.poll(() => badge(page, "Melter")).toBe("1");
    await expect.poll(() => badge(page, "Tiger Shark")).toBe("2");
    await expect(page.locator("#order-badges .pick-order")).toHaveText(["1", "2"]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/order-badges-${size}.png` });

    // Unpicking the first moves the second up; picking it again puts it last.
    await play(page, "Unpick Melter");
    await expect.poll(() => badge(page, "Melter")).toBeNull();
    await expect.poll(() => badge(page, "Tiger Shark")).toBe("1");
    await play(page, "Pick Melter");
    await expect.poll(() => badge(page, "Tiger Shark")).toBe("1");
    await expect.poll(() => badge(page, "Melter")).toBe("2");
    await expect(page.locator('.anchor[aria-label="Choose Tiger Shark, 1st"]')).toHaveAttribute("aria-pressed", "true");

    // Confirm: the numbers are gone, and Tiger Shark (1) attacks before Melter (2).
    const confirm = (await moves(page)).find((m) => m.startsWith("Confirm"));
    expect(confirm).toBeDefined();
    let feed = await play(page, confirm!);
    await expect(page.locator("#order-badges .pick-order")).toHaveCount(0);
    for (let i = 0; i < 10 && !/Melter deals/.test(feed); i++) {
      const now = await moves(page);
      const next = now.find((m) => m === "Don’t defend" || m === "Pass") ?? now.find((m) => m.startsWith("Continue"));
      if (!next) break;
      feed += await play(page, next);
    }
    const shark = feed.indexOf("Tiger Shark deals");
    const melter = feed.indexOf("Melter deals");
    expect(shark, feed).toBeGreaterThanOrEqual(0);
    expect(melter, feed).toBeGreaterThan(shark);
  });
}
