/**
 * The battle table's controller input: what the pads did this frame, read from the browser's snapshots.
 *
 * Pure over pad snapshots and a clock, so every rule is tested with fake pads (`pad-input.test.ts`); `controller.ts`
 * owns the loop and acts on what this returns. The rules are the classic board's (`docs/controller-support.md`),
 * through the same pure modules:
 *  - Only pads the browser maps to the "standard" layout count. A button's meaning is its standard index after the
 *    Nintendo swap (`view/pad-family.ts`), so a Switch-layout pad confirms with the A printed on it.
 *  - While a pad's guide / Steam / PS button is held, nothing it presses belongs to the game (Steam + X opens the Steam
 *    Deck's on-screen keyboard), and that button itself is never bound.
 *  - A button already down when a pad is first seen, held through the guide button or held while input is off fires
 *    nothing until it is let go and pressed again. A direction or a trigger still held when the guide button is let go
 *    takes effect then, as on the classic board: those are holds, not presses.
 *  - The D-pad and the left stick step the focus, a held direction repeating (`view/pad-repeat.ts`); the D-pad wins
 *    over the stick. The right stick scrolls.
 *  - LT and RT are hold layers (`view/pad-layer-hold.ts`): the first one pulled owns the layer until it is let go.
 */

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./buttons.js";
import type { PadLayer } from "./buttons.js";
import { layerOfHolds, NO_TRIGGERS, triggerHoldAfter, triggerPull, type TriggerHold } from "./triggers.js";
import {
  padIdentityOf,
  physicalIndexOf,
  resolvePadFamily,
  usesNintendoSwap,
  type PadFamilySetting,
  type PadIdentity,
} from "./family.js";
import { createPadRepeater, scrollDelta, stickDirection } from "./repeat.js";
import type { FocusDirection } from "./spatial.js";

/** The part of a browser `GamepadButton` read here. */
export interface PadButtonLike {
  readonly pressed: boolean;
  readonly value?: number;
}

/** The part of a browser `Gamepad` read here: real pads, the e2e stub and the unit tests' fakes all fit it. */
export interface PadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: readonly PadButtonLike[];
  readonly axes: readonly number[];
}

/** The player's controller settings, shared with the classic game's Settings ▸ Controls (`mc-settings`). */
export interface PadSettings {
  readonly family: PadFamilySetting;
  readonly nintendoLayout: boolean;
}

export const DEFAULT_PAD_SETTINGS: PadSettings = { family: "auto", nintendoLayout: true };

export interface PadFrame {
  /** The pad pressed, pushed or pulled on this frame, or null: what switches the table into controller mode. */
  readonly touched: PadIdentity | null;
  /** Buttons that went down this frame, by meaning; the D-pad, the triggers and the guide button never appear here. */
  readonly presses: readonly number[];
  /** A focus step to take now: a fresh D-pad or stick direction, or a held one repeating. */
  readonly move: FocusDirection | null;
  /** The step is a held direction repeating, not a fresh press (a sweep never stops on End Turn). */
  readonly repeat: boolean;
  /** How far the right stick scrolls this frame, in pixels. */
  readonly scroll: { readonly dx: number; readonly dy: number } | null;
  /** The trigger layer held now, across every pad. */
  readonly layer: PadLayer | null;
  /** Every usable pad connected now. */
  readonly pads: readonly PadIdentity[];
  /** Pads seen for the first time this frame that don't report the standard layout, ignored from now on. */
  readonly ignored: readonly string[];
}

/**
 * A held direction repeats only once it has been seen held over this many reads, as well as for the repeater's time:
 * one slow frame (the table busy drawing) with a quick tap still inside it must step once, not twice.
 */
export const REPEAT_MIN_READS = 3;

const DPAD: ReadonlyArray<readonly [number, FocusDirection]> = [
  [GAMEPAD_BUTTON.dpadUp, "up"],
  [GAMEPAD_BUTTON.dpadDown, "down"],
  [GAMEPAD_BUTTON.dpadLeft, "left"],
  [GAMEPAD_BUTTON.dpadRight, "right"],
];

/** Buttons read as single presses: everything but the D-pad (a held direction), the triggers (layers) and home. */
function isPressButton(index: number): boolean {
  return (
    index !== GAMEPAD_BUTTON.l2 &&
    index !== GAMEPAD_BUTTON.r2 &&
    index !== GAMEPAD_BUTTON.home &&
    !(index >= GAMEPAD_BUTTON.dpadUp && index <= GAMEPAD_BUTTON.dpadRight)
  );
}

interface PadMemory {
  /** Each physical button's pressed state last frame. */
  down: boolean[];
  stick: FocusDirection | null;
  triggers: TriggerHold;
}

export interface PadReader {
  read(pads: Iterable<PadLike | null | undefined>, nowMs: number, settings: PadSettings, enabled: boolean): PadFrame;
}

export function createPadReader(): PadReader {
  const memory = new Map<number, PadMemory>();
  const ignored = new Set<string>();
  const repeater = createPadRepeater();
  let layer: PadLayer | null = null;
  let lastNow: number | null = null;
  let held: FocusDirection | null = null;
  let heldReads = 0;

  return {
    read(pads, nowMs, settings, enabled) {
      const dt = lastNow === null ? 16 : Math.min(50, Math.max(0, nowMs - lastNow));
      lastNow = nowMs;
      const presses: number[] = [];
      const seen = new Set<number>();
      const usable: PadIdentity[] = [];
      const newlyIgnored: string[] = [];
      const holds: TriggerHold[] = [];
      let touched: PadIdentity | null = null;
      let dpad: FocusDirection | null = null;
      let lean: FocusDirection | null = null;
      let scroll: { dx: number; dy: number } | null = null;

      for (const pad of pads) {
        if (!pad?.connected) continue;
        if (pad.mapping !== "standard") {
          // A pad whose buttons the browser couldn't put in the standard places: a guess would press the wrong things.
          if (!ignored.has(pad.id)) {
            ignored.add(pad.id);
            newlyIgnored.push(pad.id);
          }
          continue;
        }
        seen.add(pad.index);
        const identity = padIdentityOf(pad.id);
        usable.push(identity);
        const pressed = pad.buttons.map((button) => button?.pressed === true);
        const known = memory.get(pad.index);
        // First seen: whatever is held now began before we were looking, so it waits to be let go.
        const previous = known?.down ?? pressed;
        const swap = usesNintendoSwap(resolvePadFamily(settings.family, identity), settings.nintendoLayout, identity);
        const chord = pressed[GAMEPAD_BUTTON.home] === true;
        let mine = false;
        if (chord || !enabled) {
          // Remember what is held so it fires nothing when the chord (or the block) ends.
          if (chord && known) mine = true;
          memory.set(pad.index, { down: pressed, stick: null, triggers: NO_TRIGGERS });
          if (mine) touched ??= identity;
          continue;
        }
        pressed.forEach((down, index) => {
          if (!down || previous[index] === true || !isPressButton(index)) return;
          presses.push(physicalIndexOf(index, swap));
          mine = true;
        });
        for (const [index, direction] of DPAD) {
          if (pressed[index]) {
            dpad ??= direction;
            mine = true;
          }
        }
        const stick = stickDirection(
          pad.axes[GAMEPAD_AXIS.leftX] ?? 0,
          pad.axes[GAMEPAD_AXIS.leftY] ?? 0,
          known?.stick ?? null,
        );
        if (stick !== null) {
          lean ??= stick;
          mine = true;
        }
        const scrolled = scrollDelta(pad.axes[GAMEPAD_AXIS.rightX] ?? 0, pad.axes[GAMEPAD_AXIS.rightY] ?? 0, dt);
        if (scrolled !== null) {
          scroll ??= scrolled;
          mine = true;
        }
        const before = known?.triggers ?? NO_TRIGGERS;
        const triggers = known
          ? triggerHoldAfter(
              before,
              triggerPull(pad.buttons[GAMEPAD_BUTTON.l2]),
              triggerPull(pad.buttons[GAMEPAD_BUTTON.r2]),
            )
          : NO_TRIGGERS;
        if ((triggers.lt && !before.lt) || (triggers.rt && !before.rt)) mine = true;
        holds.push(triggers);
        memory.set(pad.index, { down: pressed, stick, triggers });
        if (mine) touched ??= identity;
      }
      for (const index of [...memory.keys()]) if (!seen.has(index)) memory.delete(index);

      layer = enabled ? layerOfHolds(holds, layer) : null;
      const direction = dpad ?? lean;
      heldReads = direction !== null && direction === held ? heldReads + 1 : 0;
      held = direction;
      let move = repeater.update(direction, nowMs, enabled);
      // The first step goes at once; a repeat waits for the direction to have been seen held over a few reads too.
      if (move !== null && heldReads > 0 && heldReads < REPEAT_MIN_READS) move = null;
      return {
        touched,
        presses: enabled ? presses : [],
        move,
        repeat: move !== null && heldReads > 0,
        scroll: enabled ? scroll : null,
        layer,
        pads: usable,
        ignored: newlyIgnored,
      };
    },
  };
}

/**
 * The controller settings the player chose in the classic game (Settings ▸ Controls), read from its `mc-settings`
 * record: only the fields used here, each falling back to its default when missing or of the wrong type, so a corrupt
 * or older record never breaks the table. Read directly rather than through `settings-store.ts`, which would bring the
 * whole game's settings model into the battle page.
 */
export function padSettingsFrom(raw: string | null): PadSettings & { readonly glyphs: boolean } {
  let record: unknown = null;
  try {
    record = raw === null ? null : JSON.parse(raw);
  } catch {
    record = null;
  }
  const source = typeof record === "object" && record !== null ? (record as Record<string, unknown>) : {};
  const family = source["padGlyphFamily"];
  return {
    family:
      family === "auto" || family === "xbox" || family === "playstation" || family === "nintendo"
        ? family
        : DEFAULT_PAD_SETTINGS.family,
    nintendoLayout:
      typeof source["nintendoLayout"] === "boolean" ? source["nintendoLayout"] : DEFAULT_PAD_SETTINGS.nintendoLayout,
    glyphs: typeof source["inputGlyphs"] === "boolean" ? source["inputGlyphs"] : true,
  };
}
