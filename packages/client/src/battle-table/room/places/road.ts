/**
 * The road (room plan, "The road", Adam 2026-11-27): Campaign is one long progression through the boxes in release
 * order. Only its prologue is on the table today: the Core Set, which has no printed campaign, so ours stands in:
 * Rhino, then Klaw, then Ultron on Standard, then the same three on Expert. Beating the three on Standard also brings
 * the road to the first chapter (The Rise of Red Skull) and the side stories that came out after it.
 *
 * Nothing new is stored: where a player stands is read from what is already kept.
 *   - A Standard step is open when the room's lock says its villain is (`play.host.lock`, which is `unlockedFrom` on
 *     the test site and on Adam's table seen as a friend), and beaten by any win against its villain, in any mode or
 *     difficulty (Adam's call 5: any win opens the next villain).
 *   - An Expert step is open once all three are beaten on Standard and the Expert step before it is beaten; beaten by a
 *     win on Expert. A game saved before the record kept its difficulty (`facts: null`) was Standard: the table dealt
 *     nothing else then.
 *
 * Only the next step is played from Campaign; a beaten one is replayed in Free Play. Adam's own table has everything
 * open (`allOpen`, call 4), as does a player whose games aren't saved: every step can be played, still ticked where
 * beaten and marked where next.
 */
import type { Difficulty, VillainId } from "../../model.js";
import type { FinishedGame } from "../../record/game.js";
import { SHELF_PRODUCTS, type ShelfProduct } from "./scenario-catalogue.js";

export interface RoadStep {
  /** Unique on the road: the scenario's id, with `:expert` on the Expert half (`rhino`, `rhino:expert`). */
  readonly key: string;
  /** `@mc/content`'s scenario id, as on the shelf. */
  readonly scenario: string;
  readonly villain: VillainId;
  readonly difficulty: Difficulty;
  /** As the shelf's list shows it. */
  readonly name: string;
}

const CORE: readonly { villain: VillainId; name: string }[] = [
  { villain: "rhino", name: "Rhino" },
  { villain: "klaw", name: "Klaw" },
  { villain: "ultron", name: "Ultron" },
];

/** The prologue, in order: the three on Standard, then the three on Expert. */
export const PROLOGUE: readonly RoadStep[] = [
  ...CORE.map(({ villain, name }) => ({
    key: villain,
    scenario: villain,
    villain,
    difficulty: "standard" as const,
    name,
  })),
  ...CORE.map(({ villain, name }) => ({
    key: `${villain}:expert`,
    scenario: villain,
    villain,
    difficulty: "expert" as const,
    name: `${name} · Expert`,
  })),
];

/** beaten: ticked. next: lit, what Play deals. open: playable on an all-open table. locked: not reached yet. */
export type StepStatus = "beaten" | "next" | "open" | "locked";

export interface StepState {
  readonly step: RoadStep;
  readonly status: StepStatus;
  /** Campaign deals it: the next step, or any step on an all-open table. */
  readonly playable: boolean;
  /** The line under its name ("Next on the road", "Beat Rhino first"). */
  readonly line: string;
}

export interface Road {
  readonly steps: readonly StepState[];
  /** The next step, or null once all six are beaten. */
  readonly next: RoadStep | null;
  /** All three beaten on Standard: Expert and the first chapter are reached. */
  readonly standardDone: boolean;
  /** Everything playable (Adam's own table, or no saved record). */
  readonly allOpen: boolean;
}

export type RoadGame = Pick<FinishedGame, "villain" | "result" | "facts">;

export interface RoadInput {
  /** The player's finished games; null when nothing is saved for them. */
  readonly games: readonly RoadGame[] | null;
  /** Why a villain is still sealed, or null when it is open (the room's lock). */
  readonly lock: (villain: VillainId) => string | null;
  /** Adam's own table: everything open. */
  readonly allOpen: boolean;
}

const difficultyOf = (game: RoadGame): Difficulty => game.facts?.difficulty ?? "standard";

export function roadFrom({ games, lock, allOpen }: RoadInput): Road {
  const everything = allOpen || games === null;
  const wins = (games ?? []).filter((game) => game.result === "win");
  const beatenAny = new Set(wins.map((game) => game.villain));
  const beatenExpert = new Set(wins.filter((game) => difficultyOf(game) === "expert").map((game) => game.villain));
  const beaten = (step: RoadStep) =>
    step.difficulty === "expert" ? beatenExpert.has(step.villain) : beatenAny.has(step.villain);
  const standardDone = CORE.every(({ villain }) => beatenAny.has(villain));

  /** Why a step isn't reached yet, or null when it is. */
  const reachedOrWhy = (step: RoadStep, index: number): string | null => {
    const before = index % CORE.length ? CORE[(index % CORE.length) - 1]! : null;
    if (step.difficulty === "standard") {
      const why = lock(step.villain);
      if (why) return why;
      return before && !beatenAny.has(before.villain) ? `Beat ${before.name} first` : null;
    }
    if (!standardDone) return "Beat all three on Standard first";
    return before && !beatenExpert.has(before.villain) ? `Beat ${before.name} on Expert first` : null;
  };

  let next: RoadStep | null = null;
  const steps = PROLOGUE.map((step, index): StepState => {
    if (beaten(step)) {
      return {
        step,
        status: "beaten",
        playable: everything,
        line: everything ? "Beaten" : "Beaten · play it again in Free Play",
      };
    }
    const why = reachedOrWhy(step, index);
    if (!next && !why) {
      next = step;
      return { step, status: "next", playable: true, line: "Next on the road" };
    }
    if (everything) return { step, status: "open", playable: true, line: "" };
    return { step, status: "locked", playable: false, line: why ?? "Locked" };
  });
  return { steps, next, standardDone, allOpen: everything };
}

// ── Boxes on the road ─────────────────────────────────────────────────────────────────────────────────────────────

/** The big box each box comes after on the road: a chapter's previous chapter, a side story's box before it. */
function boxBefore(product: ShelfProduct): ShelfProduct | null {
  const at = SHELF_PRODUCTS.indexOf(product);
  for (let i = at - 1; i >= 0; i--) if (SHELF_PRODUCTS[i]!.size === "big") return SHELF_PRODUCTS[i]!;
  return null;
}

/**
 * Why the road hasn't reached a box yet, or null when it has. The Core Set is where it starts; the first chapter is
 * reached by the prologue's three on Standard; a later chapter by finishing the one before (none can be finished on
 * the table yet). A side story (a scenario pack) is reached with the box it came out after.
 */
export function boxLock(product: ShelfProduct, road: Pick<Road, "standardDone" | "allOpen">): string | null {
  if (road.allOpen || product.code === "core") return null;
  const before = boxBefore(product);
  if (!before) return null;
  if (product.size === "small") {
    // A side story opens once the road reaches the box it came out after.
    const beforeLock = boxLock(before, road);
    return beforeLock === null ? null : `Opens when the road reaches ${before.name}`;
  }
  if (before.code === "core") return road.standardDone ? null : "Beat Rhino, Klaw and Ultron to reach it";
  return `Finish ${before.name} to reach it`;
}
