/**
 * The 3D table's sound effects: cards sliding and landing, attacks swooshing and hitting, threat tokens clacking on
 * schemes, stingers for the phases and the end of the game. The files live in `./sfx/` (made from Kenney's CC0 packs
 * by `scripts/battle-sfx/build.py`; `sfx/README.md` says which is which). A name with several files (`hit-1.mp3` …
 * `hit-5.mp3`) picks one at random each time, a little higher or lower and louder or softer, so a run of hits never
 * sounds like one sample on repeat.
 *
 * Self-contained on purpose: the old 2D game's music controller is not used, so nothing new is borrowed from it.
 * Silent until the player first clicks, taps or presses a key (browsers keep audio locked until then), when sound is
 * off in the menu, where there is no Web Audio (unit tests), and under browser automation, where what would have
 * played is written to `globalThis.__battleSounds` instead so the browser tests can check it.
 */

export type SoundName =
  | "draw"
  | "deal"
  | "place"
  | "play"
  | "flip"
  | "turn"
  | "discard"
  | "shuffle"
  | "whoosh"
  | "whoosh-big"
  | "hit"
  | "hit-heavy"
  | "block"
  | "threat"
  | "thwart"
  | "heal"
  | "status"
  | "defeat"
  | "boom"
  | "surge"
  | "boost"
  | "phase-hero"
  | "phase-villain"
  | "win"
  | "lose"
  | "select"
  | "confirm"
  | "error";

export interface PlayOptions {
  /** Milliseconds from now. */
  delay?: number;
  /** Multiplies the sound's own volume. */
  gain?: number;
  /** Playback speed (and so pitch); 1 is as recorded. */
  rate?: number;
  /** Fades out and stops after this many milliseconds (the shuffle, cut to its animation). */
  maxMs?: number;
}

/** Each sound's volume against the others, under 1 so a busy moment never clips. */
const VOLUME: Record<SoundName, number> = {
  draw: 0.55,
  deal: 0.6,
  place: 0.7,
  play: 0.75,
  flip: 0.7,
  turn: 0.45,
  discard: 0.5,
  shuffle: 0.55,
  whoosh: 0.55,
  "whoosh-big": 0.5,
  hit: 0.8,
  "hit-heavy": 0.85,
  block: 0.6,
  threat: 0.65,
  thwart: 0.65,
  heal: 0.5,
  status: 0.5,
  defeat: 0.7,
  boom: 0.75,
  surge: 0.55,
  boost: 0.55,
  "phase-hero": 0.55,
  "phase-villain": 0.6,
  win: 0.7,
  lose: 0.65,
  select: 0.35,
  confirm: 0.4,
  error: 0.45,
};

/** The same sound asked for again within this many milliseconds is dropped: two beats landing at once, one sound. */
const REPEAT_GAP_MS = 45;
const STORAGE_KEY = "battle-sound";

/** `sfx/hit-3.mp3` → `hit`. */
export function soundNameOf(path: string): string {
  return (path.split("/").pop() ?? "").replace(/-\d+\.mp3$/, "");
}

/** Every file under `sfx/`, grouped by sound name. */
export function groupFiles(files: Record<string, string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [path, url] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))) {
    const name = soundNameOf(path);
    groups.set(name, [...(groups.get(name) ?? []), url]);
  }
  return groups;
}

/** A variant other than the one played last, where there is a choice. */
export function pickVariant(count: number, last: number | undefined, random: () => number): number {
  if (count <= 1) return 0;
  const pick = Math.floor(random() * (count - 1));
  return last !== undefined && pick >= last ? pick + 1 : pick;
}

type SoundLog = { name: SoundName; at: number; delay: number }[];
declare global {
  var __battleSounds: SoundLog | undefined;
}

export class SoundBoard {
  readonly #files: Map<string, string[]>;
  readonly #random: () => number;
  readonly #automated: boolean;
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  readonly #buffers = new Map<string, Promise<AudioBuffer | null>>();
  readonly #last = new Map<SoundName, { at: number; variant: number }>();
  #enabled: boolean;

  constructor(files: Record<string, string>, { random = Math.random, automated = false } = {}) {
    this.#files = groupFiles(files);
    this.#random = random;
    this.#automated = automated;
    this.#enabled = readSetting();
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(on: boolean) {
    this.#enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Private window: the choice lasts this visit only.
    }
    if (!on) this.#context?.suspend().catch(() => {});
    else this.unlock();
  }

  /** The names that have files, the sounds that can be played. */
  names(): string[] {
    return [...this.#files.keys()];
  }

  /** Every file's address. */
  urls(): string[] {
    return [...this.#files.values()].flat();
  }

  /**
   * Called from the first click, tap or key press: makes the audio context (browsers only let a page start audio from
   * one) and loads every file, so the first card drawn is already heard. Safe to call again on every input; a
   * suspended context (the tab was hidden, sound was off) is resumed.
   */
  unlock(): void {
    if (this.#automated || !this.#enabled) return;
    if (!this.#context) {
      const Context =
        globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.#context = new Context();
      this.#master = this.#context.createGain();
      this.#master.connect(this.#context.destination);
      for (const urls of this.#files.values()) for (const url of urls) void this.#load(url);
    }
    if (this.#context.state === "suspended") this.#context.resume().catch(() => {});
  }

  play(name: SoundName, options: PlayOptions = {}): void {
    const urls = this.#files.get(name);
    if (!urls?.length || !this.#enabled) return;
    const now = performance.now();
    const delay = Math.max(0, options.delay ?? 0);
    const last = this.#last.get(name);
    if (last && Math.abs(now + delay - last.at) < REPEAT_GAP_MS) return;
    const variant = pickVariant(urls.length, last?.variant, this.#random);
    this.#last.set(name, { at: now + delay, variant });
    if (this.#automated) {
      (globalThis.__battleSounds ??= []).push({ name, at: Math.round(now), delay });
      return;
    }
    const context = this.#context;
    if (!context || !this.#master) return;
    if (context.state === "suspended") context.resume().catch(() => {});
    const url = urls[variant]!;
    const master = this.#master;
    const startAt = context.currentTime + delay / 1000;
    void this.#load(url).then((buffer) => {
      if (!buffer || !this.#enabled) return;
      // Loaded late (the very first sounds): start now rather than in the past, or not at all if it is long overdue.
      const when = Math.max(startAt, context.currentTime);
      if (when - startAt > 0.25) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = (options.rate ?? 1) * (1 + (this.#random() - 0.5) * 0.08);
      const gain = context.createGain();
      const volume = VOLUME[name] * (options.gain ?? 1) * (1 + (this.#random() - 0.5) * 0.2);
      gain.gain.setValueAtTime(volume, when);
      source.connect(gain).connect(master);
      source.start(when);
      if (options.maxMs) {
        const end = when + options.maxMs / 1000;
        gain.gain.setValueAtTime(volume, Math.max(when, end - 0.25));
        gain.gain.linearRampToValueAtTime(0.0001, end);
        source.stop(end + 0.02);
      }
    });
  }

  #load(url: string): Promise<AudioBuffer | null> {
    let loading = this.#buffers.get(url);
    if (!loading) {
      const context = this.#context;
      loading = context
        ? fetch(url)
            .then((response) => response.arrayBuffer())
            .then((data) => context.decodeAudioData(data))
            .catch(() => null)
        : Promise.resolve(null);
      this.#buffers.set(url, loading);
    }
    return loading;
  }
}

function readSetting(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

const files = import.meta.glob<string>("./sfx/*.mp3", { query: "?url", import: "default", eager: true });

/** The table's one sound board. */
export const sfx = new SoundBoard(files, {
  automated: typeof navigator !== "undefined" && navigator.webdriver === true,
});
