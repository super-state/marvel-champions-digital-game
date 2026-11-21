/**
 * Where the controller's focus goes on the battle table: one step with the D-pad, a jump between zones with the
 * bumpers, and the place to start when the focus has nowhere to be.
 *
 * Pure over rects, so the rules are tested without a page (`pad-nav.test.ts`); `controller.ts` gathers the stops from
 * the page (the cards' own buttons, the turn bar, the corners) and focuses what this picks. Moving uses the same
 * on-screen rule as the classic board (`view/spatial-nav.ts`, issue #206): the nearest stop that way, never wrapping.
 */

import type { Rect } from "./spatial.js";
import { spatialPick, type FocusDirection, type SpatialCandidate } from "./spatial.js";

/** The table's areas, bottom to top as the bumpers walk them, then the turn controls. */
export type PadZone = "hand" | "player" | "villain" | "turn";
export const PAD_ZONES: readonly PadZone[] = ["hand", "player", "villain", "turn"];

/**
 * How strongly a stop asks to be where the focus starts (`homeStop`): the question being asked first, then what
 * answers it, then the hand. Zero never starts there (End Turn: a turn never ends from a focus that landed by itself).
 */
export const HOME = {
  dialog: 100,
  reveal: 95,
  cardMenu: 90,
  /** The bar's gold button while the game waits on exactly it (Keep hand, Play, Defend, Use it). */
  attention: 80,
  option: 70,
  target: 60,
  spend: 50,
  primary: 45,
  playable: 40,
  hand: 30,
  hero: 25,
  /** The villain: where its zone starts (the bumpers), below the hero for a focus with nowhere to be. */
  villain: 22,
  answer: 20,
  card: 10,
  control: 5,
  never: 0,
} as const;

export interface PadStop<K> {
  readonly key: K;
  /** Where it is on screen, in viewport pixels: a card's own outline box, not its nameplate's. */
  readonly rect: Rect;
  readonly zone: PadZone;
  /** `HOME`: how strongly the focus starts here. */
  readonly home: number;
}

/**
 * The stop one D-pad press moves to from `current`, or null when nothing lies that way (the focus stays put). Off to
 * one side of its column (End Turn in its corner, a scheme beside the villain), a stop is still reached when nothing
 * sits squarely that way.
 */
export function moveFocus<K>(stops: readonly PadStop<K>[], current: K, direction: FocusDirection): K | null {
  const from = stops.find((stop) => stop.key === current);
  if (!from) return null;
  const others: SpatialCandidate<K>[] = stops
    .filter((stop) => stop.key !== current)
    .map((stop) => ({ key: stop.key, rect: stop.rect }));
  // The wider search only takes stops wholly past this one's edge: a scheme whose middle sits a little higher than the
  // villain's beside it is not "up" from the villain.
  const past = others.filter((other) => beyondEdge(other.rect, from.rect, direction));
  return spatialPick(others, from.rect, direction) ?? spatialPick(past, from.rect, direction, true);
}

/** The middle of `rect` lies past `from`'s edge in that direction. */
function beyondEdge(rect: Rect, from: Rect, direction: FocusDirection): boolean {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  if (direction === "up") return y < from.y;
  if (direction === "down") return y > from.y + from.height;
  if (direction === "left") return x < from.x;
  return x > from.x + from.width;
}

/**
 * Where the focus starts when it has nowhere to be: the stop that asks most (`HOME`), ties going to the one furthest
 * left, then highest, so a hand starts at its first card. Null when nothing may start (only End Turn is left).
 */
export function homeStop<K>(stops: readonly PadStop<K>[]): K | null {
  let best: PadStop<K> | null = null;
  for (const stop of stops) {
    if (stop.home <= HOME.never) continue;
    if (
      !best ||
      stop.home > best.home ||
      (stop.home === best.home &&
        (stop.rect.x < best.rect.x - 0.5 || (Math.abs(stop.rect.x - best.rect.x) <= 0.5 && stop.rect.y < best.rect.y)))
    )
      best = stop;
  }
  return best?.key ?? null;
}

/**
 * A bumper press: the next zone that way with somewhere to start (wrapping), at the stop the focus last had there
 * while it is still on the table, else that zone's own home. A bumper never lands on a stop that may not start (End
 * Turn): a zone holding only that is passed over, and a remembered one is ignored. From outside every zone, RB starts
 * at the hand and LB at the turn controls.
 */
export function jumpZone<K>(
  stops: readonly PadStop<K>[],
  current: K | null,
  step: 1 | -1,
  remembered: (zone: PadZone) => K | undefined,
): K | null {
  const zoneNow = stops.find((stop) => stop.key === current)?.zone;
  const start = zoneNow === undefined ? (step === 1 ? -1 : 0) : PAD_ZONES.indexOf(zoneNow);
  for (let turn = 1; turn <= PAD_ZONES.length; turn++) {
    const zone = PAD_ZONES[(((start + step * turn) % PAD_ZONES.length) + PAD_ZONES.length) % PAD_ZONES.length]!;
    if (zone === zoneNow) continue;
    const members = stops.filter((stop) => stop.zone === zone && stop.home > HOME.never);
    if (!members.length) continue;
    const kept = remembered(zone);
    if (kept !== undefined && members.some((stop) => stop.key === kept)) return kept;
    return homeStop(members);
  }
  return null;
}
