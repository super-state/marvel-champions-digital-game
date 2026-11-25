import { expect, test, type Page } from "./battle-test";

/**
 * Eviction Notice answered with "Exhaust Peter Parker" plays out one step at a time (Adam, 2026-11-22): the card lands
 * beside Rhino and fires there, then Peter exhausts, then the card evaporates (it is removed from the game, so it has
 * no pile to go to), and only once it has gone does the Hero Phase banner come up. The table is not left blurred behind
 * the answer, with the card that asked still sharp over it. Scene `eviction`.
 */

const SHOTS = process.env.BATTLE_SHOTS;

// About timing, so the motion the rest of the suite turns off stays on here.
test.use({ reducedMotion: "no-preference" });

async function dock(page: Page) {
  return page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)?.textContent?.trim() ?? "";
    const usable = (id: string) => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      return !!el && !el.disabled && !el.hidden && el.offsetParent !== null;
    };
    return {
      eyebrow: text("dock-eyebrow"),
      primary: usable("dock-primary") ? text("dock-primary") : null,
      secondary: usable("dock-secondary") ? text("dock-secondary") : null,
      waiting: document.getElementById("dock")?.hasAttribute("data-waiting") ?? false,
      options: document.querySelectorAll("#dock-options:not([hidden]) button").length,
    };
  });
}

async function toEvictionNotice(page: Page) {
  await page.goto("/battle/?seed=11&scene=eviction");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#end-turn").click();
  const log: string[] = [];
  for (let i = 0; i < 120; i++) {
    const d = await dock(page);
    log.push(JSON.stringify(d));
    if (!d.waiting && d.options >= 2 && /Eviction Notice/i.test(d.eyebrow)) return;
    if (d.waiting) {
      // The card is being dealt or read out.
    } else if (await page.locator("#read-reveal").isVisible()) await page.locator("#read-reveal").click();
    else if (d.secondary && /^(Pass|Don.t defend|Skip)$/.test(d.secondary))
      await page.locator("#dock-secondary").click();
    else if (d.primary && /^(Continue|Start|OK|Next|Keep hand)/i.test(d.primary))
      await page.locator("#dock-primary").click();
    await page.waitForTimeout(500);
  }
  throw new Error(`Eviction Notice never asked:\n${log.slice(-15).join("\n")}`);
}

test("Eviction Notice exhausting Peter: lands, fires, Peter exhausts, it evaporates, then the Hero Phase banner", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await toEvictionNotice(page);
  // From the answer on, note when the turn bar's line changes, when the phase banner starts, and whether the table
  // is blurred, every 25 ms in the page itself. The answer is pressed in the same step, so the log starts with it.
  await page.evaluate(() => {
    const log: { at: number; title: string; banner: boolean; blurred: boolean }[] = [];
    (window as unknown as { orderLog: typeof log }).orderLog = log;
    const start = performance.now();
    let last = "";
    setInterval(() => {
      const title = document.getElementById("dock-title")?.textContent?.trim() ?? "";
      const banner = !!document.getElementById("phase-banner")?.getAnimations({ subtree: true }).length;
      const blur = document.getElementById("focus-blur")!;
      const blurred = !blur.hidden && "ready" in blur.dataset;
      const key = `${title}|${banner}|${blurred}`;
      if (key !== last) log.push({ at: performance.now() - start, title, banner, blurred });
      last = key;
    }, 25);
    const answer = [...document.querySelectorAll<HTMLButtonElement>("#dock-options button")].find((button) =>
      (button.textContent?.trim() ?? "").startsWith("Exhaust Peter Parker"),
    );
    if (!answer) throw new Error("No Exhaust Peter Parker answer");
    answer.click();
  });
  if (SHOTS) {
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${SHOTS}/eviction-evaporating.png` });
  }
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 30_000 });
  await page.waitForTimeout(400);
  const log = await page.evaluate(
    () =>
      (window as unknown as { orderLog: { at: number; title: string; banner: boolean; blurred: boolean }[] }).orderLog,
  );
  const first = (test: (entry: (typeof log)[number]) => boolean) => log.find(test)?.at ?? NaN;
  const fires = first((e) => e.title === "Eviction Notice");
  const exhausts = first((e) => /Peter Parker exhausts/.test(e.title));
  const removed = first((e) => /Eviction Notice is removed from the game/.test(e.title));
  const banner = first((e) => e.banner);
  const story = JSON.stringify(log);
  // It lands beside Rhino before it fires, and fires before Peter exhausts.
  expect(fires, story).toBeGreaterThanOrEqual(350);
  expect(exhausts, story).toBeGreaterThan(fires + 500);
  expect(removed, story).toBeGreaterThan(exhausts);
  // The banner waits for the evaporation to finish.
  expect(banner, story).toBeGreaterThan(removed + 1200);
  // The question's blur goes with the question: the table is sharp at every step of the answer.
  const steps = log.filter((e) => e.at >= fires);
  expect(steps.length, story).toBeGreaterThan(3);
  expect(
    steps.filter((e) => e.blurred),
    story,
  ).toEqual([]);
});
