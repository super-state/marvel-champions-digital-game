import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { groupFiles, pickVariant, SoundBoard, soundNameOf, sfx } from "./sound.js";

describe("sound files", () => {
  test("a numbered file belongs to the sound it is named for", () => {
    expect(soundNameOf("./sfx/hit-3.mp3")).toBe("hit");
    expect(soundNameOf("./sfx/hit-heavy-12.mp3")).toBe("hit-heavy");
    expect(soundNameOf("./sfx/phase-villain-1.mp3")).toBe("phase-villain");
  });

  test("variants are grouped in number order", () => {
    const groups = groupFiles({
      "./sfx/hit-10.mp3": "c",
      "./sfx/hit-2.mp3": "b",
      "./sfx/hit-1.mp3": "a",
      "./sfx/win-1.mp3": "w",
    });
    expect(groups.get("hit")).toEqual(["a", "b", "c"]);
    expect(groups.get("win")).toEqual(["w"]);
  });

  test("every sound the table plays has a file", () => {
    for (const name of [
      "draw",
      "deal",
      "place",
      "play",
      "flip",
      "turn",
      "discard",
      "shuffle",
      "whoosh",
      "whoosh-big",
      "hit",
      "hit-heavy",
      "block",
      "threat",
      "thwart",
      "heal",
      "status",
      "defeat",
      "boom",
      "surge",
      "boost",
      "phase-hero",
      "phase-villain",
      "win",
      "lose",
      "select",
      "confirm",
      "error",
    ])
      expect(sfx.names(), name).toContain(name);
  });
});

describe("picking a variant", () => {
  test("never the one played last, when there is another", () => {
    for (let last = 0; last < 4; last++)
      for (const r of [0, 0.3, 0.6, 0.99]) {
        const pick = pickVariant(4, last, () => r);
        expect(pick).not.toBe(last);
        expect(pick).toBeGreaterThanOrEqual(0);
        expect(pick).toBeLessThan(4);
      }
  });

  test("a sound with one file always plays it", () => {
    expect(pickVariant(1, 0, () => 0.7)).toBe(0);
  });
});

describe("the sound board", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });
  afterEach(() => {
    globalThis.__battleSounds = undefined;
    vi.unstubAllGlobals();
  });

  const files = { "./sfx/hit-1.mp3": "a", "./sfx/hit-2.mp3": "b", "./sfx/draw-1.mp3": "c" };

  test("under automation it plays nothing and writes down what it would have played", () => {
    const board = new SoundBoard(files, { automated: true });
    board.play("hit");
    board.play("draw", { delay: 180 });
    expect(globalThis.__battleSounds?.map((s) => s.name)).toEqual(["hit", "draw"]);
  });

  test("the same sound twice at once is heard once; spaced apart, both are", () => {
    const board = new SoundBoard(files, { automated: true });
    board.play("draw");
    board.play("draw");
    board.play("draw", { delay: 180 });
    board.play("draw", { delay: 360 });
    expect(globalThis.__battleSounds?.map((s) => s.delay)).toEqual([0, 180, 360]);
  });

  test("turned off, it stays silent, and the choice is remembered", () => {
    const board = new SoundBoard(files, { automated: true });
    board.enabled = false;
    board.play("hit");
    expect(globalThis.__battleSounds).toBeUndefined();
    expect(new SoundBoard(files, { automated: true }).enabled).toBe(false);
  });

  test("a sound with no file is ignored", () => {
    const board = new SoundBoard(files, { automated: true });
    board.play("win");
    expect(globalThis.__battleSounds).toBeUndefined();
  });

  test("with no Web Audio (unlock does nothing), playing is a silent no-op", () => {
    const board = new SoundBoard(files);
    board.unlock();
    expect(() => board.play("hit")).not.toThrow();
  });
});
