import { expect, test, type Page } from "./battle-test";

/**
 * Criminal Enterprise turning to State of Madness (and back) is seen turning over on the table, never swapped in place
 * (Adam, 2026-11-28: "there was no animation for the card, it just teleported on the environment card").
 *
 * Every frame of the move, each card on the table is watched: a card whose picture changes must be turning over
 * ("flip") as it does. Scene `normanflip`: 1 infamy left, so Spider-Man's attack flips Norman Osborn and Criminal
 * Enterprise; then two villain phases in alter-ego form take Green Goblin's 2 madness off and flip them back.
 */

type Swap = { id: string; from: string; to: string; flight: string | null };

async function watch(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      battleTable: { pieceNow(id: string): { flight: string | null; art: string | null } };
      __swaps: Swap[];
      __watching: boolean;
    };
    type Swap = { id: string; from: string; to: string; flight: string | null };
    w.__swaps = [];
    w.__watching = true;
    const last = new Map<string, string>();
    const flipped = new Set<string>();
    const frame = () => {
      if (!w.__watching) return;
      const ids = new Set([...document.querySelectorAll<HTMLElement>("[data-card]")].map((el) => el.dataset.card!));
      for (const id of ids) {
        const now = w.battleTable.pieceNow(id);
        if (now.flight === "flip") flipped.add(id);
        if (!now.art) continue;
        const before = last.get(id);
        // A turn-over paints the new face on the back first, then swaps: seen as a flip in this frame or just before.
        if (before && before !== now.art)
          w.__swaps.push({ id, from: before, to: now.art, flight: flipped.has(id) ? "flip" : now.flight });
        last.set(id, now.art);
      }
      flipped.clear();
      for (const id of ids) if (w.battleTable.pieceNow(id).flight === "flip") flipped.add(id);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function swaps(page: Page): Promise<Swap[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __swaps: Swap[]; __watching: boolean };
    w.__watching = false;
    return w.__swaps;
  });
}

/** Criminal Enterprise / State of Madness (02006a / 02006b). */
const env = (swap: Swap) => /02006/.test(swap.from) && /02006/.test(swap.to);

const play = (page: Page, move: string) =>
  page.evaluate(
    (m) => (window as unknown as { __battlePlay: { play(m: string): Promise<string> } }).__battlePlay.play(m),
    move,
  );
const moves = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __battlePlay: { moves(): { label: string }[] } }).__battlePlay.moves().map((m) => m.label),
  );

/** Answers whatever the table asks (keep, pass, defend, continue, a discard) until the player's turn comes round. */
async function toNextTurn(page: Page) {
  for (let i = 0; i < 40; i++) {
    const labels = await moves(page);
    if (labels.includes("End Turn") && i > 0) return;
    const pick =
      labels.find((l) => /^(Keep hand|Pass|Defend|Discard \d|Continue)/.test(l)) ??
      (labels.some((l) => l.startsWith("Discard")) ? undefined : labels.find((l) => l.startsWith("Pick "))) ??
      labels.find((l) => l === "End Turn") ??
      labels[0];
    if (!pick) return;
    await play(page, pick);
  }
}

test("Criminal Enterprise and State of Madness turn over on the table, both ways", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/battle/?seed=3&scene=normanflip");
  await expect.poll(() => moves(page), { timeout: 60_000 }).toContain("Spider-Man: Attack");

  await watch(page);
  const attack = await play(page, "Spider-Man: Attack");
  expect(attack).toContain("Criminal Enterprise turns over: State of Madness");
  const there = await swaps(page);
  expect(there.filter(env), "the environment's picture changed").toHaveLength(1);
  expect(
    there.filter((s) => s.flight !== "flip" && !/-back\.webp/.test(s.from)),
    "a card swapped its picture without turning over",
  ).toEqual([]);

  // Back: Peter Parker lets the Goblin scheme, each scheme taking a madness counter off instead.
  await play(page, "End Turn");
  await toNextTurn(page);
  await play(page, "Change to Peter Parker");
  await play(page, "End Turn");
  await toNextTurn(page);
  await watch(page);
  await play(page, "End Turn");
  await toNextTurn(page);
  const back = await swaps(page);
  expect(back.filter(env), "the environment's picture changed back").toHaveLength(1);
  expect(
    back.filter((s) => s.flight !== "flip" && !/-back\.webp/.test(s.from)),
    "a card swapped its picture without turning over",
  ).toEqual([]);
});
