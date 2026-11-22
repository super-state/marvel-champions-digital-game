/**
 * The path of a boost card sliding facedown under its enemy's edge, as two fractions of the flight at `progress`
 * (0 to 1): how far down to the table it has come, and how far across to its place.
 *
 * It drops to the table first, close to the deck it came off, and only then slides in flat, so it passes under the
 * enemy rather than over the top of it and down through it (Adam, 2026-11-22: "it goes on top first then clips
 * through").
 */
export function tuckPath(progress: number): { drop: number; across: number } {
  const p = Math.min(1, Math.max(0, progress));
  const drop = smoothstep(p, 0, DROPPED);
  // A little drift while it drops, so it reads as one move; the slide itself eases in and glides to a stop.
  const slide = Math.max(0, (p - DROPPED) / (1 - DROPPED));
  const across = DRIFT * smoothstep(p, 0, DROPPED) + (1 - DRIFT) * slide * slide * (3 - 2 * slide);
  return { drop, across };
}

/** By this share of the flight the card is down on the table. */
const DROPPED = 0.36;
/** How much of the way across it gets while still dropping. */
const DRIFT = 0.18;

function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
