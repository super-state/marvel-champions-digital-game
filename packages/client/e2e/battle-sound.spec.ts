import { expect, test, type Page } from "@playwright/test";

/**
 * The 3D table's sound effects (`src/battle-table/sound.ts`). Under automation nothing is heard: each sound the table
 * asks for is written to `globalThis.__battleSounds` instead, which is what these tests read. Scene `defend`: Rhino
 * attacks a hurt Spider-Man in the villain phase.
 */

const played = (page: Page) =>
  page.evaluate(() => (globalThis.__battleSounds ?? []).map((sound: { name: string }) => sound.name));

test("the villain phase is heard: its stinger, threat on the scheme, the swoosh of the attack and its hit", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/battle/?seed=11&scene=defend");
  await expect(page.locator("#turn-status")).toHaveText(/Hero phase/i, { timeout: 60_000 });
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 30_000 });
  await page.evaluate(() => (globalThis.__battleSounds = []));
  await page.locator("#end-turn").click();

  // Through the villain phase, never defending, until the hero has been hit.
  for (let i = 0; i < 160 && !(await played(page)).some((name) => name.startsWith("hit")); i++) {
    const primary = page.locator("#dock-primary");
    const secondary = page.locator("#dock-secondary");
    const title = (await page.locator("#dock-title").innerText()).trim();
    const label = (await primary.isVisible()) ? (await primary.innerText()).trim() : "";
    if (await page.locator("#read-reveal").isVisible()) await page.locator("#read-reveal").click();
    else if (/^Discard \d/.test(title) && label.startsWith("Pick"))
      await page
        .locator('#anchors [aria-label^="Discard "]')
        .first()
        .evaluate((el) => (el as HTMLElement).click());
    else if (/^Discard \d/.test(title) && label.startsWith("Discard")) await primary.click();
    else if (
      (await secondary.isVisible()) &&
      /^(Pass|Skip|Don.t defend|No)/i.test((await secondary.innerText()).trim())
    )
      await secondary.click();
    else if ((await primary.isVisible()) && /^(Continue|Take)/.test(label)) await primary.click();
    await page.waitForTimeout(150);
  }

  const sounds = await played(page);
  expect(sounds).toContain("confirm");
  expect(sounds).toContain("phase-villain");
  expect(sounds).toContain("threat");
  const hit = sounds.findIndex((name) => name.startsWith("hit"));
  expect(hit, sounds.join(", ")).toBeGreaterThan(0);
  // The attacker winds up with a swoosh before the blow lands.
  expect(sounds.slice(0, hit)).toContain("whoosh");
});

test("Sound off in the menu silences the table, and stays off after a reload", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/battle/?seed=11&scene=defend");
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#menu-button").click();
  await page.locator('[data-sound="off"]').click();
  await expect(page.locator('[data-sound="off"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#menu-resume").click();
  await page.evaluate(() => (globalThis.__battleSounds = []));
  await page.locator("#end-turn").click();
  // The end of the turn plays out (cards drawn, a hand to discard down to): normally heard, silent now.
  await expect(page.locator("#turn-status")).not.toHaveText(/Hero phase/i, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  expect(await played(page)).toEqual([]);

  await page.reload();
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 60_000 });
  await page.locator("#menu-button").click();
  await expect(page.locator('[data-sound="off"]')).toHaveAttribute("aria-pressed", "true");
});

test("outside automation, the first click unlocks Web Audio, every file decodes, and sounds start", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Seen as a person's browser (headless Chromium has no speakers, so this stays silent): count what starts playing.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
    const started: number[] = [];
    (globalThis as unknown as { __started: number[] }).__started = started;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      started.push(this.buffer?.duration ?? 0);
      return start.apply(this, args);
    };
  });
  await page.goto("/battle/?seed=11&scene=defend");
  await expect(page.locator("#end-turn")).toBeEnabled({ timeout: 60_000 });
  const undecodable = await page.evaluate(async () => {
    const { sfx } = await import("/src/battle-table/sound.ts");
    const context = new OfflineAudioContext(1, 44100, 44100);
    const bad: string[] = [];
    for (const url of sfx.urls())
      await context.decodeAudioData(await (await fetch(url)).arrayBuffer()).catch(() => bad.push(url));
    return { count: sfx.urls().length, bad };
  });
  expect(undecodable.count).toBeGreaterThan(50);
  expect(undecodable.bad).toEqual([]);
  // The click unlocks audio; once the files have loaded, what the table asks for really starts.
  await page.locator("#end-turn").click();
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const { sfx } = await import("/src/battle-table/sound.ts");
    sfx.play("whoosh");
    sfx.play("hit-heavy", { delay: 150 });
    sfx.play("threat", { delay: 300 });
  });
  const started = () => page.evaluate(() => (globalThis as unknown as { __started: number[] }).__started);
  await expect.poll(async () => (await started()).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  expect((await started()).every((seconds) => seconds > 0)).toBe(true);
});
