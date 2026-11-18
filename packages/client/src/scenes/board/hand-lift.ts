import type Phaser from "phaser";
import { isMousePointer } from "../../ui/card-hover-preview.js";
import { noteTapFired } from "../../ui/tap.js";
import { HandLift, overTable } from "../../view/hand-lift.js";
import type { Rect } from "../../view/layout.js";
import { CHROME_SCENES, SCENES } from "../keys.js";

interface LiftHandlers {
  readonly table: Rect;
  ready(): boolean;
  /** Pointer displacement from the original press, so a press near a card's corner keeps its grip. */
  carry(dx: number, dy: number, onTable: boolean): void;
  settle(placed: boolean): void;
  activate(): void;
}

/** A mouse lift listens to the scene only for the length of its press. Touch keeps the existing tap, hold and scroll. */
export function bindHandLift(scene: Phaser.Scene, zone: Phaser.GameObjects.Zone, handlers: LiftHandlers): void {
  zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    if (!isMousePointer(pointer) || pointer.button !== 0 || !handlers.ready()) return;
    const { downTime } = pointer;
    const lift = new HandLift(pointer.x, pointer.y);
    let carrying = false;
    const blocked = (): boolean => {
      if (!scene.input.enabled || !handlers.ready()) return true;
      const active = scene.scene.manager.getScenes(true);
      return active.slice(active.indexOf(scene) + 1).some((overlay) => {
        const key = overlay.sys.settings.key;
        return overlay.sys.isVisible() && key !== SCENES.music && !CHROME_SCENES.has(key);
      });
    };
    const stop = (): void => finish(false);
    const finish = (placed: boolean): void => {
      scene.input.off("pointermove", move);
      scene.input.off("pointerup", release);
      scene.input.off("pointerupoutside", outside);
      scene.input.off("gameout", stop);
      scene.game.events.off("blur", stop);
      scene.events.off("update", check);
      zone.off("destroy", stop);
      if (carrying) handlers.settle(placed);
      carrying = false;
    };
    const move = (moved: Phaser.Input.Pointer): void => {
      if (moved !== pointer) return;
      if (!pointer.isDown || pointer.downTime !== downTime || blocked()) return stop();
      const phase = lift.move(pointer.x, pointer.y, pointer.event.timeStamp - downTime);
      if (phase === "ended") return stop();
      if (phase !== "carrying") return;
      if (!carrying) noteTapFired(scene, pointer);
      carrying = true;
      handlers.carry(pointer.x - lift.x, pointer.y - lift.y, overTable(pointer.x, pointer.y, handlers.table));
    };
    const release = (released: Phaser.Input.Pointer): void => {
      if (released !== pointer) return;
      const play = lift.release(pointer.x, pointer.y, handlers.table, pointer.wasCanceled || blocked());
      if (play) handlers.carry(pointer.x - lift.x, pointer.y - lift.y, true);
      finish(play);
      if (play) handlers.activate();
    };
    const outside = (released: Phaser.Input.Pointer): void => {
      if (released === pointer) stop();
    };
    // An overlay can take the release, and a board redraw can replace this zone while the mouse is down.
    const check = (): void => {
      if (!pointer.isDown || pointer.downTime !== downTime || blocked()) stop();
    };
    scene.input.on("pointermove", move);
    scene.input.on("pointerup", release);
    scene.input.on("pointerupoutside", outside);
    scene.input.on("gameout", stop);
    scene.game.events.on("blur", stop);
    scene.events.on("update", check);
    zone.once("destroy", stop);
  });
}
