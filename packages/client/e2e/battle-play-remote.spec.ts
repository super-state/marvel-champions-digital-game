import { expect, test } from "./battle-test";

/**
 * Remote play (`vite-battle-play.ts`, `answerRemote` in `src/battle-table/play.ts`): a battle page opened with
 * `?remote` takes play-hook calls from the dev server, so Claude can play a table shown in Surf's Games bubble from a
 * terminal. A plain request to `/__battle-play` reaches that page and comes back with the table in words; a move made
 * that way happens on the page.
 */
test("a table opened with ?remote is played through the dev server's /__battle-play", async ({ page, request }) => {
  test.setTimeout(150_000);
  await page.goto("/battle/?remote&seed=7");
  await expect(page.locator("#dock-title")).toHaveText("Keep your hand?", { timeout: 60_000 });

  const look = await request.get("/__battle-play", { params: { call: "wait" }, timeout: 100_000 });
  expect(look.ok()).toBe(true);
  expect(await look.text()).toContain("Round 1, setup, mulligan.");

  const moves = await (await request.get("/__battle-play", { params: { call: "moves" } })).text();
  expect(moves).toMatch(/^\d+\. Keep hand$/m);

  const kept = await request.get("/__battle-play", {
    params: { call: "play", move: "Keep hand" },
    timeout: 100_000,
  });
  expect(await kept.text()).toContain("Hand kept");
  // The move happened on the page itself, not in a copy of the game.
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 30_000 });
});
