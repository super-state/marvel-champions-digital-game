import { describe, expect, it } from "vitest";
import { HOME, homeStop, jumpZone, moveFocus, type PadStop, type PadZone } from "./nav.js";

/** A 1280 x 720 table: the villain's row at the top, the hero's row in the middle, the hand at the bottom. */
const stop = (key: string, x: number, y: number, zone: PadZone, home: number = HOME.card, w = 90, h = 125) =>
  ({ key, rect: { x, y, width: w, height: h }, zone, home }) satisfies PadStop<string>;

const TABLE: PadStop<string>[] = [
  stop("rhino", 560, 60, "villain", HOME.villain),
  stop("scheme", 760, 70, "villain", HOME.card, 125, 90),
  stop("minion", 380, 60, "villain"),
  stop("hero", 560, 300, "player", HOME.hero),
  stop("web-shooter", 700, 310, "player"),
  stop("hand-1", 380, 560, "hand", HOME.hand),
  stop("hand-2", 450, 560, "hand", HOME.playable),
  stop("hand-3", 520, 560, "hand", HOME.playable),
  stop("hand-4", 590, 560, "hand", HOME.hand),
  stop("undo", 20, 660, "turn", HOME.control, 44, 44),
  stop("end-turn", 1130, 660, "turn", HOME.never, 130, 44),
];

describe("moveFocus", () => {
  it("walks a row of hand cards with Left and Right", () => {
    expect(moveFocus(TABLE, "hand-2", "right")).toBe("hand-3");
    expect(moveFocus(TABLE, "hand-2", "left")).toBe("hand-1");
  });

  it("goes up from the hand to the hero's row, and up again to the villain's", () => {
    expect(moveFocus(TABLE, "hand-3", "up")).toBe("hero");
    expect(moveFocus(TABLE, "hero", "up")).toBe("rhino");
    expect(moveFocus(TABLE, "rhino", "down")).toBe("hero");
  });

  it("reaches a control off to the side when nothing lies squarely that way", () => {
    // Nothing is right of the last hand card within the cone except End Turn, low in its corner.
    expect(moveFocus(TABLE, "hand-4", "right")).toBe("end-turn");
    expect(moveFocus(TABLE, "hand-1", "left")).toBe("undo");
  });

  it("reaches a stop far off to one side only when nothing lies within the cone, and only past the edge", () => {
    const corner = [stop("a", 0, 0, "hand", HOME.hand, 10, 10), stop("b", 100, 300, "turn", HOME.control, 10, 10)];
    expect(moveFocus(corner, "a", "right")).toBe("b");
    expect(moveFocus(corner, "a", "down")).toBe("b");
    expect(moveFocus(corner, "b", "up")).toBe("a");
  });

  it("stays put at the edge of the table, and from a stop it doesn't know", () => {
    expect(moveFocus(TABLE, "rhino", "up")).toBeNull();
    expect(moveFocus(TABLE, "gone", "up")).toBeNull();
  });
});

describe("homeStop", () => {
  it("starts at the first playable card when nothing is asked", () => {
    expect(homeStop(TABLE)).toBe("hand-2");
  });

  it("starts at the question being asked before anything on the table", () => {
    const asking = [...TABLE, stop("keep-hand", 600, 480, "turn", HOME.attention, 140, 44)];
    expect(homeStop(asking)).toBe("keep-hand");
    const targets = [...TABLE, stop("minion-target", 380, 60, "villain", HOME.target)];
    expect(homeStop(targets)).toBe("minion-target");
  });

  it("never starts on End Turn, even when it is all there is", () => {
    expect(homeStop([stop("end-turn", 1130, 660, "turn", HOME.never)])).toBeNull();
  });

  it("breaks a tie by going furthest left, then highest", () => {
    const tied = [stop("b", 300, 100, "hand", HOME.hand), stop("a", 100, 400, "hand", HOME.hand)];
    expect(homeStop(tied)).toBe("a");
  });
});

describe("jumpZone", () => {
  const none = () => undefined;

  it("walks the zones bottom to top with RB, wrapping round to the hand", () => {
    expect(jumpZone(TABLE, "hand-1", 1, none)).toBe("hero");
    expect(jumpZone(TABLE, "hero", 1, none)).toBe("rhino");
    expect(jumpZone(TABLE, "rhino", 1, none)).toBe("undo");
    expect(jumpZone(TABLE, "undo", 1, none)).toBe("hand-2");
  });

  it("walks them the other way with LB", () => {
    expect(jumpZone(TABLE, "hand-1", -1, none)).toBe("undo");
    expect(jumpZone(TABLE, "rhino", -1, none)).toBe("hero");
  });

  it("returns to the stop last focused in a zone while it is still there", () => {
    const remembered = (zone: PadZone) => (zone === "hand" ? "hand-4" : zone === "villain" ? "gone" : undefined);
    expect(jumpZone(TABLE, "hero", -1, remembered)).toBe("hand-4");
    expect(jumpZone(TABLE, "hero", 1, remembered)).toBe("rhino");
  });

  it("skips an empty zone, and starts at the hand (RB) or the turn controls (LB) from outside every zone", () => {
    const noPlayer = TABLE.filter((s) => s.zone !== "player");
    expect(jumpZone(noPlayer, "hand-1", 1, none)).toBe("rhino");
    expect(jumpZone(TABLE, null, 1, none)).toBe("hand-2");
    expect(jumpZone(TABLE, null, -1, none)).toBe("undo");
  });

  it("never lands on End Turn: a zone holding only it is passed over", () => {
    const onlyEndTurn = [stop("hero", 560, 300, "player", HOME.hero), stop("end-turn", 1130, 660, "turn", HOME.never)];
    expect(jumpZone(onlyEndTurn, "hero", -1, none)).toBeNull();
    expect(jumpZone(onlyEndTurn, "hero", 1, none)).toBeNull();
  });

  it("never returns to a remembered End Turn, going to the zone's own start instead", () => {
    expect(jumpZone(TABLE, "hand-1", -1, (zone) => (zone === "turn" ? "end-turn" : undefined))).toBe("undo");
  });
});
