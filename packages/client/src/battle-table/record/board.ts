/**
 * The Record sheet's rows, until the trophy cabinet and record board stand in the room: your games overall, against
 * each villain and as each hero, your best, every achievement (earned ones lit, the rest saying how), and your latest
 * games. Plain rows built from `trophyRoom`; `test-site/player.ts` puts them in its dialog.
 */
import "./record.css";
import { trophyRoom, VILLAINS, type Tally } from "./achievements.js";
import type { FinishedGame } from "./game.js";

const REASONS: Record<string, string> = {
  villainDefeated: "Villain beaten",
  mainSchemeCompleted: "Scheme completed",
  allPlayersDefeated: "Hero knocked out",
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function table(head: string[], rows: (string | HTMLElement)[][], className = ""): HTMLTableElement {
  const t = make("table", `player-table ${className}`.trim());
  if (head.some(Boolean)) {
    const tr = make("tr");
    for (const h of head) tr.append(make("th", "", h));
    t.append(tr);
  }
  for (const row of rows) {
    const r = make("tr");
    for (const cell of row) {
      const td = make("td");
      td.append(cell);
      r.append(td);
    }
    t.append(r);
  }
  return t;
}

const pct = (t: Tally) => (t.played ? `${Math.round((t.won / t.played) * 100)}%` : "–");
const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const villainName = (id: string) => VILLAINS.find((v) => v.id === id)?.name ?? id;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The sheet's sections, from the finished games. `lock` says why a villain is still sealed (the test site's unlocks). */
export function recordRows(games: readonly FinishedGame[], lock: (villain: string) => string | null = () => null) {
  const room = trophyRoom(games);
  const { stats } = room;
  const out: HTMLElement[] = [];

  const boxes = make("div", "player-stats");
  for (const [label, value] of [
    ["Played", String(stats.total.played)],
    ["Won", String(stats.total.won)],
    ["Lost", String(stats.total.lost)],
    ["Win rate", pct(stats.total)],
  ] as const) {
    const box = make("div", "player-stat");
    box.append(make("b", "", value), make("span", "", label));
    boxes.append(box);
  }
  out.push(boxes);

  out.push(
    make("h3", "", "Against each villain"),
    table(
      ["Villain", "Won", "Lost", "Win rate"],
      stats.byVillain.map((v) => {
        const sealed = lock(v.id);
        return [v.name, sealed ?? String(v.tally.won), sealed ? "" : String(v.tally.lost), sealed ? "" : pct(v.tally)];
      }),
    ),
  );
  if (stats.byHero.length)
    out.push(
      make("h3", "", "As each hero"),
      table(
        ["Hero", "Won", "Lost", "Win rate"],
        stats.byHero.map((h) => [h.name, String(h.tally.won), String(h.tally.lost), pct(h.tally)]),
      ),
    );

  const fastest = stats.fastestWin;
  out.push(
    make("h3", "", "Your best"),
    table(
      [],
      [
        [
          "Fastest win",
          fastest
            ? `${plural(fastest.rounds, "round")} (${fastest.minutes} min), ${fastest.hero} vs ${fastest.villain}`
            : "No win yet",
        ],
        ["Longest winning run", plural(stats.longestWinningRun, "win")],
        ["Winning run now", plural(stats.currentWinningRun, "win")],
      ],
      "record-best",
    ),
  );

  out.push(
    make("h3", "", `Achievements: ${room.earned} of ${room.achievements.length}`),
    table(
      ["", "Achievement", "Progress"],
      room.achievements.map((a) => {
        const name = make("span");
        name.append(make("b", "", a.name), make("small", "", a.how));
        const progress = a.progress ? `${a.progress.have} / ${a.progress.need}` : a.earned ? "Done" : "";
        return [a.earned ? "★" : "☆", name, a.earned && a.earnedAt ? `${progress} · ${when(a.earnedAt)}` : progress];
      }),
      "record-achievements",
    ),
  );
  // Earned rows are lit (the table builder knows nothing of achievements, so mark them after).
  const rows = out.at(-1)!.querySelectorAll("tr");
  room.achievements.forEach((a, i) => rows[i + 1]?.classList.toggle("earned", a.earned));

  out.push(make("h3", "", "Latest games"));
  if (games.length)
    out.push(
      table(
        ["When", "Game", "Result", "How", "Rounds", "Time"],
        games
          .slice(0, 10)
          .map((g) => [
            when(g.endedAt),
            `${g.hero} vs ${villainName(g.villain)}`,
            make("span", g.result === "win" ? "won" : "lost", g.result === "win" ? "Won" : "Lost"),
            REASONS[g.reason] ?? g.reason,
            String(g.rounds),
            `${Math.max(0, Math.round((g.endedAt - g.startedAt) / 60000))} min`,
          ]),
      ),
    );
  else out.push(make("p", "player-note", "No games yet: finish one and it shows up here."));
  return out;
}
