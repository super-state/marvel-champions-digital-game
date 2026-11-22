/**
 * How a sound file is cut and shaped before it plays, as set in the Sound Studio: the part of the file to use, fades
 * at either end, its volume and pitch, a delay, and a sync marker, the point in the file that lands on the moment the
 * table shows (the instant an attack connects). Pure maths, shared by the game and the studio so both play a sound
 * the same way.
 */

export interface Variant {
  /** A bundled file (`hit-1.mp3`), one saved by the studio (`studio:…`), or a library file (`lib:E:\…`). */
  file: string;
  /** Seconds into the file where the sound starts. */
  start?: number;
  /** Seconds into the file where it stops; missing, the file's end. */
  end?: number;
  /** Fade lengths, in seconds of the file. */
  fadeIn?: number;
  fadeOut?: number;
  /** Volume change in decibels. */
  gainDb?: number;
  /** Playback speed (and pitch); 1 is as recorded. */
  rate?: number;
  /** Seconds into the file that land on the table's moment; missing, the start. */
  sync?: number;
  /** Milliseconds added after the moment. */
  delay?: number;
  /** Echo: milliseconds between repeats, how much of each repeat feeds the next (0–0.9), and its level (0–1). */
  echoMs?: number;
  echoFeedback?: number;
  echoMix?: number;
  /** Reverb: how long the room rings, in seconds, and its level (0–1). */
  reverbSeconds?: number;
  reverbMix?: number;
}

/** How long an effect keeps sounding after the sound itself has stopped, in seconds. */
export function tailOf(variant: Variant): number {
  let tail = 0;
  if ((variant.echoMix ?? 0) > 0) {
    const feedback = Math.min(0.9, Math.max(0, variant.echoFeedback ?? 0.35));
    const step = Math.max(0.02, (variant.echoMs ?? 250) / 1000);
    // Repeats until they are 60 dB down.
    const repeats = feedback > 0 ? Math.ceil(Math.log(0.001) / Math.log(feedback)) : 1;
    tail = Math.max(tail, Math.min(8, step * repeats));
  }
  if ((variant.reverbMix ?? 0) > 0) tail = Math.max(tail, Math.min(6, variant.reverbSeconds ?? 1.5));
  return tail;
}

/**
 * A room's ring, made rather than recorded: stereo noise that dies away over `seconds`, a little brighter at the
 * start, the two sides different so it sounds wide.
 */
export function impulseResponse(rate: number, seconds: number, random = Math.random): Float32Array[] {
  const length = Math.max(1, Math.round(rate * Math.min(6, Math.max(0.1, seconds))));
  return [0, 1].map(() => {
    const channel = new Float32Array(length);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const noise = random() * 2 - 1;
      // Darker as it dies, like a real room: a one-pole low-pass that closes over the tail.
      const k = 0.15 + 0.8 * (1 - t);
      low += k * (noise - low);
      channel[i] = low * (1 - t) ** 2.5;
    }
    return channel;
  });
}

export interface SoundManifest {
  version: 1;
  sounds: Record<string, Variant[]>;
}

export interface Schedule {
  /** Seconds from now until the sound starts. */
  wait: number;
  /** Seconds into the file to start from. */
  offset: number;
  /** Seconds of the file to play. */
  length: number;
  /** Volume envelope: [seconds after start (wall clock), gain 0–1]. */
  envelope: [number, number][];
  rate: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The part of the file a variant uses, made safe against a file shorter than its settings. */
export function regionOf(variant: Variant, duration: number): { start: number; end: number } {
  const start = clamp(variant.start ?? 0, 0, duration);
  const end = clamp(variant.end ?? duration, start, duration);
  return { start, end };
}

/**
 * When and how to play a variant so its sync marker lands `contactIn` milliseconds from now (0: at once). When the
 * marker is further into the sound than the time left, the start is skipped so the marker still lands on time.
 */
export function scheduleOf(variant: Variant, duration: number, contactIn = 0): Schedule | null {
  const { start, end } = regionOf(variant, duration);
  const rate = clamp(variant.rate ?? 1, 0.25, 4);
  const sync = clamp(variant.sync ?? start, start, end) - start;
  let wait = contactIn / 1000 + (variant.delay ?? 0) / 1000 - sync / rate;
  let skipped = 0;
  if (wait < 0) {
    skipped = -wait * rate;
    wait = 0;
  }
  const length = end - start - skipped;
  if (length <= 0.005) return null;
  const fadeIn = clamp(variant.fadeIn ?? 0, 0, end - start);
  const fadeOut = clamp(variant.fadeOut ?? 0, 0, end - start - fadeIn);
  const total = end - start;
  // The envelope over the whole region in file seconds, then shifted past what was skipped and scaled to wall clock.
  const points: [number, number][] = [[0, fadeIn > 0 ? 0 : 1]];
  if (fadeIn > 0) points.push([fadeIn, 1]);
  if (fadeOut > 0) points.push([total - fadeOut, 1], [total, 0]);
  else points.push([total, 1]);
  const envelope: [number, number][] = [[0, valueAt(points, skipped)]];
  for (const [t, v] of points) if (t > skipped) envelope.push([(t - skipped) / rate, v]);
  return { wait, offset: start + skipped, length, envelope, rate };
}

function valueAt(points: [number, number][], t: number): number {
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1]!;
    const [t1, v1] = points[i]!;
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return points[points.length - 1]![1];
}

export const decibels = (gainDb = 0) => 10 ** (gainDb / 20);

/** The manifest the bundled files make with no studio edits: `hit-1.mp3` … grouped by name, each played whole. */
export function manifestFromFiles(fileNames: readonly string[], extra: SoundManifest["sounds"] = {}): SoundManifest {
  const sounds: SoundManifest["sounds"] = {};
  const sorted = [...fileNames].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  for (const file of sorted) {
    const name = file.replace(/-\d+\.mp3$/, "");
    (sounds[name] ??= []).push({ file });
  }
  for (const [name, variants] of Object.entries(extra)) sounds[name] ??= variants;
  return { version: 1, sounds };
}
