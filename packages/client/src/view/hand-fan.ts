import { hit } from "../tokens.js";
import type { Rect } from "./layout.js";

/** All three rectangles are in board coordinates. The tap target stays put as the printed face lifts. */
export interface HandFanCard {
  readonly face: Rect;
  readonly angle: number;
  readonly lifted: Rect;
  readonly target: Rect;
}

/** Bend the ordinary hand slots into a shallow arc, preserving order and each printed face's aspect ratio. */
export function handFan(slots: readonly Rect[], area: Rect): readonly HandFanCard[] | null {
  if (!slots.length || slots.some((slot) => Math.min(slot.width, slot.height) * 0.89 < hit.target)) return null;
  const middle = area.x + area.width / 2;
  const span = Math.min(11, (slots.length - 1) * 2.5);
  const cards = slots.map((slot, index): HandFanCard => {
    const side = slots.length === 1 ? 0 : (index * 2) / (slots.length - 1) - 1;
    const angle = span * side;
    const radians = (Math.abs(angle) * Math.PI) / 180;
    const width = slot.width * 0.89;
    const height = slot.height * 0.89;
    const halfX = (width * Math.cos(radians) + height * Math.sin(radians)) / 2;
    const halfY = (height * Math.cos(radians) + width * Math.sin(radians)) / 2;
    const cx = middle + (slot.x + slot.width / 2 - middle) * 0.78;
    const cy = Math.min(area.y + area.height - halfY, area.y + area.height * (0.49 + side * side * 0.065));
    const face = { x: cx - width / 2, y: cy - height / 2, width, height };
    const lifted = {
      x: cx - slot.width / 2,
      y: Math.max(area.y - 6, cy - slot.height / 2 - Math.min(17, area.height * 0.11)),
      width: slot.width,
      height: slot.height,
    };
    const x = Math.min(cx - halfX, lifted.x);
    const y = Math.min(cy - halfY, lifted.y);
    const target = {
      x,
      y,
      width: Math.max(cx + halfX, lifted.x + lifted.width) - x,
      height: Math.max(cy + halfY, lifted.y + lifted.height) - y,
    };
    return { face, angle, lifted, target };
  });
  // Once there is less than a finger's width per card the original fitted row is more useful than another overlap.
  const crowded = cards.some((card, i) => {
    const next = cards[i + 1];
    return next && next.face.x + next.face.width / 2 - (card.face.x + card.face.width / 2) < hit.target;
  });
  return crowded ? null : cards;
}
