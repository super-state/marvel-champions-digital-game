/**
 * Plays a saved game again (`replay-pack.ts`): deals it from its seed and makes the player's moves in order through
 * the table's own model, so the beats, the log lines and every state come out as they did for the player.
 *
 * Only on the code of the version the game was played on (`git checkout table-v<version>`): a later fix can change
 * what a move does, and then a move further on no longer fits.
 */
import type { Command } from "@mc/engine";
import { BattleModel, type GameReplay } from "../model.js";

export interface Replayed {
  /** The model after the last move played. */
  model: BattleModel;
  /** How many moves were played. */
  played: number;
  /** The move the engine refused (the replay stops there), or null when every move asked for went in. */
  refusedAt: number | null;
}

/**
 * Deals the game and makes its moves, up to `upTo` of them (all by default). `each` hears the model after every move
 * (index, model), to look at the table as it was at any point.
 */
export function replayGame(
  replay: GameReplay,
  options: { upTo?: number; each?: (index: number, model: BattleModel) => void } = {},
): Replayed {
  const { deal } = replay;
  const model = new BattleModel();
  model.reset({
    hero: deal.hero,
    villain: deal.villain,
    difficulty: deal.difficulty,
    modules: deal.modules,
    seed: deal.seed,
    mulligan: deal.mulligan,
    ...(deal.deck ? { deck: deal.deck } : {}),
  });
  const upTo = Math.min(options.upTo ?? replay.moves.length, replay.moves.length);
  for (let i = 0; i < upTo; i++) {
    if (!model.replayMove(replay.moves[i] as Command)) return { model, played: i, refusedAt: i };
    options.each?.(i, model);
  }
  return { model, played: upTo, refusedAt: null };
}
