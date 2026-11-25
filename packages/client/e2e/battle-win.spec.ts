import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * A driven win for every hero the table deals (`HEROES` in `model.ts`): the dev-only `finish` scene puts Rhino on his
 * last hit point with this stage made his last, the hero in hero form and ready (`debug-scenes.ts`). One attack wins.
 * Then, as Adam's own table keeps them: the victory screen, the game in this browser's record and in the menu's Record
 * list, and the Rhino mat earned at the trophy cabinet.
 *
 * The campaign moving on to Klaw: Adam's own table has every villain open, so it is checked as a friend sees it
 * (`?friend=1`, `access.ts`), where the villains lock by this record: Klaw locked before the win, open after it, and
 * Ultron still waiting for Klaw.
 *
 * The heroes are read from `model.ts` itself, so a hero added there is checked here without touching this file.
 */

const HEROES = [
  ...readFileSync(new URL("../src/battle-table/model.ts", import.meta.url), "utf8").matchAll(
    /\{ id: "([a-z-]+)", name: "([^"]+)", starterDeckId: "([^"]+)" \}/g,
  ),
].map(([, id, name, deck]) => ({ id: id!, name: name!, deck: deck! }));

interface PlayHook {
  moves(): { n: number; label: string }[];
  play(move: number | string): Promise<string>;
  wait(): Promise<string>;
  look(): Promise<string>;
}

const KEY = "mc-table-record";

async function hook(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as { __battlePlay?: PlayHook }).__battlePlay), {
      timeout: 60_000,
    })
    .toBe(true);
}

/** Answer a setup question first (Black Panther's Foresight), then the hero's basic attack: the last blow. */
async function lastBlow(page: Page, hero: string) {
  return page.evaluate(async (name) => {
    const play = (window as unknown as { __battlePlay: PlayHook }).__battlePlay;
    await play.wait();
    for (let i = 0; i < 3; i++) {
      const labels = play.moves().map((m) => m.label);
      if (labels.includes(`${name}: Attack`)) return play.play(`${name}: Attack`);
      // Foresight's search: any of his upgrades.
      const setup = labels.find((l) => l.startsWith("Choose "));
      if (!setup) break;
      await play.play(setup);
    }
    throw new Error(
      `no attack for ${name}: ${play
        .moves()
        .map((m) => m.label)
        .join(" | ")}`,
    );
  }, hero);
}

test.describe("battle table: a driven win for every hero", () => {
  test("the heroes are read from model.ts", () => {
    // Every entry of HEROES matched the pattern: one reflowed onto several lines would otherwise drop out unseen.
    const source = readFileSync(new URL("../src/battle-table/model.ts", import.meta.url), "utf8");
    const entries = /export const HEROES[^=]*=\s*\[([\s\S]*?)\] as const;/.exec(source)![1]!.match(/\bid:/g)!.length;
    expect(HEROES).toHaveLength(entries);
    expect(HEROES.map((h) => h.id)).toEqual(
      expect.arrayContaining(["spider-man", "captain-marvel", "she-hulk", "black-panther"]),
    );
  });

  for (const hero of HEROES) {
    test(`${hero.name} beats Rhino: the victory, the record, the Record list and the Rhino mat`, async ({ page }) => {
      test.setTimeout(120_000);
      // A record with nothing in it, once: the win is the only game.
      await page.addInitScript((key) => {
        if (sessionStorage.getItem("battle-win")) return;
        sessionStorage.setItem("battle-win", "1");
        localStorage.removeItem(key);
        localStorage.removeItem("battle-mat");
      }, KEY);
      // Before the win, as a friend sees it: Klaw waits for Rhino.
      const room = page.locator("#shelf");
      const picks = room.locator(".shelf-picks button");
      await page.goto("/battle/?friend=1");
      await expect(room).toHaveAttribute("data-place", "title", { timeout: 60_000 });
      await expect(picks.filter({ hasText: "Klaw (Beat Rhino to unlock)" })).toHaveCount(1);

      await page.goto(`/battle/?hero=${hero.id}&scene=finish&record=1&friend=0`);
      await hook(page);
      await expect(page).toHaveTitle(new RegExp(`^${hero.name} vs\\. Rhino`));

      const after = await lastBlow(page, hero.name);
      expect(after).toContain("GAME OVER: you won (villainDefeated)");

      // The victory screen: Rhino's card stamped, the hero named, the record's line under it.
      const over = page.locator("dialog#game-over");
      await expect(over).toHaveAttribute("open", "", { timeout: 30_000 });
      await expect(over).toHaveAttribute("data-victory", "");
      await expect(page.locator("#game-over-title")).toHaveText("Victory");
      await expect(page.locator("#game-over-stamp")).toHaveText("Defeated");
      await expect(page.locator("#game-over-kicker")).toHaveText(`${hero.name} vs. Rhino`);
      await expect(page.locator("#game-over-record")).toHaveText("You against Rhino on Standard: 1 won, 0 lost.");
      // Its achievements, Beat Rhino among them.
      const popup = page.locator("#achievement-popup");
      await expect(popup).toContainText("Beat Rhino");
      await expect(popup).toContainText(`Win as ${hero.name}`);
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);

      // The game in this browser's record, with its hero, deck and ending.
      const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).games, KEY);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        hero: hero.name,
        villain: "rhino",
        result: "win",
        reason: "villainDefeated",
        deck: [hero.deck],
      });

      // The menu's Record list: one win, as this hero, against Rhino.
      await page.locator("#try-again").click();
      await expect(over).not.toHaveAttribute("open", "");
      await page.locator("#menu-button").click();
      await page.locator("#menu-record").click();
      const sheet = page.locator("dialog#player-record");
      await expect(sheet.getByRole("row", { name: new RegExp(`^Rhino 1 0`) })).toBeVisible();
      await expect(sheet.getByRole("row", { name: new RegExp(`^${hero.name} 1 0`) })).toBeVisible();

      // The campaign moves on, as a friend sees it: Klaw is open, Ultron still waits for Klaw.
      await page.goto("/battle/?friend=1&room=title");
      await expect(room).toHaveAttribute("data-place", "title", { timeout: 60_000 });
      await expect(picks.filter({ hasText: /^Klaw/ })).toHaveCount(1);
      await expect(picks.filter({ hasText: "Klaw (Beat Rhino to unlock)" })).toHaveCount(0);
      await expect(picks.filter({ hasText: "Ultron (Beat Klaw to unlock)" })).toHaveCount(1);

      // At the trophy cabinet the Rhino mat is earned; the Klaw mat is still rolled up.
      await page.goto("/battle/?friend=1&room=trophies");
      await expect(room).toHaveAttribute("data-place", "trophies", { timeout: 60_000 });
      const rhinoMat = room.locator('.trophies-mat[data-mat="rhino"]');
      await expect(rhinoMat).toHaveCount(1);
      await expect(rhinoMat).not.toHaveAttribute("aria-label", /locked/);
      await expect(room.getByRole("button", { name: /^Klaw mat, locked/ })).toHaveCount(1);
    });
  }
});
