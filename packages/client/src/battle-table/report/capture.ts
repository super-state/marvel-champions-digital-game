/**
 * Reads the moment off the table for a bug report (`moment.ts`): the model's snapshot in words, plus what only the
 * page knows (the log, what the bar is asking, the screen). main.ts calls it as the player opens the report.
 */
import type { BattleCard, BattleSnapshot } from "../model.js";
import { LOG_LINES, type ReportMoment } from "./moment.js";

export interface TableReading {
  snapshot: BattleSnapshot;
  /** The engine state (plain data), to load the moment again. */
  state: unknown;
  inGame: boolean;
  hero: string;
  villain: string;
  difficulty: string;
  modules: readonly string[];
  seed: number;
  /** The whole story so far, oldest first (main.ts `story`). */
  story: readonly string[];
  asking: string;
  version: string | null;
}

const markers = (card: BattleCard) =>
  card.markers.length ? ` [${card.markers.map((m) => `${m.count} ${m.name}`).join(", ")}]` : "";

/** A card on the player's side: its name, whether it is exhausted, and what lies on it. */
export function ownCard(card: BattleCard): string {
  return `${card.name}${card.exhausted ? " (exhausted)" : ""}${markers(card)}`;
}

/** A card on the villain's side: its name, threat on a scheme, hit points on a minion. */
export function enemyCard(card: BattleCard): string {
  const threat = card.threat !== null ? ` ${card.threat}/${card.threatTarget ?? "–"} threat` : "";
  const hp =
    card.hp !== undefined && card.type !== "main_scheme" && card.type !== "side_scheme" ? ` ${card.hp} HP` : "";
  return `${card.name}${threat}${hp}${card.exhausted ? " (exhausted)" : ""}${markers(card)}`;
}

/** The page facts a report keeps (a test passes its own). */
export type PageFacts = Pick<Window, "innerWidth" | "innerHeight" | "devicePixelRatio" | "location" | "navigator">;

export function momentOf(reading: TableReading, page: PageFacts, input: string): ReportMoment {
  const s = reading.snapshot;
  return {
    version: reading.version,
    page: page.location.pathname,
    inGame: reading.inGame,
    hero: reading.hero,
    villain: reading.villain,
    difficulty: reading.difficulty,
    modules: [...reading.modules],
    seed: reading.seed,
    round: s.round,
    turn: s.turn,
    setup: s.setup,
    outcome: s.outcome ? `${s.outcome.result}: ${s.outcome.reason}` : null,
    heroHp: s.heroHp,
    villainHp: s.villainHp,
    heroCard: s.hero.name,
    villainCard: s.villain.name,
    hand: s.hand.map((card) => card.name),
    inPlay: s.inPlay.map(ownCard),
    enemies: s.enemyCards.map(enemyCard),
    asking: reading.asking,
    log: reading.story.slice(-LOG_LINES),
    screen: {
      width: page.innerWidth,
      height: page.innerHeight,
      pixelRatio: Math.round(page.devicePixelRatio * 100) / 100,
    },
    input,
    browser: page.navigator.userAgent,
    state: reading.state,
  };
}
