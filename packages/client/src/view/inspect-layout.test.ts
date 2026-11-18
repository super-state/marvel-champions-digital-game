import { describe, expect, test } from "vitest";
import { rectsOverlap } from "./layout.js";
import { readingLayout } from "./inspect-layout.js";

describe("card reader", () => {
  test.each([
    [320, 568],
    [390, 844],
    [844, 390],
    [768, 1024],
    [1024, 768],
    [1440, 900],
    [2504, 1306],
  ])("keeps reading text and every fixed control inside a %i by %i viewport", (width, height) => {
    const { frame, header, tabs, body, text, art, footer } = readingLayout(width, height, true);
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(header.y + header.height).toBe(tabs.y);
    expect(tabs.y + tabs.height).toBe(body.y);
    expect(body.y + body.height).toBe(footer.y);
    expect(footer.y + footer.height).toBeLessThanOrEqual(height);
    expect(text.width).toBeGreaterThanOrEqual(300);
    expect(body.height).toBeGreaterThan(120);
    if (art) {
      expect(rectsOverlap(text, art)).toBe(false);
      expect(art.y).toBe(text.y);
    } else expect(text.width).toBe(body.width);
    expect(tabs.height).toBeGreaterThanOrEqual(44);
  });

  test("a reference card returns its action row to the reading area", () => {
    const active = readingLayout(390, 844, true);
    const reference = readingLayout(390, 844, false);
    expect(reference.body.height - active.body.height).toBe(active.footer.height);
    expect(reference.footer.height).toBe(0);
  });
});
