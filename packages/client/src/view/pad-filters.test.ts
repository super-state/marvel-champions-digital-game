import { afterEach, describe, expect, test } from "vitest";
import { useEnglish, useSpanish } from "../i18n/test-language.js";
import type { InputEvent } from "./input-mode.js";
import { PadModeTracker, padModeFor } from "./pad-filters.js";
import { filtersLabel } from "./filters-layout.js";
import type { PadIdentity } from "./pad-family.js";

const PAD = { id: "Xbox Controller" } as unknown as PadIdentity;

/** Plays events through the tracker. */
function play(events: readonly InputEvent[]): boolean {
  const tracker = new PadModeTracker();
  let active = false;
  for (const event of events) active = tracker.note(event.kind);
  return active;
}

describe("pad mode", () => {
  test("no input yet is not pad mode; a pad press is", () => {
    expect(play([])).toBe(false);
    expect(play([{ kind: "pad", pad: PAD }])).toBe(true);
  });

  test("a trackpad or mouse move does not end it, nor does the mouse coming to rest", () => {
    expect(play([{ kind: "pad", pad: PAD }, { kind: "mouseMove" }])).toBe(true);
    expect(play([{ kind: "pad", pad: PAD }, { kind: "mouseMove" }, { kind: "mouseRest" }])).toBe(true);
    expect(play([{ kind: "pad", pad: PAD }, { kind: "mouseMove" }, { kind: "mouseRest" }, { kind: "mouseMove" }])).toBe(
      true,
    );
  });

  test("a key press or a touch hands the screen back to the keyboard and mouse", () => {
    expect(play([{ kind: "pad", pad: PAD }, { kind: "key" }])).toBe(false);
    expect(play([{ kind: "pad", pad: PAD }, { kind: "touch" }])).toBe(false);
    expect(play([{ kind: "pad", pad: PAD }, { kind: "key" }, { kind: "pad", pad: PAD }])).toBe(true);
  });

  test("a mouse-only player never sees it", () => {
    expect(play([{ kind: "mouseMove" }, { kind: "mouseRest" }, { kind: "key" }])).toBe(false);
  });

  test("the Show hints for setting pins it either way", () => {
    expect(padModeFor(false, "pad")).toBe(true);
    expect(padModeFor(true, "keyboard")).toBe(false);
    expect(padModeFor(true, "auto")).toBe(true);
    expect(padModeFor(false, "auto")).toBe(false);
  });
});

describe("where the filter chips sit", () => {
  test("the button says how many filters are set", () => {
    expect(filtersLabel(0, false)).toBe("Filters ▸");
    expect(filtersLabel(2, false)).toBe("Filters (2) ▸");
    expect(filtersLabel(1, true)).toBe("Filters (1) ▾");
  });

  describe("in Spanish (#390)", () => {
    afterEach(useEnglish);

    test("the disclosure follows the active language", () => {
      useSpanish();
      expect(filtersLabel(0, false)).toBe("Filtros ▸");
      expect(filtersLabel(2, true, "es")).toBe("Filtros (2) ▾");
    });
  });
});
