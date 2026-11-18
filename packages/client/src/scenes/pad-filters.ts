/** Disclosure state for the scenario and hero rosters. A gamepad can toggle filters with Y. */
import Phaser from "phaser";
import { onInputDeviceChange, padInputTracked } from "../platform/input-device.js";
import { appSession } from "../session.js";
import { padModeFor } from "../view/pad-filters.js";

export class PadFilters {
  #opened = false;

  /** Redraw the input hints when the player changes devices. */
  constructor(scene: Phaser.Scene, onChange: () => void) {
    let lastPad = this.padMode;
    const off = onInputDeviceChange(() => {
      const now = this.padMode;
      if (now === lastPad) return;
      lastPad = now;
      if (scene.sys.isActive()) onChange();
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }

  /** A controller is the input in use (the "Show hints for" setting can pin it). */
  get padMode(): boolean {
    return padModeFor(padInputTracked(), appSession().settings.glyphSource);
  }

  /** The roster keeps its reading space on every screen until the player asks to filter it. */
  get folded(): boolean {
    return !this.#opened;
  }

  /** Opens the chips if folded, folds them if open. */
  toggle(): void {
    this.#opened = !this.#opened;
  }

  open(): void {
    this.#opened = true;
  }

  /** Back to folded (a new visit to the screen). */
  reset(): void {
    this.#opened = false;
  }
}
