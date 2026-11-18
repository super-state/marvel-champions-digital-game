import type { Rect } from "./layout.js";

export interface HandCardPose {
  readonly face: Rect;
  readonly lifted: Rect;
  readonly target: Rect;
}

/** Keep the hand on one baseline. Lifting reveals one card without moving or tilting its neighbors. */
export function handCardPose(slot: Rect, bottom: number): HandCardPose {
  const restScale = 0.92;
  const restHeight = slot.height * restScale;
  const rise = Math.min(48, Math.round(slot.height * 0.26));
  const lifted = { ...slot, y: bottom - slot.height - rise };
  return {
    face: {
      x: slot.x + (slot.width * (1 - restScale)) / 2,
      y: bottom - restHeight,
      width: slot.width * restScale,
      height: restHeight,
    },
    lifted,
    target: { ...slot, y: lifted.y, height: bottom - lifted.y },
  };
}
