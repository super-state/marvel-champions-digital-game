/**
 * The line under the game-over text: how the player stands against this villain, Standard and Expert counted apart
 * (a win on Expert is not the same thing as one on Standard). A game saved before the record kept its facts was dealt
 * on Standard, as the table always did then.
 */
import type { FinishedGame } from "../record/game.js";

type Tally = { won: number; lost: number };

function tally(games: readonly FinishedGame[], difficulty: "standard" | "expert"): Tally {
  const played = games.filter((g) => (g.facts?.difficulty ?? "standard") === difficulty);
  const won = played.filter((g) => g.result === "win").length;
  return { won, lost: played.length - won };
}

const words = (t: Tally) => `${t.won} won, ${t.lost} lost`;

export function versusLine(name: string, games: readonly FinishedGame[], villain: string): string {
  const against = games.filter((g) => g.villain === villain);
  const standard = tally(against, "standard");
  const expert = tally(against, "expert");
  const played = (t: Tally) => t.won + t.lost > 0;
  if (played(standard) && played(expert))
    return `You against ${name}: on Standard ${words(standard)}; on Expert ${words(expert)}.`;
  if (played(expert)) return `You against ${name} on Expert: ${words(expert)}.`;
  return `You against ${name} on Standard: ${words(standard)}.`;
}
