import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The Sound Studio (`battle/studio.html`, dev server only): browse to a folder, give "Hit" a file from it, shape it,
 * save, and play it on the table. Headless Chromium has no speakers, so this is silent; what started playing is
 * counted instead. The studio saves into a throwaway folder under test (`playwright.config.ts`).
 */

/** A short WAV: a click and a decaying tone, so there is a waveform to draw. */
function wav(seconds = 0.6, rate = 22050): Buffer {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t * 6) * 26000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test("browse, assign a sample to Hit, shape it, save it, and play it on the table", async ({ page }) => {
  test.setTimeout(180_000);
  const samples = mkdtempSync(join(tmpdir(), "studio-e2e-samples-"));
  mkdirSync(join(samples, "Impacts"));
  writeFileSync(join(samples, "Impacts", "Big Punch.wav"), wav());
  writeFileSync(join(samples, "notes.txt"), "not a sound");

  await page.addInitScript(() => {
    // Seen as a person's browser, so the studio's board really plays (into no speakers): count what starts.
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
    const started: number[] = [];
    (globalThis as unknown as { __started: number[] }).__started = started;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      started.push(this.buffer?.duration ?? 0);
      return start.apply(this, args);
    };
  });
  await page.goto("/battle/studio.html");
  await expect(page.locator(".sound")).toHaveCount(31);

  // Browse: type the folder, open the subfolder; only sound files are listed.
  const path = page.locator("#crumbs");
  await path.fill(samples);
  await path.press("Enter");
  await expect(page.locator("#files li")).toHaveText([/Impacts/]);
  // Search reaches into the subfolders, and says where each hit is.
  await page.locator("#filter").fill("punch");
  await expect(page.locator("#files li")).toHaveCount(1);
  await expect(page.locator("#files li .file")).toHaveText("Big Punch.wav");
  await expect(page.locator("#files li .where")).toHaveText("Impacts");
  await expect(page.locator("#search-info")).toContainText("1 found");
  await page.locator("#filter").fill("");
  await expect(page.locator("#files li")).toHaveText([/Impacts/]);
  await page.locator("#files li", { hasText: "Impacts" }).click();
  await expect(page.locator("#files li")).toHaveText([/Big Punch\.wav/]);

  // Assign it to Hit (selected at start) with its ＋.
  await expect(page.locator(".sound.active .label")).toHaveText("Hit (1–3 damage)");
  await page.locator("#files li", { hasText: "Big Punch" }).hover();
  await page.locator("#files li .add").click();
  await expect(page.locator("#editor-file")).toContainText("Big Punch.wav");
  await expect(page.locator(".sound.active .meta")).toContainText("unsaved");
  await expect(page.locator("#studio-save")).toHaveText("Save 1 change");

  // Browse away, then back to the sample's folder with it picked out.
  await page.locator("#up").click();
  await expect(page.locator("#files li")).toHaveText([/Impacts/]);
  await page.locator("#show-folder").click();
  await expect(page.locator("#crumbs")).toHaveValue(join(samples, "Impacts"));
  await expect(page.locator("#files li.current")).toContainText("Big Punch.wav");

  // Shape it: louder, and play the cut.
  const volume = page.locator(".knob", { hasText: "Volume" }).locator("input");
  await volume.fill("6");
  await expect(page.locator(".knob", { hasText: "Volume" }).locator("output")).toHaveText("+6.0 dB");
  const before = await page.evaluate(() => (globalThis as unknown as { __started: number[] }).__started.length);
  await page.locator("#play").click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { __started: number[] }).__started.length))
    .toBeGreaterThan(before);

  // Save: it lands in the studio's folder, copied from the library, with the edit.
  await page.locator("#studio-save").click();
  await expect(page.locator("#studio-status")).toContainText("Saved");
  await expect(page.locator("#studio-save")).toHaveText("Saved");
  const manifest = await page.evaluate(async () => (await fetch("/__studio/sounds.json")).json());
  expect(manifest.sounds.hit).toHaveLength(1);
  expect(manifest.sounds.hit[0].file).toMatch(/^studio:.+\.wav$/);
  expect(manifest.sounds.hit[0].gainDb).toBe(6);

  // Play it on the table: the attack plays out there, its sounds coming through the studio.
  await expect(page.locator("#play-moment")).toBeEnabled({ timeout: 90_000 });
  const counted = await page.evaluate(() => (globalThis as unknown as { __started: number[] }).__started.length);
  await page.locator("#play-moment").click();
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as { __started: number[] }).__started.length), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(counted + 2);

  // Back to the game's own sound, saved: the studio's file for Hit is gone.
  await page.getByRole("button", { name: "Back to game's sound" }).click();
  await page.locator("#studio-save").click();
  await expect(page.locator("#studio-status")).toContainText("Saved");
  const after = await page.evaluate(async () => (await fetch("/__studio/sounds.json")).json());
  expect(after.sounds.hit).toBeUndefined();
});
