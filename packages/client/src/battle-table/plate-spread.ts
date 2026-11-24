/**
 * Keeps the nameplates and health badges under the cards on the table clear of each other where the cards stand closer
 * together than their plates are wide: a block of minions on a phone (Klaw's encounter deck brings five), two allies
 * side by side, a badge beside a pile's count. On a row where every plate already stands `PLATE_GAP` or more clear of
 * its neighbours nothing moves, so a table with room (a tablet, a desktop) looks exactly as it did; elsewhere a plate
 * moves only as far as the ones crowding it need.
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
/** Slack for comparing positions worked out in fractions of a pixel, so a plate exactly in reach isn't turned away. */
const SLACK = 0.01;

interface Item {
  plate: Plate;
  /** Where it wants its middle. */
  want: number;
}

/** Where a plate's middle may go: over its card, or where it is if it is pinned. */
const rangeOf = ({ plate, want }: Item): [number, number] =>
  plate.pinned ? [want, want] : [Math.min(plate.cardLeft, want), Math.max(plate.cardRight, want)];

/** The least distance between two neighbours' middles. */
const spacing = (a: Item, b: Item) => (a.plate.width + b.plate.width) / 2 + PLATE_GAP;

/** Plates that stay where they stand, those that touch merged into one pinned block covering them all. */
function heldTogether(items: readonly Item[]): Item[] {
  const blocks: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const { plate } of across(items)) {
    const left = plate.x - plate.width / 2;
    const right = left + plate.width;
    const last = blocks[blocks.length - 1];
    if (last && left < last.right + PLATE_GAP) {
      last.right = Math.max(last.right, right);
      last.top = Math.min(last.top, plate.top);
      last.bottom = Math.max(last.bottom, plate.top + plate.height);
    } else blocks.push({ left, right, top: plate.top, bottom: plate.top + plate.height });
  }
  return blocks.map(({ left, right, top, bottom }) => {
    const x = (left + right) / 2;
    const plate = {
      id: "",
      x,
      top,
      width: right - left,
      height: bottom - top,
      cardLeft: x,
      cardRight: x,
      pinned: true,
    };
    return { plate, want: x };
  });
}

/**
 * The middles that keep each plate `PLATE_GAP` clear of the next, each within its range (`rangeOf`), moving them as
 * little as it takes; null if no such middles exist. `items` are in order across.
 *
 * A run of plates that would overlap first moves as one block centred where its plates want to be; whatever that puts
 * outside its range is brought back in, and its neighbours pushed along from there, one way across and then back.
 */
function easeApart(items: readonly Item[]): number[] | null {
  const blocks: { first: number; last: number; centre: number }[] = [];
  // A block's plates sit edge to edge: each one's distance from the block's first plate's middle.
  const offset: number[] = [];
  items.forEach((item, i) => {
    offset[i] = i ? offset[i - 1]! + spacing(items[i - 1]!, item) : 0;
  });
  const centreOf = (first: number, last: number) => {
    let sum = 0;
    for (let i = first; i <= last; i++) sum += items[i]!.want - (offset[i]! - offset[first]!);
    return sum / (last - first + 1);
  };
  items.forEach((_, i) => {
    blocks.push({ first: i, last: i, centre: items[i]!.want });
    while (blocks.length > 1) {
      const block = blocks[blocks.length - 1]!;
      const before = blocks[blocks.length - 2]!;
      if (block.centre >= before.centre + (offset[block.first]! - offset[before.first]!)) break;
      blocks.pop();
      before.last = block.last;
      before.centre = centreOf(before.first, before.last);
    }
  });
  const middles: number[] = [];
  for (const block of blocks)
    for (let i = block.first; i <= block.last; i++) middles[i] = block.centre + offset[i]! - offset[block.first]!;
  // Into range, then pushed along: right across the row, then back left. What still falls short of its range can't
  // be helped on one line.
  const ranges = items.map(rangeOf);
  middles.forEach((middle, i) => {
    const [low, high] = ranges[i]!;
    middles[i] = Math.min(high, Math.max(low, middle));
    if (i) middles[i] = Math.max(middles[i]!, middles[i - 1]! + spacing(items[i - 1]!, items[i]!));
  });
  for (let i = middles.length - 1; i >= 0; i--) {
    middles[i] = Math.min(middles[i]!, ranges[i]![1]);
    if (i < middles.length - 1) middles[i] = Math.min(middles[i]!, middles[i + 1]! - spacing(items[i]!, items[i + 1]!));
  }
  return middles.every((middle, i) => middle >= ranges[i]![0] - SLACK) ? middles : null;
}

const overlapArea = (a: Obstacle, b: Obstacle) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const across = (items: readonly Item[]) => [...items].sort((a, b) => a.want - b.want);

/**
 * How far to move each plate so none overlaps another; plates that need not move are left out. `obstacles` (the cards
 * on the table) matter only to a plate stepping off its row, which also keeps clear of the other rows' plates.
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
    // The plates that keep their line are on the row first. Should they not fit among themselves, they stay where
    // they stand, and those that touch are held as one block the badges keep clear of.
    const staying = items.filter(({ plate }) => plate.keepsLine || plate.pinned);
    const stayingFit = staying.length < 2 || !!easeApart(staying);
    // Across the row, each other plate takes the first line where it and the plates already there can be eased apart
    // under their own cards: the row itself while the cards leave room, else a line below (or above).
    const lines: Item[][] = [stayingFit ? staying : heldTogether(staying)];
    for (const item of items) {
      if (staying.includes(item)) continue;
      const line = lines.find((on) => !!easeApart(across([...on, item])));
      if (line) line.push(item);
      else if (lines.length < MAX_LINES) lines.push([item]);
      else lines[lines.length - 1]!.push(item);
    }
    const otherPlates = plates.filter((plate) => !row.includes(plate));
    // A line below is as far down as the plates that step onto it are tall, and further still past anything it would
    // touch on the lines before it (a pile's count is taller than a badge) or on another row.
    const step =
      Math.max(
        ...lines
          .slice(1)
          .flat()
          .map(({ plate }) => plate.height),
        0,
      ) + PLATE_GAP;
    const placed = (direction: 1 | -1) => {
      const moves: { plate: Plate; dx: number; dy: number; line: number }[] = [];
      lines.forEach((line, n) => {
        const on = across(line);
        // A line that can't be eased apart within its cards (the last line of a very crowded row) stays as it is.
        const middles = easeApart(on) ?? on.map(({ want }) => want);
        const here = on.map(({ plate }, i) => {
          const left = middles[i]! - plate.width / 2;
          const right = left + plate.width;
          let dy = direction * n * step;
          if (n) {
            const before = [
              ...moves.filter((move) => move.line < n),
              ...otherPlates.map((plate) => ({ plate, ...(shifts.get(plate.id) ?? { dx: 0, dy: 0 }) })),
            ];
            // Nearest first, so a plate pushed past one is then checked against the next.
            before.sort((a, b) => direction * (a.plate.top + a.dy - (b.plate.top + b.dy)));
            for (const other of before) {
              const otherLeft = other.plate.x + other.dx - other.plate.width / 2;
              const otherRight = otherLeft + other.plate.width;
              if (otherLeft + SLACK >= right + PLATE_GAP || otherRight + PLATE_GAP <= left + SLACK) continue;
              const top = other.plate.top + other.dy;
              const bottom = top + other.plate.height;
              const myTop = plate.top + dy;
              if (top + SLACK >= myTop + plate.height + PLATE_GAP || bottom + PLATE_GAP <= myTop + SLACK) continue;
              dy = direction > 0 ? bottom + PLATE_GAP - plate.top : top - PLATE_GAP - plate.height - plate.top;
            }
          }
          return { plate, dx: middles[i]! - plate.x, dy, line: n };
        });
        moves.push(...here);
      });
      return moves;
    };
    const down = placed(1);
    // Below the row, unless that lands on more of the table than above it does.
    let moves = down;
    if (lines.length > 1) {
      const others = [...obstacles, ...otherPlates.map(boxOf)];
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
      if (!plate.pinned && (Math.abs(dx) >= 0.5 || dy)) shifts.set(plate.id, { dx: Math.abs(dx) >= 0.5 ? dx : 0, dy });
  }
  return shifts;
}
