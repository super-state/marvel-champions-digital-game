import { describe, expect, it } from "vitest";
import { GAMEPAD_BUTTON } from "./buttons.js";
import { PAD_REPEAT_EVERY_MS, PAD_REPEAT_FIRST_MS } from "./repeat.js";
import { createPadReader, DEFAULT_PAD_SETTINGS, padSettingsFrom, type PadLike } from "./input.js";

const XBOX = "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)";
const SWITCH_PRO = "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)";
const STEAM = "Steam Virtual Gamepad (STANDARD GAMEPAD Vendor: 28de Product: 11ff)";

interface FakePad {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
}

function fakePad(id = XBOX, index = 0): FakePad {
  return {
    id,
    index,
    connected: true,
    mapping: "standard",
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
}

function hold(pad: FakePad, index: number, down = true, value = down ? 1 : 0): void {
  pad.buttons[index] = { pressed: down, value };
}

/** A reader and a clock: each `step` reads the pads one 16 ms frame later. */
function rig(settings = DEFAULT_PAD_SETTINGS) {
  const reader = createPadReader();
  let now = 1000;
  return {
    step(pads: PadLike[], enabled = true, ms = 16) {
      now += ms;
      return reader.read(pads, now, settings, enabled);
    },
  };
}

describe("pad-input presses", () => {
  it("reports a press once, on the frame it goes down", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.a);
    expect(step([pad]).presses).toEqual([GAMEPAD_BUTTON.a]);
    expect(step([pad]).presses).toEqual([]);
    hold(pad, GAMEPAD_BUTTON.a, false);
    expect(step([pad]).presses).toEqual([]);
    hold(pad, GAMEPAD_BUTTON.a);
    expect(step([pad]).presses).toEqual([GAMEPAD_BUTTON.a]);
  });

  it("ignores a button already down when the pad is first seen, until it is let go", () => {
    const pad = fakePad();
    hold(pad, GAMEPAD_BUTTON.b);
    const { step } = rig();
    expect(step([pad]).presses).toEqual([]);
    expect(step([pad]).presses).toEqual([]);
    hold(pad, GAMEPAD_BUTTON.b, false);
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.b);
    expect(step([pad]).presses).toEqual([GAMEPAD_BUTTON.b]);
  });

  it("never reports the D-pad or the triggers as presses: they move and hold layers instead", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    for (const index of [12, 13, 14, 15, GAMEPAD_BUTTON.l2, GAMEPAD_BUTTON.r2]) hold(pad, index);
    const frame = step([pad]);
    expect(frame.presses).toEqual([]);
    expect(frame.move).not.toBeNull();
    expect(frame.layer).toBe("lt");
  });

  it("never reports the guide button as a press", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.home);
    expect(step([pad]).presses).toEqual([]);
  });

  it("marks a held direction's later steps as repeats, the first step not", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.dpadRight);
    const first = step([pad]);
    expect([first.move, first.repeat]).toEqual(["right", false]);
    const reads = Array.from({ length: 40 }, () => step([pad])).filter((frame) => frame.move !== null);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((frame) => frame.repeat)).toBe(true);
  });

  it("acts by the printed label on a Switch-layout pad with the Nintendo layout setting on", () => {
    const pad = fakePad(SWITCH_PRO);
    const { step } = rig({ family: "auto", nintendoLayout: true });
    step([pad]);
    // The right face button is A on a Switch: it confirms, like the bottom button on an Xbox pad.
    hold(pad, GAMEPAD_BUTTON.b);
    expect(step([pad]).presses).toEqual([GAMEPAD_BUTTON.a]);
  });

  it("acts by position on a Switch-layout pad with the setting off, and always under Steam", () => {
    const pro = fakePad(SWITCH_PRO);
    const off = rig({ family: "auto", nintendoLayout: false });
    off.step([pro]);
    hold(pro, GAMEPAD_BUTTON.b);
    expect(off.step([pro]).presses).toEqual([GAMEPAD_BUTTON.b]);

    const steam = fakePad(STEAM);
    const under = rig({ family: "nintendo", nintendoLayout: true });
    under.step([steam]);
    hold(steam, GAMEPAD_BUTTON.b);
    expect(under.step([steam]).presses).toEqual([GAMEPAD_BUTTON.b]);
  });

  it("gives nothing to the game while the guide button is held, and nothing held through it fires after", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.home);
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.x);
    const chord = step([pad]);
    expect(chord.presses).toEqual([]);
    expect(chord.touched).not.toBeNull();
    hold(pad, GAMEPAD_BUTTON.home, false);
    expect(step([pad]).presses).toEqual([]);
  });

  it("drops presses while input is off, and a button pressed meanwhile waits to be let go", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.a);
    expect(step([pad], false).presses).toEqual([]);
    expect(step([pad], true).presses).toEqual([]);
    hold(pad, GAMEPAD_BUTTON.a, false);
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.a);
    expect(step([pad]).presses).toEqual([GAMEPAD_BUTTON.a]);
  });

  it("ignores a pad without the standard layout, naming it once", () => {
    const pad = { ...fakePad("Odd Pad"), mapping: "" };
    const { step } = rig();
    hold(pad, GAMEPAD_BUTTON.a);
    const first = step([pad]);
    expect(first.ignored).toEqual(["Odd Pad"]);
    expect(first.pads).toEqual([]);
    expect(step([pad]).ignored).toEqual([]);
  });

  it("listens to every pad at once", () => {
    const one = fakePad(XBOX, 0);
    const two = fakePad(SWITCH_PRO, 1);
    const { step } = rig({ family: "auto", nintendoLayout: false });
    step([one, two]);
    hold(two, GAMEPAD_BUTTON.y);
    const frame = step([one, two]);
    expect(frame.presses).toEqual([GAMEPAD_BUTTON.y]);
    expect(frame.touched?.family).toBe("nintendo");
    expect(frame.pads).toHaveLength(2);
  });
});

describe("pad-input movement", () => {
  it("moves at once on the D-pad, then repeats while it is held", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.dpadRight);
    // 60 reads a second for a second: one step at once, the next after PAD_REPEAT_FIRST_MS, then every EVERY_MS.
    const fired = Array.from({ length: 60 }, (_, read) => [read * 16, step([pad]).move] as const).filter(
      ([, move]) => move !== null,
    );
    expect(fired[0]).toEqual([0, "right"]);
    expect(fired[1]![0]).toBeGreaterThanOrEqual(PAD_REPEAT_FIRST_MS);
    expect(fired[2]![0] - fired[1]![0]).toBeLessThanOrEqual(PAD_REPEAT_EVERY_MS + 16);
    hold(pad, GAMEPAD_BUTTON.dpadRight, false);
    expect(step([pad]).move).toBeNull();
  });

  it("steps once for a quick tap caught across one slow frame, then repeats once the hold is plain", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.dpadDown);
    expect(step([pad]).move).toBe("down");
    // The table hitched: the next read comes 600 ms later with the button still down. That is one read of a hold,
    // not a hold yet; it repeats once the hold has been seen over REPEAT_MIN_READS reads.
    expect(step([pad], true, 600).move).toBeNull();
    expect(step([pad], true, PAD_REPEAT_EVERY_MS).move).toBeNull();
    expect(step([pad], true, PAD_REPEAT_EVERY_MS).move).toBe("down");
  });

  it("moves with the left stick past its deadzone, and the D-pad wins over it", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    pad.axes = [0.2, 0.1, 0, 0];
    const drift = step([pad]);
    expect(drift.move).toBeNull();
    expect(drift.touched).toBeNull();
    pad.axes = [0, 0.9, 0, 0];
    expect(step([pad]).move).toBe("down");
    pad.axes = [0, 0, 0, 0];
    step([pad]);
    pad.axes = [0, 0.9, 0, 0];
    hold(pad, GAMEPAD_BUTTON.dpadUp);
    expect(step([pad]).move).toBe("up");
  });

  it("scrolls with the right stick past its deadzone", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    pad.axes = [0, 0, 0, 0.1];
    expect(step([pad]).scroll).toBeNull();
    pad.axes = [0, 0, 0, 1];
    const frame = step([pad]);
    expect(frame.scroll?.dy).toBeGreaterThan(0);
    expect(frame.touched).not.toBeNull();
  });
});

describe("pad-input trigger layers", () => {
  it("holds the layer of the first trigger pulled until it is let go", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.l2, true, 0.9);
    expect(step([pad]).layer).toBe("lt");
    hold(pad, GAMEPAD_BUTTON.r2, true, 0.9);
    expect(step([pad]).layer).toBe("lt");
    hold(pad, GAMEPAD_BUTTON.l2, false);
    expect(step([pad]).layer).toBe("rt");
    hold(pad, GAMEPAD_BUTTON.r2, false);
    expect(step([pad]).layer).toBeNull();
  });

  it("does not engage on a light touch, and has no layer while input is off", () => {
    const pad = fakePad();
    const { step } = rig();
    step([pad]);
    hold(pad, GAMEPAD_BUTTON.l2, true, 0.2);
    expect(step([pad]).layer).toBeNull();
    hold(pad, GAMEPAD_BUTTON.l2, true, 0.95);
    expect(step([pad], false).layer).toBeNull();
  });
});

describe("padSettingsFrom", () => {
  it("falls back to the defaults for no record, a corrupt one or wrong types", () => {
    const defaults = { family: "auto", nintendoLayout: true, glyphs: true };
    expect(padSettingsFrom(null)).toEqual(defaults);
    expect(padSettingsFrom("{not json")).toEqual(defaults);
    expect(padSettingsFrom("[1,2]")).toEqual(defaults);
    expect(padSettingsFrom(JSON.stringify({ padGlyphFamily: "sega", nintendoLayout: "yes" }))).toEqual(defaults);
  });

  it("reads the player's choices from the classic game's settings record", () => {
    const raw = JSON.stringify({ padGlyphFamily: "playstation", nintendoLayout: false, inputGlyphs: false, sound: 1 });
    expect(padSettingsFrom(raw)).toEqual({ family: "playstation", nintendoLayout: false, glyphs: false });
  });
});
