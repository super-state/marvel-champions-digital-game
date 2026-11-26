/**
 * Fitting the battle table's cards to the screen. The camera never moves: the cards on the table are scaled about
 * their centre and slid on the table plane until they fill the room between the top of the screen and the hand, so a
 * busy board shrinks to fit instead of scrolling and a quiet one grows. The hand, the turn bar and anything else held
 * up to the camera keep their size. Plain math over a projection, so it is tested without a renderer.
 */

/** A rectangle on the table plane, in world units: x across, z towards the player. */
export interface TableBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Screen pixels the table may use. */
export interface ScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where the table's content goes: `world = (x + scale * (p.x - cx), scale * p.y, z + scale * (p.z - cz))`, with
 * (cx, cz) the centre of the box it was fitted from.
 */
export interface BoardFit {
  scale: number;
  cx: number;
  cz: number;
  x: number;
  z: number;
}

export const IDENTITY_FIT: BoardFit = { scale: 1, cx: 0, cz: 0, x: 0, z: 0 };

/** Screen position of a world point. */
export type Project = (x: number, y: number, z: number) => { x: number; y: number };

export function fitToBox(fit: BoardFit, p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return {
    x: fit.x + fit.scale * (p.x - fit.cx),
    y: fit.scale * p.y,
    z: fit.z + fit.scale * (p.z - fit.cz),
  };
}

/**
 * The largest scale (within `minScale`..`maxScale`) at which the box, centred under the camera and placed with equal
 * room above and below, projects inside `rect`. Past `minScale` the box is placed at `minScale` and may overflow.
 * `height` is how far above the table the card faces sit, so their projection is measured where they are drawn.
 * `nearest` is the world z the box's near edge may not pass: the camera's side of the table.
 *
 * `parts`, when given, are the cards that make up the box: the fit keeps each of them on screen rather than the box's
 * corners. Seen in perspective the table narrows away from the camera, so a box's near corners stand out wider than
 * any card there may reach: a pile at the side of the far row and the hero's row at the front made a corner where no
 * card stands, and it held the whole table small, leaving room unused above the hand (Adam, 2026-11-26).
 */
export function fitBoard(
  box: TableBox,
  project: Project,
  rect: ScreenRect,
  {
    minScale = 0.3,
    maxScale = 3,
    height = 0.06,
    nearest = 4,
  }: Partial<Record<"minScale" | "maxScale" | "height" | "nearest", number>> = {},
  parts: readonly TableBox[] = [box],
): BoardFit {
  const cx = (box.x0 + box.x1) / 2;
  const cz = (box.z0 + box.z1) / 2;
  const halfDepth = (box.z1 - box.z0) / 2;
  // Slide the box towards or away from the camera until the room above it equals the room below.
  const place = (scale: number): number => {
    let lo = -60;
    let hi = nearest - scale * halfDepth;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      const far = project(0, height * scale, mid - scale * halfDepth).y;
      const near = project(0, height * scale, mid + scale * halfDepth).y;
      if (far - rect.top < rect.bottom - near) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const fits = (scale: number): { z: number; ok: boolean } => {
    const z = place(scale);
    const y = height * scale;
    let ok = true;
    for (const part of parts) {
      for (const pz of [part.z0, part.z1]) {
        for (const px of [part.x0, part.x1]) {
          const point = project(scale * (px - cx), y, z + scale * (pz - cz));
          if (point.x < rect.left - 0.5 || point.x > rect.right + 0.5) ok = false;
          if (point.y < rect.top - 0.5 || point.y > rect.bottom + 0.5) ok = false;
        }
      }
    }
    return { z, ok };
  };
  let lo = minScale;
  let hi = maxScale;
  if (fits(hi).ok) return { scale: hi, cx, cz, x: 0, z: fits(hi).z };
  if (!fits(lo).ok) return { scale: lo, cx, cz, x: 0, z: fits(lo).z };
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid).ok) lo = mid;
    else hi = mid;
  }
  return { scale: lo, cx, cz, x: 0, z: fits(lo).z };
}
