import { expect, test, type Page } from "./battle-test";

/**
 * A crowded table late in the game (`?scene=ultronpiles`: six minions in two rows, four cards beside Ultron, a tall
 * player discard pile and cards in the encounter discard pile). The encounter piles shrink and stand down the right
 * just above the player's discard pile: their counts must keep off it and off every other card (found playing Ultron,
 * 2026-11-24: the encounter deck's "16" lay on the player's discard pile). And with the player's row full, the cards
 * dealt facedown in the villain phase lie left of that row: clear of the player's deck (they lay over its right edge).
 */

interface PlayHook {
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const hook = (page: Page) => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay);
const moves = (page: Page) =>
  page.evaluate(() => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.moves().map((m) => m.label));
const play = (page: Page, move: string) =>
  page.evaluate((m) => (window as unknown as { __battlePlay: PlayHook }).__battlePlay.play(m), move);

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect.poll(() => hook(page), { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => (await moves(page)).length, { timeout: 60_000 }).toBeGreaterThan(0);
}

/** Plays the first move whose label passes `pick`; fails with the moves on offer if there is none. */
async function playWhere(page: Page, pick: (label: string) => boolean) {
  const offered = await moves(page);
  const move = offered.find(pick);
  expect(move, offered.join("\n")).toBeDefined();
  await play(page, move!);
}

/** Every pile count's box against every card above the hand and every other pile: what each one lies on. */
const countOverlaps = (page: Page) =>
  page.evaluate(() => {
    type Anchor = Box & { id: string };
    const table = (
      window as unknown as {
        battleTable: {
          anchors(): Anchor[];
          deckAnchor(): Box;
          discardAnchor(): Box;
          encounterAnchor(): Box;
          encounterDiscardAnchor(): Box;
        };
      }
    ).battleTable;
    const stage = document.getElementById("encounter-label")!.offsetParent!.getBoundingClientRect();
    const counts = ["encounter-label", "encounter-discard", "deck-label", "discard-label"].flatMap((id) => {
      const node = document.getElementById(id)!;
      if (node.hidden) return [];
      const r = node.getBoundingClientRect();
      return [
        {
          id,
          left: r.left - stage.left,
          right: r.right - stage.left,
          top: r.top - stage.top,
          bottom: r.bottom - stage.top,
        },
      ];
    });
    const handTop = stage.height * 0.72;
    const things: [string, Box][] = [
      ...table
        .anchors()
        .filter((card) => card.top < handTop)
        .map((card): [string, Box] => [card.id, card]),
      ["deck", table.deckAnchor()],
      ["discard", table.discardAnchor()],
      ["encounter deck", table.encounterAnchor()],
      ["encounter discard", table.encounterDiscardAnchor()],
      ...counts.map((count): [string, Box] => [count.id, count]),
    ];
    const own: Record<string, string> = {
      "encounter-label": "encounter deck",
      "encounter-discard": "encounter discard",
      "deck-label": "deck",
      "discard-label": "discard",
    };
    const hits: string[] = [];
    for (const count of counts)
      for (const [name, box] of things) {
        if (name === count.id || name === own[count.id]) continue;
        const across = Math.min(count.right, box.right) - Math.max(count.left, box.left);
        const down = Math.min(count.bottom, box.bottom) - Math.max(count.top, box.top);
        if (across > 0.5 && down > 0.5) hits.push(`${count.id} on ${name} (${Math.round(across)}x${Math.round(down)})`);
      }
    return hits;
  });

for (const [label, size] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`the encounter piles' counts keep off the player's tall discard pile (${label})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await open(page, "/battle/?scene=ultronpiles&seed=7");
    await expect.poll(() => page.locator("#discard-count").textContent()).not.toBe("0");
    await expect(page.locator("#encounter-discard")).toBeVisible();
    // The table has settled into place once nothing moves between two looks.
    await expect.poll(() => countOverlaps(page), { timeout: 20_000 }).toEqual([]);
    await page.waitForTimeout(600);
    expect(await countOverlaps(page)).toEqual([]);
  });
}

test("encounter cards dealt beside a full row of the player's cards keep off the player's deck", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/battle/?scene=ultronpiles&seed=7");
  // A fourth card in the player's row (Helicarrier), then Peter Parker, so the minions scheme rather than attack.
  await playWhere(page, (l) => l.startsWith("Play Helicarrier"));
  while (!(await moves(page)).includes("Play")) await playWhere(page, (l) => l.startsWith("Pay with"));
  await play(page, "Play");
  await playWhere(page, (l) => l.startsWith("Spider-Man: Change to Peter"));
  // Watch the deck through the villain phase: any card lying still over it for a while, other than one coming off it
  // (a Drone, a card drawn), is a card covering it. Ultron's Imperative's hazard deals two encounter cards.
  await page.evaluate(() => {
    const table = (window as unknown as { battleTable: { anchors(): (Box & { id: string })[]; deckAnchor(): Box } })
      .battleTable;
    const seen = new Map<string, { where: string; since: number }>();
    const covering = new Map<string, string>();
    const watch = window as unknown as { __covering: Map<string, string>; __watch: number };
    watch.__covering = covering;
    watch.__watch = window.setInterval(() => {
      const now = performance.now();
      const deck = table.deckAnchor();
      const width = deck.right - deck.left;
      for (const card of table.anchors()) {
        const where = [card.left, card.top, card.right, card.bottom].map(Math.round).join(",");
        const last = seen.get(card.id);
        const since = last?.where === where ? last.since : now;
        seen.set(card.id, { where, since });
        const across = Math.min(card.right, deck.right) - Math.max(card.left, deck.left);
        const down = Math.min(card.bottom, deck.bottom) - Math.max(card.top, deck.top);
        if (now - since >= 400 && across > 0.5 && down > 0.5 && across < width * 0.9)
          covering.set(
            card.id,
            `${where} over the deck at ${[deck.left, deck.top, deck.right, deck.bottom].map(Math.round).join(",")}`,
          );
      }
    }, 50);
  });
  await play(page, "End Turn");
  let reveals = 0;
  for (let step = 0; step < 30 && reveals < 2; step++) {
    const offered = await moves(page);
    const move = offered.find(
      (l) => l === "Keep hand" || /^Choose (Drone|Advanced)/.test(l) || l.startsWith("Continue (after reading"),
    );
    if (!move) break;
    if (move.startsWith("Continue")) reveals++;
    await play(page, move);
  }
  expect(reveals).toBe(2);
  const covering = await page.evaluate(() => {
    const watch = window as unknown as { __covering: Map<string, string>; __watch: number };
    window.clearInterval(watch.__watch);
    return [...watch.__covering].map(([id, what]) => `${id} ${what}`);
  });
  expect(covering).toEqual([]);
});
