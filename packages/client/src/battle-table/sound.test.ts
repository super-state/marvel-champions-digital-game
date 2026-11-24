import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { impulseResponse, manifestFromFiles, regionOf, scheduleOf, tailOf, type SoundManifest } from "./sound-edit.js";
import { SOUND_NAMES } from "./sound-moments.js";
import { BUNDLED_MANIFEST, pickVariant, resolveSound, SoundBoard, sfx } from "./sound.js";

describe("the bundled sounds", () => {
  test("every moment the table plays has a file, unless the studio's shipped edits made it silent", () => {
    for (const name of SOUND_NAMES) {
      // Switched off in the Sound Studio and shipped that way (Adam, 2026-11-24): an empty list, on purpose.
      if (BUNDLED_MANIFEST.sounds[name]?.length === 0) continue;
      expect(sfx.names(), name).toContain(name);
    }
  });

  test("every variant's file resolves to an address", () => {
    for (const variants of Object.values(BUNDLED_MANIFEST.sounds))
      for (const variant of variants) expect(resolveSound(variant.file), variant.file).toBeTruthy();
  });

  test("numbered files group by name, in number order", () => {
    const manifest = manifestFromFiles(["hit-10.mp3", "hit-2.mp3", "hit-1.mp3", "win-1.mp3"]);
    expect(manifest.sounds.hit!.map((v) => v.file)).toEqual(["hit-1.mp3", "hit-2.mp3", "hit-10.mp3"]);
    expect(manifest.sounds.win).toEqual([{ file: "win-1.mp3" }]);
  });

  test("studio and library files go through the dev server", () => {
    expect(resolveSound("studio:abc.mp3")).toBe("/__studio/staged/abc.mp3");
    expect(resolveSound("lib:E:\\Samples\\hit.wav")).toBe("/__studio/file?path=E%3A%5CSamples%5Chit.wav");
  });
});

describe("cutting and shaping a sound", () => {
  test("the region is kept inside the file", () => {
    expect(regionOf({ file: "x", start: -1, end: 9 }, 2)).toEqual({ start: 0, end: 2 });
    expect(regionOf({ file: "x", start: 1.5, end: 1 }, 2)).toEqual({ start: 1.5, end: 1.5 });
  });

  test("a whole file plays at once, from the start, at full volume", () => {
    expect(scheduleOf({ file: "x" }, 1)).toEqual({
      wait: 0,
      offset: 0,
      length: 1,
      envelope: [
        [0, 1],
        [1, 1],
      ],
      rate: 1,
    });
  });

  test("a trimmed sound starts at its cut and plays only its part", () => {
    const plan = scheduleOf({ file: "x", start: 0.2, end: 0.7 }, 2)!;
    expect(plan.offset).toBeCloseTo(0.2);
    expect(plan.length).toBeCloseTo(0.5);
  });

  test("the sync marker lands on the moment: started early by the marker's distance into the sound", () => {
    const plan = scheduleOf({ file: "x", start: 0.1, sync: 0.4 }, 2, 500)!;
    expect(plan.wait).toBeCloseTo(0.2);
    expect(plan.offset).toBeCloseTo(0.1);
  });

  test("with too little time before the moment, the start is skipped so the marker still lands on it", () => {
    const plan = scheduleOf({ file: "x", sync: 0.5 }, 2, 200)!;
    expect(plan.wait).toBe(0);
    expect(plan.offset).toBeCloseTo(0.3);
    expect(plan.length).toBeCloseTo(1.7);
  });

  test("a delay waits after the moment; a faster rate shortens the wait for the marker", () => {
    expect(scheduleOf({ file: "x", delay: 100 }, 1)!.wait).toBeCloseTo(0.1);
    expect(scheduleOf({ file: "x", sync: 0.4, rate: 2 }, 1, 500)!.wait).toBeCloseTo(0.3);
  });

  test("fades ramp in from silence and out to silence, in playing time", () => {
    const plan = scheduleOf({ file: "x", fadeIn: 0.1, fadeOut: 0.2, rate: 2 }, 1)!;
    expect(plan.envelope).toEqual([
      [0, 0],
      [0.05, 1],
      [0.4, 1],
      [0.5, 0],
    ]);
  });

  test("skipping into a fade-in starts part way up it", () => {
    const plan = scheduleOf({ file: "x", fadeIn: 0.4, sync: 0.2 }, 1)!;
    expect(plan.envelope[0]![1]).toBeCloseTo(0.5);
  });

  test("nothing left to play is no sound", () => {
    expect(scheduleOf({ file: "x", start: 0.5, end: 0.5 }, 1)).toBeNull();
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

  test("the first time, any variant can play, not only the first", () => {
    expect(pickVariant(2, undefined, () => 0.1)).toBe(0);
    expect(pickVariant(2, undefined, () => 0.9)).toBe(1);
    expect(pickVariant(4, undefined, () => 0.99)).toBe(3);
  });

  test("two variants take turns, across a manifest swap that leaves them as they were", () => {
    const board = new SoundBoard({ version: 1, sounds: { hit: [{ file: "a" }, { file: "b" }] } }, (f) => `/${f}`, {
      automated: true,
      random: () => 0,
    });
    const picks: number[] = [];
    let t = 0;
    // Each play a second apart, so none is dropped as a repeat.
    const clock = vi.spyOn(performance, "now").mockImplementation(() => (t += 1000));
    for (let i = 0; i < 4; i++) {
      board.play("hit");
      board.setManifest({ version: 1, sounds: { hit: [{ file: "a" }, { file: "b" }] } });
      picks.push(board.lastOf("hit")!);
    }
    clock.mockRestore();
    globalThis.__battleSounds = undefined;
    expect(picks).toEqual([0, 1, 0, 1]);
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

  const manifest: SoundManifest = {
    version: 1,
    sounds: { hit: [{ file: "a" }, { file: "b" }], draw: [{ file: "c" }] },
  };
  const resolve = (file: string) => `/${file}`;

  test("under automation it plays nothing and writes down what it would have played", () => {
    const board = new SoundBoard(manifest, resolve, { automated: true });
    board.play("hit");
    board.play("draw", { delay: 180 });
    expect(globalThis.__battleSounds?.map((s) => s.name)).toEqual(["hit", "draw"]);
  });

  test("the same sound twice at once is heard once; spaced apart, both are", () => {
    const board = new SoundBoard(manifest, resolve, { automated: true });
    board.play("draw");
    board.play("draw");
    board.play("draw", { delay: 180 });
    board.play("draw", { delay: 360 });
    expect(globalThis.__battleSounds?.map((s) => s.delay)).toEqual([0, 180, 360]);
  });

  test("five draws asked for at once, each due 180 ms after the last, are all heard", () => {
    const board = new SoundBoard(manifest, resolve, { automated: true });
    for (let i = 0; i < 5; i++) board.play("draw", { contactIn: 120 + i * 180 });
    expect(globalThis.__battleSounds?.map((s) => s.name)).toEqual(["draw", "draw", "draw", "draw", "draw"]);
  });

  test("turned off, it stays silent, and the choice is remembered", () => {
    const board = new SoundBoard(manifest, resolve, { automated: true });
    board.enabled = false;
    board.play("hit");
    expect(globalThis.__battleSounds).toBeUndefined();
    expect(new SoundBoard(manifest, resolve, { automated: true }).enabled).toBe(false);
  });

  test("a person's browser starts with sound on (the audio is approved); the studio's board too, leaving the setting alone", () => {
    expect(new SoundBoard(manifest, resolve).enabled).toBe(true);
    expect(new SoundBoard(manifest, resolve, { alwaysOn: true }).enabled).toBe(true);
    expect(localStorage.getItem("battle-sound")).toBeNull();
    // Turned off in the menu, it stays off.
    localStorage.setItem("battle-sound", "off");
    expect(new SoundBoard(manifest, resolve).enabled).toBe(false);
  });

  test("a sound with no variants is ignored; a new manifest swaps what plays", () => {
    const board = new SoundBoard(manifest, resolve, { automated: true });
    board.play("win");
    expect(globalThis.__battleSounds).toBeUndefined();
    board.setManifest({ version: 1, sounds: { win: [{ file: "w" }] } });
    board.play("win");
    expect(board.names()).toEqual(["win"]);
    expect(board.urls()).toEqual(["/w"]);
    expect(globalThis.__battleSounds?.map((s) => s.name)).toEqual(["win"]);
  });

  test("a sound switched off (no variants) plays nothing", () => {
    const board = new SoundBoard({ version: 1, sounds: { ...manifest.sounds, hit: [] } }, resolve, { automated: true });
    board.play("hit");
    expect(globalThis.__battleSounds).toBeUndefined();
    expect(board.names()).not.toContain("hit");
  });

  test("with no Web Audio (unlock does nothing), playing is a silent no-op", async () => {
    const board = new SoundBoard(manifest, resolve);
    board.unlock();
    expect(() => board.play("hit")).not.toThrow();
    expect(await board.playVariant("hit", { file: "a" })).toBeNull();
  });
});

describe("echo and reverb", () => {
  test("no effects, no tail; an echo rings until its repeats are 60 dB down, capped", () => {
    expect(tailOf({ file: "x" })).toBe(0);
    expect(tailOf({ file: "x", echoMix: 0.5, echoMs: 200, echoFeedback: 0.5 })).toBeCloseTo(2);
    expect(tailOf({ file: "x", echoMix: 0.5, echoMs: 1000, echoFeedback: 0.9 })).toBe(8);
    expect(tailOf({ file: "x", reverbMix: 0.3, reverbSeconds: 2.5 })).toBe(2.5);
  });

  test("a made room is two different channels that die away to silence", () => {
    const [left, right] = impulseResponse(1000, 1.5, () => Math.random());
    expect(left!.length).toBe(1500);
    expect(left).not.toEqual(right);
    const loudness = (part: Float32Array) => part.reduce((sum, v) => sum + Math.abs(v), 0) / part.length;
    expect(loudness(left!.slice(0, 300))).toBeGreaterThan(loudness(left!.slice(1200)) * 10);
    expect(Math.abs(left![left!.length - 1]!)).toBeLessThan(1e-4);
  });
});
