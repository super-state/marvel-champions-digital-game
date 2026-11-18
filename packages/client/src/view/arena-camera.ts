import type { Rect } from "./layout.js";

/** Table coordinates: X crosses the table, Y is height above its surface, and positive Z faces the player. */
export interface TablePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ArenaView {
  readonly halfWidth: number;
  readonly project: (point: TablePoint) => { x: number; y: number };
}

const EYE_DISTANCE = 5.2;

/**
 * A perspective camera looking at the center of a two-unit-deep table. Fit its front edge to the available width
 * and its front and back to the playable band. The view stays fixed as cards move on top of it.
 */
export function arenaView(rect: Rect): ArenaView {
  const pitch = rect.width < rect.height ? 0.22 : 0.37;
  const cosine = Math.cos(pitch);
  const sine = Math.sin(pitch);
  const far = 1 / (EYE_DISTANCE + sine);
  const near = 1 / (EYE_DISTANCE - sine);
  const focal = Math.max(1, rect.height) / (cosine * (far + near));
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + focal * cosine * far;
  const halfWidth = Math.max(1, rect.width - 12) / (2 * focal * near);

  return {
    halfWidth,
    project({ x, y, z }) {
      const scale = focal / (EYE_DISTANCE - y * cosine - z * sine);
      return {
        x: centerX + x * scale,
        y: centerY + (z * cosine - y * sine) * scale,
      };
    },
  };
}
