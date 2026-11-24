// Small easing helpers the room's moves share.

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** How far through a move that starts `from` seconds in and lasts `length` seconds, at time `s`, eased. */
export const span = (s: number, from: number, length: number) => ease(clamp01((s - from) / length));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
