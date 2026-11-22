/**
 * The 3D table's sound effects: cards sliding and landing, attacks swooshing and hitting, threat clacking onto
 * schemes, stingers for the phases and the end of the game.
 *
 * What plays for each moment is a manifest (`sound-edit.ts`): each sound name has one or more variants, each a file
 * with its own cut, fades, volume, pitch, delay and sync marker. The bundled one is `sfx/sounds.json` (missing, every
 * `sfx/<name>-<n>.mp3` played whole). In the dev server the Sound Studio's saved edits on this PC override it
 * (`/__studio/sounds.json`, `vite-sound-studio.ts`), and the studio can push unsaved edits for a live preview.
 *
 * One of several variants is picked at random each time, a little higher or lower and louder or softer, so a run of
 * hits never sounds like one sample on repeat (the studio turns that off while editing).
 *
 * Self-contained: the old 2D game's music controller is not used. Silent until the player first clicks, taps or
 * presses a key (browsers keep audio locked until then), when sound is off in the menu, where there is no Web Audio
 * (unit tests), and under browser automation, where what would have played is written to
 * `globalThis.__battleSounds` instead so the browser tests can check it.
 */

import { decibels, manifestFromFiles, scheduleOf, type SoundManifest, type Variant } from "./sound-edit.js";
import type { SoundName } from "./sound-moments.js";

export type { SoundName } from "./sound-moments.js";

export interface PlayOptions {
  /** Milliseconds from now. */
  delay?: number;
  /** Multiplies the sound's own volume. */
  gain?: number;
  /** Fades out and stops after this many milliseconds (the shuffle, cut to its animation). */
  maxMs?: number;
  /** The table's moment (an attack connecting) is this many milliseconds away: the sync marker lands on it. */
  contactIn?: number;
}

/** Each sound's volume against the others, under 1 so a busy moment never clips. */
const VOLUME: Partial<Record<SoundName, number>> = {
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
  ability: 0.5,
  cancel: 0.6,
  vanish: 0.45,
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
export const volumeOf = (name: string) => VOLUME[name as SoundName] ?? 0.7;

/** The same sound asked for again within this many milliseconds is dropped: two beats landing at once, one sound. */
const REPEAT_GAP_MS = 45;
const STORAGE_KEY = "battle-sound";

/** A variant other than the one played last, where there is a choice. */
export function pickVariant(count: number, last: number | undefined, random: () => number): number {
  if (count <= 1) return 0;
  const pick = Math.floor(random() * (count - 1));
  return last !== undefined && pick >= last ? pick + 1 : pick;
}

type SoundLog = { name: string; at: number; delay: number }[];
declare global {
  var __battleSounds: SoundLog | undefined;
}

/** Where a variant's file is fetched from. */
export type Resolve = (file: string) => string | undefined;

export class SoundBoard {
  #manifest: SoundManifest;
  #resolve: Resolve;
  readonly #random: () => number;
  readonly #automated: boolean;
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  readonly #buffers = new Map<string, Promise<AudioBuffer | null>>();
  readonly #last = new Map<string, { at: number; variant: number }>();
  #enabled: boolean;
  /** Random pitch and volume per play; off in the studio, so an edit sounds the same every time. */
  jitter = true;

  constructor(manifest: SoundManifest, resolve: Resolve, { random = Math.random, automated = false } = {}) {
    this.#manifest = manifest;
    this.#resolve = resolve;
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

  get manifest(): SoundManifest {
    return this.#manifest;
  }

  /** Swaps what plays for each moment (the studio's saved or unsaved edits). */
  setManifest(manifest: SoundManifest, resolve: Resolve = this.#resolve): void {
    this.#manifest = manifest;
    this.#resolve = resolve;
    this.#last.clear();
    if (this.#context) this.#preload();
  }

  /** The names that have files, the sounds that can be played. */
  names(): string[] {
    return Object.keys(this.#manifest.sounds).filter((name) => this.#manifest.sounds[name]?.length);
  }

  /** Every file's address. */
  urls(): string[] {
    return [
      ...new Set(
        Object.values(this.#manifest.sounds)
          .flat()
          .map((variant) => this.#resolve(variant.file))
          .filter((url): url is string => !!url),
      ),
    ];
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
      this.#preload();
    }
    if (this.#context.state === "suspended") this.#context.resume().catch(() => {});
  }

  /** The audio context, once unlocked (the studio reads its clock to draw a playhead). */
  get context(): AudioContext | null {
    return this.#context;
  }

  #forward: SoundBoard | null = null;

  /**
   * Hands every sound to another board instead (the Sound Studio's, when this table is its preview): it plays the
   * studio's unsaved edits, in the studio's own unlocked audio.
   */
  forwardTo(board: SoundBoard | null): void {
    this.#forward = board;
  }

  play(name: SoundName, options: PlayOptions = {}): void {
    if (this.#forward) return this.#forward.play(name, options);
    const variants = this.#manifest.sounds[name];
    if (!variants?.length || !this.#enabled) return;
    const now = performance.now();
    const delay = Math.max(0, options.delay ?? 0);
    const last = this.#last.get(name);
    if (last && Math.abs(now + delay - last.at) < REPEAT_GAP_MS) return;
    const index = pickVariant(variants.length, last?.variant, this.#random);
    this.#last.set(name, { at: now + delay, variant: index });
    if (this.#automated) {
      (globalThis.__battleSounds ??= []).push({ name, at: Math.round(now), delay });
      return;
    }
    this.playVariant(name, variants[index]!, options);
  }

  /**
   * Plays one variant as the named sound would (its volume, the variant's cut and shape): the game's path, and the
   * studio's preview, so what is heard while editing is what the game plays. Returns when it starts and how long it
   * runs, in the context's clock, for the studio's playhead.
   */
  async playVariant(
    name: string,
    variant: Variant,
    options: PlayOptions = {},
  ): Promise<{ at: number; offset: number; length: number; rate: number } | null> {
    if (this.#automated) return null;
    const context = this.#context;
    const url = this.#resolve(variant.file);
    if (!context || !this.#master || !url || !this.#enabled) return null;
    if (context.state === "suspended") context.resume().catch(() => {});
    const master = this.#master;
    const asked = context.currentTime + Math.max(0, options.delay ?? 0) / 1000;
    const buffer = await this.#load(url);
    if (!buffer || !this.#enabled) return null;
    // Loaded late (the very first sounds): start now rather than in the past, or not at all if it is long overdue.
    const lateBy = Math.max(0, context.currentTime - asked);
    if (lateBy > 0.25) return null;
    const plan = scheduleOf(variant, buffer.duration, Math.max(0, (options.contactIn ?? 0) - lateBy * 1000));
    if (!plan) return null;
    const when = Math.max(asked, context.currentTime) + plan.wait;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const wobble = this.jitter ? 1 + (this.#random() - 0.5) * 0.08 : 1;
    source.playbackRate.value = plan.rate * wobble;
    const gain = context.createGain();
    const volume =
      volumeOf(name) *
      decibels(variant.gainDb) *
      (options.gain ?? 1) *
      (this.jitter ? 1 + (this.#random() - 0.5) * 0.2 : 1);
    const seconds = plan.length / (plan.rate * wobble);
    const [first, ...rest] = plan.envelope;
    gain.gain.setValueAtTime(Math.max(0.0001, first![1] * volume), when);
    for (const [t, v] of rest) gain.gain.linearRampToValueAtTime(Math.max(0.0001, v * volume), when + t / wobble);
    let stopAt = when + seconds;
    if (options.maxMs && options.maxMs / 1000 < seconds) {
      stopAt = when + options.maxMs / 1000;
      gain.gain.cancelScheduledValues(Math.max(when, stopAt - 0.25));
      gain.gain.setValueAtTime(volume, Math.max(when, stopAt - 0.25));
      gain.gain.linearRampToValueAtTime(0.0001, stopAt);
    }
    source.connect(gain).connect(master);
    source.start(when, plan.offset, plan.length);
    source.stop(stopAt + 0.02);
    this.#playing.add(source);
    source.onended = () => this.#playing.delete(source);
    return { at: when, offset: plan.offset, length: plan.length, rate: plan.rate * wobble };
  }

  readonly #playing = new Set<AudioBufferSourceNode>();

  /** Stops everything playing (the studio's stop button). */
  stopAll(): void {
    for (const source of this.#playing) source.stop();
    this.#playing.clear();
  }

  /** The decoded file (the studio draws its waveform). */
  buffer(file: string): Promise<AudioBuffer | null> {
    const url = this.#resolve(file);
    return url ? this.#load(url) : Promise.resolve(null);
  }

  #preload(): void {
    for (const url of this.urls()) void this.#load(url);
  }

  #load(url: string): Promise<AudioBuffer | null> {
    let loading = this.#buffers.get(url);
    if (!loading) {
      const context = this.#context;
      if (!context) return Promise.resolve(null);
      loading = fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.arrayBuffer();
        })
        .then((data) => context.decodeAudioData(data))
        .catch(() => null);
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
const bundled = new Map(Object.entries(files).map(([path, url]) => [path.split("/").pop()!, url]));
const shipped = import.meta.glob<SoundManifest>("./sfx/sounds.json", { import: "default", eager: true })[
  "./sfx/sounds.json"
];

/** Before the studio splits them off, these play the block sound faster or slower. */
const SPLIT_FROM_BLOCK: SoundManifest["sounds"] = {
  ability: [1, 2, 3].map((n) => ({ file: `block-${n}.mp3`, rate: 1.3 })),
  cancel: [{ file: "block-1.mp3", rate: 0.75 }],
  vanish: [{ file: "block-2.mp3", rate: 0.8 }],
};

/** The game's own sounds, with nothing from the studio. */
export const BUNDLED_MANIFEST: SoundManifest = shipped ?? manifestFromFiles([...bundled.keys()], SPLIT_FROM_BLOCK);

/**
 * A file name to an address: bundled, saved by the studio on this PC, or straight off the disk (the studio's
 * unsaved preview; dev server only).
 */
export const resolveSound: Resolve = (file) => {
  if (file.startsWith("studio:")) return `/__studio/staged/${encodeURIComponent(file.slice(7))}`;
  if (file.startsWith("lib:")) return `/__studio/file?path=${encodeURIComponent(file.slice(4))}`;
  return bundled.get(file);
};

/** The table's one sound board. */
export const sfx = new SoundBoard(BUNDLED_MANIFEST, resolveSound, {
  automated: typeof navigator !== "undefined" && navigator.webdriver === true,
});

/** In the dev server, the Sound Studio's saved edits on this PC win, and follow each save without a reload. */
export async function loadStudioSounds(board: SoundBoard = sfx): Promise<boolean> {
  try {
    const response = await fetch("/__studio/sounds.json", { cache: "no-store" });
    if (!response.ok) return false;
    const saved = (await response.json()) as SoundManifest;
    board.setManifest({ version: 1, sounds: { ...BUNDLED_MANIFEST.sounds, ...saved.sounds } });
    return true;
  } catch {
    return false;
  }
}

if (import.meta.env?.DEV && typeof window !== "undefined" && navigator.webdriver !== true) {
  void loadStudioSounds();
  import.meta.hot?.on("sound-studio:saved", () => void loadStudioSounds());
}
