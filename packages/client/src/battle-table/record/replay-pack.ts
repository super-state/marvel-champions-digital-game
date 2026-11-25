/**
 * A finished game kept whole, so it can be played again later (Adam, 2026-11-25: a friend lost to Ultron with the
 * threat counter jumping, and only the one-line summary was kept). What is kept is the deal and the player's moves
 * (`GameReplay`, model.ts): the engine is deterministic from its seed, so they play the same game again, beat for
 * beat, on the code of the version it was played on. The table's log comes too, for reading without replaying.
 *
 * Packed as gzipped JSON in base64 text: the page packs it (`test-site/player.ts`), the test site's database keeps the
 * text as it came (`test-site/players.ts`, table `game_replays`), and Adam's admin route or `pnpm table:game` unpack
 * it. No imports, so the worker and the plain-Node script load it without the engine.
 */

/** A saved game: the replay (model.ts `GameReplay`, kept as plain data here) and the table's log, oldest first. */
export interface SavedGame {
  v: 1;
  /** `{ v, deal, moves }` from `BattleModel.replay`. */
  replay: { v: 1; deal: object; moves: readonly unknown[] };
  log: string[];
}

/** The most log lines kept (a long game writes a few hundred). */
export const LOG_LIMIT = 3000;
/** The longest packed text the site keeps (base64 characters); a game is a few KB, so this is far above any. */
export const PACKED_LIMIT = 400_000;
/** The most a packed game may unpack to, so a bad row can't blow up whoever reads it. */
export const UNPACKED_LIMIT = 8_000_000;

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function streamed(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw Error("too big");
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A saved game as the text the site keeps; null when it would be over `PACKED_LIMIT` (the game saves without it). */
export async function packGame(game: SavedGame): Promise<string | null> {
  const kept: SavedGame = { ...game, log: game.log.slice(-LOG_LIMIT) };
  const json = new TextEncoder().encode(JSON.stringify(kept));
  try {
    const packed = toBase64(await streamed(json, new CompressionStream("gzip"), UNPACKED_LIMIT));
    return packed.length <= PACKED_LIMIT ? packed : null;
  } catch {
    return null;
  }
}

/** Packed text as the site sends it on: plain base64, no longer than `PACKED_LIMIT`. */
export function isPacked(text: unknown): text is string {
  return typeof text === "string" && text.length > 0 && text.length <= PACKED_LIMIT && /^[A-Za-z0-9+/]+=*$/.test(text);
}

/** A packed game read back; null when it isn't one. */
export async function unpackGame(text: string): Promise<SavedGame | null> {
  if (!isPacked(text)) return null;
  try {
    const json = await streamed(fromBase64(text), new DecompressionStream("gzip"), UNPACKED_LIMIT);
    const game = JSON.parse(new TextDecoder().decode(json)) as SavedGame;
    return game?.v === 1 && game.replay?.v === 1 && Array.isArray(game.replay.moves) && Array.isArray(game.log)
      ? game
      : null;
  } catch {
    return null;
  }
}
