/**
 * Keeps the nameplates and health badges under the cards on the table clear of each other where the cards stand closer
 * together than their plates are wide: a block of minions on a phone (Klaw's encounter deck brings five), two allies
 * side by side, a badge beside a pile's count. A plate already clear of its neighbours never moves, so a table with
 * room (a tablet, a desktop) looks exactly as it did.
 *
 * Plates along a row are first eased apart sideways, by as little as it takes, as long as every plate stays under its
 * own card. Where the cards are too narrow for that (three minions a phone shows a few pixels wide each), a plate that
 * cannot stay on the row steps down onto a second line below its neighbours, or up if the space below is taken, and the
 * plates on each line are eased apart the same way.
 */

export interface Plate {
  /** The card the plate belongs to (or the pile's count). */
  id: string;
  /** Where the plate's middle stands, across. */
  x: number;
  /** The plate's top edge. */
  top: number;
  width: number;
  height: number;
  /** The card's edges on screen: the plate's middle stays between them. */
  cardLeft: number;
  cardRight: number;
  /** Eases sideways but never steps to another line (a pile's count, its pile right below it). */
  keepsLine?: boolean;
  /** Stays put while its neighbours make way (a pile's count whose pile is not on the table). */
  pinned?: boolean;
}

/** Something a plate stepping off its row must not land on: another card, a pile's count. */
export interface Obstacle {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** The card this is, if it is one: never in its own plate's way. */
  id?: string;
}

export interface PlateShift {
  dx: number;
  dy: number;
}

/** The clear space kept between two plates. */
export const PLATE_GAP = 3;
/** The most lines a crowded row of plates is shared across. */
const MAX_LINES = 3;
/** How much more a pinned plate weighs than one that can make way, when a run of them is eased apart. */
const PINNED = 1000;

interface Item {
  plate: Plate;
  /** Where it wants its middle. */
  want: number;
}

/**
 * The middles that keep each plate `PLATE_GAP` clear of the next, moving them as little as possible in all (a pinned
 * plate counts for many). A run of plates that would overlap moves as one block (`items` are in order across).
 */
function easeApart(items: readonly Item[]): number[] {
  const blocks: { first: number; last: number; centre: number }[] = [];
  // A block's plates sit edge to edge: each one's distance from the block's first plate's middle.
  const offset: number[] = [];
  items.forEach((item, i) => {
    offset[i] = i ? offset[i - 1]! + (items[i - 1]!.plate.width + item.plate.width) / 2 + PLATE_GAP : 0;
  });
  const centreOf = (first: number, last: number) => {
    let sum = 0;
    let weights = 0;
    for (let i = first; i <= last; i++) {
      const weight = items[i]!.plate.pinned ? PINNED : 1;
      sum += weight * (items[i]!.want - (offset[i]! - offset[first]!));
      weights += weight;
    }
    return sum / weights;
  };
  items.forEach((_, i) => {
    blocks.push({ first: i, last: i, centre: items[i]!.want });
    while (blocks.length > 1) {
      const block = blocks[blocks.length - 1]!;
      const before = blocks[blocks.length - 2]!;
      const needed = before.centre + (offset[block.first]! - offset[before.first]!);
      if (block.centre >= needed) break;
      blocks.pop();
      before.last = block.last;
      before.centre = centreOf(before.first, before.last);
    }
  });
  const middles: number[] = [];
  for (const block of blocks)
    for (let i = block.first; i <= block.last; i++) middles[i] = block.centre + offset[i]! - offset[block.first]!;
  return middles;
}

/** Whether every plate's middle still stands over its own card (a pinned one, within a pixel of where it was). */
const underCards = (items: readonly Item[], middles: readonly number[]) =>
  items.every(({ plate, want }, i) =>
    plate.pinned
      ? Math.abs(middles[i]! - want) < 1
      : middles[i]! >= plate.cardLeft - 0.5 && middles[i]! <= plate.cardRight + 0.5,
  );

const overlapArea = (a: Obstacle, b: Obstacle) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const across = (items: readonly Item[]) => [...items].sort((a, b) => a.want - b.want);

/**
 * How far to move each plate so none overlaps another; plates that need not move are left out. `obstacles` matter
 * only to a plate stepping off its row: one on the row stays where its card puts it.
 */
export function spreadPlates(plates: readonly Plate[], obstacles: readonly Obstacle[] = []): Map<string, PlateShift> {
  const shifts = new Map<string, PlateShift>();
  // Rows: plates level enough with the row's first to touch it. Ties keep the order given, so a plate's line doesn't
  // swap from one frame to the next while two cards pass.
  const rows: Plate[][] = [];
  const byTop = plates.map((plate, i) => ({ plate, i })).sort((a, b) => a.plate.top - b.plate.top || a.i - b.i);
  for (const { plate } of byTop) {
    const row = rows[rows.length - 1];
    if (row && plate.top - row[0]!.top < row[0]!.height) row.push(plate);
    else rows.push([plate]);
  }
  const boxOf = (plate: Plate): Obstacle => {
    const shift = shifts.get(plate.id) ?? { dx: 0, dy: 0 };
    const left = plate.x + shift.dx - plate.width / 2;
    const top = plate.top + shift.dy;
    return { left, right: left + plate.width, top, bottom: top + plate.height, id: plate.id };
  };
  for (const row of rows) {
    if (row.length < 2) continue;
    const items = across(row.map((plate) => ({ plate, want: plate.x })));
    // Across the row, each plate takes the first line where it and the plates already there can be eased apart under
    // their own cards: the row itself while the cards leave room, else a line below (or above). Plates that keep
    // their line are on the row before any other.
    const lines: Item[][] = [items.filter(({ plate }) => plate.keepsLine || plate.pinned)];
    for (const item of items) {
      if (item.plate.keepsLine || item.plate.pinned) continue;
      const line = lines.find((on) => {
        const tried = across([...on, item]);
        return underCards(tried, easeApart(tried));
      });
      if (line) line.push(item);
      else if (lines.length < MAX_LINES) lines.push([item]);
      else lines[lines.length - 1]!.push(item);
    }
    // A line below is as far down as the plates that step onto it are tall.
    const step =
      Math.max(
        ...lines
          .slice(1)
          .flat()
          .map(({ plate }) => plate.height),
        0,
      ) + PLATE_GAP;
    // Each line stands a plate's height past the last, and past anything on the lines before it that it would touch
    // (a pile's count is taller than a badge).
    const placed = (direction: 1 | -1) => {
      const moves: { plate: Plate; dx: number; dy: number }[] = [];
      lines.forEach((line, n) => {
        const on = across(line);
        const middles = easeApart(on);
        on.forEach(({ plate }, i) => {
          const left = middles[i]! - plate.width / 2;
          const right = left + plate.width;
          let dy = direction * n * step;
          for (const before of moves) {
            const beforeLeft = before.plate.x + before.dx - before.plate.width / 2;
            if (!n || beforeLeft >= right + PLATE_GAP || beforeLeft + before.plate.width + PLATE_GAP <= left) continue;
            const top = before.plate.top + before.dy;
            dy =
              direction > 0
                ? Math.max(dy, top + before.plate.height + PLATE_GAP - plate.top)
                : Math.min(dy, top - PLATE_GAP - plate.height - plate.top);
          }
          moves.push({ plate, dx: middles[i]! - plate.x, dy });
        });
      });
      return moves;
    };
    const down = placed(1);
    // Below the row, unless that lands on more of the table than above it does.
    let moves = down;
    if (lines.length > 1) {
      const others = [...obstacles, ...plates.filter((plate) => !row.includes(plate)).map(boxOf)];
      const cost = (moves: ReturnType<typeof placed>) =>
        moves.reduce((total, { plate, dx, dy }) => {
          if (!dy) return total;
          const left = plate.x + dx - plate.width / 2;
          const box = { left, right: left + plate.width, top: plate.top + dy, bottom: plate.top + dy + plate.height };
          return total + others.reduce((sum, o) => (o.id === plate.id ? sum : sum + overlapArea(box, o)), 0);
        }, 0);
      const up = placed(-1);
      if (cost(up) < cost(down)) moves = up;
    }
    for (const { plate, dx, dy } of moves)
      if (Math.abs(dx) >= 0.5 || dy) shifts.set(plate.id, { dx: Math.abs(dx) >= 0.5 ? dx : 0, dy });
  }
  return shifts;
}
