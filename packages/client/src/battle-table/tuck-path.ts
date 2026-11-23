/**
 * The path of a boost card going facedown under its enemy's edge, as fractions of the flight at `progress` (0 to 1):
 * `fly`, how far it has come on its arc from the deck to a spot on the table just short of its place; `hop`, how high
 * it is over the table on that arc (0 to 1); and `slide`, how far it has slid in flat from that spot to its place.
 *
 * It arcs over everything between the deck and the enemy, lands beside the enemy's edge and only then slides the last
 * short way in flat, so it passes under the enemy rather than over it and down through it (Adam, 2026-11-22: "it goes
 * on top first then clips through"). It used to drop by the deck and slide the whole way, which took it under any
 * minion standing in between too (Adam, 2026-11-23: "it can just fly over the minion").
 */
export function tuckPath(progress: number): { fly: number; hop: number; slide: number } {
  const p = Math.min(1, Math.max(0, progress));
  const fly = smoothstep(p, 0, LANDED);
  const hop = p >= LANDED ? 0 : Math.sin(Math.PI * fly);
  const slide = smoothstep(p, LANDED, 1);
  return { fly, hop, slide };
}

/** By this share of the flight the card has landed beside the enemy. */
const LANDED = 0.6;

function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
